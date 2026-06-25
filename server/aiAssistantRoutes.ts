import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isPlatformAdminDecoded } from './adminIdentity.js';
import { requireTenant } from './httpTenant.js';
import type { AuthPrincipal } from './auth/types.js';
import { geminiGenerateJson, geminiGenerateText, isGeminiConfigured } from './geminiService.js';
import {
  buildAiAssistSystemInstruction,
  buildAiAssistUserPrompt,
  buildAiTenantSnapshot,
} from './aiContextService.js';

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Limite de pedidos à IA. Aguarde alguns minutos.' },
});

const SYSTEM_PT =
  'Você é assistente do ZapMass (CRM WhatsApp, Brasil). Responda em português do Brasil. ' +
  'Telefones: formato internacional 55 + DDD + número, só dígitos. UF: sigla de 2 letras. ' +
  'Cidades: "Nome · UF". Não invente dados — se incerto, deixe vazio ou null.';

type ImportRowIn = {
  lineNumber: number;
  name?: string;
  phone?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  email?: string;
  church?: string;
  role?: string;
  problems?: string[];
};

type ImportRowOut = ImportRowIn & {
  fixes?: string[];
};

function isTenantPlatformAdmin(principal: AuthPrincipal): boolean {
  return isPlatformAdminDecoded({
    uid: principal.authUid,
    email: principal.email,
    admin: false
  });
}

async function requireTenantPlatformAdmin(
  req: Request,
  res: Response
): Promise<{ tenantId: string; principal: AuthPrincipal } | null> {
  const ctx = await requireTenant(req, res);
  if (!ctx) return null;
  if (!isTenantPlatformAdmin(ctx.principal)) {
    res.status(403).json({
      ok: false,
      error: 'Assistente IA (Gemini) restrito a administradores da plataforma.'
    });
    return null;
  }
  return ctx;
}

export function registerAiAssistantRoutes(app: Express): void {
  app.get('/api/ai/status', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const admin = isTenantPlatformAdmin(ctx.principal);
    if (!admin) {
      return res.json({ ok: true, configured: false, admin: false, model: null });
    }
    return res.json({
      ok: true,
      configured: isGeminiConfigured(),
      admin: true,
      model: isGeminiConfigured() ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash').trim() : null,
    });
  });

  app.post('/api/ai/contacts/import-organize', aiLimiter, async (req: Request, res: Response) => {
    const ctx = await requireTenantPlatformAdmin(req, res);
    if (!ctx) return;
    if (!isGeminiConfigured()) {
      return res.status(503).json({ ok: false, error: 'IA não configurada. Adicione GEMINI_API_KEY no servidor.' });
    }
    const rows = Array.isArray(req.body?.rows) ? (req.body.rows as ImportRowIn[]) : [];
    if (rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'Envie ao menos uma linha.' });
    }
    if (rows.length > 25) {
      return res.status(400).json({ ok: false, error: 'Máximo 25 linhas por pedido.' });
    }

    try {
      const result = await geminiGenerateJson<{ rows: ImportRowOut[] }>(
        JSON.stringify({ rows }),
        `${SYSTEM_PT} Corrija nomes (capitalização), telefones BR, cidade/UF, bairro e e-mail. ` +
          `Retorne JSON: {"rows":[{"lineNumber":1,"name":"...","phone":"5511...","city":"...","state":"SC",` +
          `"neighborhood":"...","email":"...","church":"...","role":"...","fixes":["descrição curta"]}]} ` +
          `Mantenha lineNumber igual ao enviado.`
      );
      return res.json({ ok: true, rows: Array.isArray(result.rows) ? result.rows : [] });
    } catch (e) {
      console.error('[ai/import-organize]', e);
      return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Falha na IA.' });
    }
  });

  app.post('/api/ai/contacts/parse-text', aiLimiter, async (req: Request, res: Response) => {
    const ctx = await requireTenantPlatformAdmin(req, res);
    if (!ctx) return;
    if (!isGeminiConfigured()) {
      return res.status(503).json({ ok: false, error: 'IA não configurada.' });
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (text.length < 3) {
      return res.status(400).json({ ok: false, error: 'Cole algum texto.' });
    }
    if (text.length > 30_000) {
      return res.status(400).json({ ok: false, error: 'Texto muito longo (máx. 30.000 caracteres).' });
    }

    try {
      const result = await geminiGenerateJson<{
        contacts: Array<{
          name: string;
          phone: string;
          city?: string;
          state?: string;
          email?: string;
          church?: string;
          role?: string;
          neighborhood?: string;
        }>;
      }>(
        text,
        `${SYSTEM_PT} Extraia contatos do texto colado (Excel, Word, lista). ` +
          `Retorne JSON: {"contacts":[{"name":"","phone":"","city":"","state":"","email":"","church":"","role":"","neighborhood":""}]}`
      );
      return res.json({ ok: true, contacts: Array.isArray(result.contacts) ? result.contacts : [] });
    } catch (e) {
      console.error('[ai/parse-text]', e);
      return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Falha na IA.' });
    }
  });

  app.post('/api/ai/contacts/enrich', aiLimiter, async (req: Request, res: Response) => {
    const ctx = await requireTenantPlatformAdmin(req, res);
    if (!ctx) return;
    if (!isGeminiConfigured()) {
      return res.status(503).json({ ok: false, error: 'IA não configurada.' });
    }
    const contact = req.body?.contact;
    if (!contact || typeof contact !== 'object') {
      return res.status(400).json({ ok: false, error: 'Envie { contact: { ... } }.' });
    }

    try {
      const result = await geminiGenerateJson<{
        contact: Record<string, string | null>;
        suggestions: string[];
      }>(
        JSON.stringify({ contact }),
        `${SYSTEM_PT} Complete e normalize campos do contato (endereço, bairro, cidade, UF, igreja, cargo). ` +
          `Retorne JSON: {"contact":{"name":"...","phone":"...","city":"...","state":"...","street":"...",` +
          `"number":"...","neighborhood":"...","zipCode":"...","church":"...","role":"...","email":"..."},` +
          `"suggestions":["dica 1","dica 2"]}`
      );
      return res.json({
        ok: true,
        contact: result.contact && typeof result.contact === 'object' ? result.contact : {},
        suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      });
    } catch (e) {
      console.error('[ai/enrich]', e);
      return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Falha na IA.' });
    }
  });

  app.post('/api/ai/map/data-quality', aiLimiter, async (req: Request, res: Response) => {
    const ctx = await requireTenantPlatformAdmin(req, res);
    if (!ctx) return;
    if (!isGeminiConfigured()) {
      return res.status(503).json({ ok: false, error: 'IA não configurada.' });
    }
    const samples = Array.isArray(req.body?.samples) ? req.body.samples : [];
    const regionLabel = typeof req.body?.regionLabel === 'string' ? req.body.regionLabel : '';
    if (samples.length === 0) {
      return res.status(400).json({ ok: false, error: 'Envie amostra de contatos.' });
    }
    if (samples.length > 30) {
      return res.status(400).json({ ok: false, error: 'Máximo 30 contatos por pedido.' });
    }

    try {
      const result = await geminiGenerateJson<{
        fixes: Array<{
          id: string;
          neighborhood?: string;
          city?: string;
          state?: string;
          note?: string;
        }>;
        summary: string;
        tips: string[];
      }>(
        JSON.stringify({ regionLabel, samples }),
        `${SYSTEM_PT} Analise contatos com dados geográficos incompletos no mapa. ` +
          `Sugira bairro/cidade/UF plausíveis para a região indicada. ` +
          `Retorne JSON: {"fixes":[{"id":"...","neighborhood":"...","city":"...","state":"SC","note":"..."}],` +
          `"summary":"frase resumo","tips":["dica operacional"]}`
      );
      return res.json({
        ok: true,
        fixes: Array.isArray(result.fixes) ? result.fixes : [],
        summary: result.summary || '',
        tips: Array.isArray(result.tips) ? result.tips : [],
      });
    } catch (e) {
      console.error('[ai/map-quality]', e);
      return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Falha na IA.' });
    }
  });

  app.post('/api/ai/campaigns/suggest-message', aiLimiter, async (req: Request, res: Response) => {
    const ctx = await requireTenantPlatformAdmin(req, res);
    if (!ctx) return;
    if (!isGeminiConfigured()) {
      return res.status(503).json({ ok: false, error: 'IA não configurada.' });
    }
    const brief = typeof req.body?.brief === 'string' ? req.body.brief.trim() : '';
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    const segment = typeof req.body?.segment === 'string' ? req.body.segment : 'geral';

    try {
      const result = await geminiGenerateJson<{ message: string; variants: string[] }>(
        JSON.stringify({ brief, current, segment }),
        `${SYSTEM_PT} Escreva mensagens de campanha WhatsApp curtas, naturais, com variáveis {nome} quando fizer sentido. ` +
          `Evite spam, caps lock e links suspeitos. ` +
          `Retorne JSON: {"message":"texto principal","variants":["variação 1","variação 2"]}`
      );
      return res.json({
        ok: true,
        message: result.message || '',
        variants: Array.isArray(result.variants) ? result.variants : [],
      });
    } catch (e) {
      console.error('[ai/campaign-message]', e);
      return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Falha na IA.' });
    }
  });

  app.post('/api/ai/assist', aiLimiter, async (req: Request, res: Response) => {
    const ctx = await requireTenantPlatformAdmin(req, res);
    if (!ctx) return;
    if (!isGeminiConfigured()) {
      return res.status(503).json({ ok: false, error: 'IA não configurada.' });
    }
    const screen = typeof req.body?.screen === 'string' ? req.body.screen.slice(0, 64) : 'geral';
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const context = req.body?.context;
    if (!question) {
      return res.status(400).json({ ok: false, error: 'Escreva uma pergunta.' });
    }

    try {
      const snapshot = await buildAiTenantSnapshot(
        ctx.tenantId,
        ctx.principal.authUid,
        screen,
        question,
        context
      );
      const answer = await geminiGenerateText(
        buildAiAssistUserPrompt(screen, question, snapshot),
        buildAiAssistSystemInstruction(screen),
        { jsonMode: false }
      );
      return res.json({ ok: true, answer, dataUsed: true });
    } catch (e) {
      console.error('[ai/assist]', e);
      return res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Falha na IA.' });
    }
  });
}
