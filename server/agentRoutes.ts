import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isPlatformAdminDecoded } from './adminIdentity.js';
import { assertAdminFromBearer } from './adminAuth.js';
import { requireTenant } from './httpTenant.js';
import type { AssistantHistoryMessage } from './assistant/assistantTypes.js';
import {
  loadAgentConfig,
  saveAgentConfigMerge,
  sanitizeAgentConfigPatch
} from './agent/agentConfigLoader.js';
import { getAgentStatus, handleAgentAsk } from './agent/agentOrchestrator.js';
import { listKnowledgeForAdmin, patchKnowledgeOverrides } from './agent/knowledgeService.js';
import type { AgentKnowledgeOverride, AgentMode, AgentScope } from './agent/types.js';

const agentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Limite de pedidos ao agente. Aguarde alguns minutos.' }
});

function isTenantPlatformAdmin(ctx: { principal: { authUid: string; email?: string | null } }): boolean {
  return isPlatformAdminDecoded({
    uid: ctx.principal.authUid,
    email: ctx.principal.email,
    admin: false
  });
}

function parseMode(raw: unknown): AgentMode | undefined {
  if (raw === 'auto' || raw === 'standard' || raw === 'admin_full') return raw;
  return undefined;
}

function parseScope(raw: unknown): AgentScope | undefined {
  if (raw === 'tenant' || raw === 'platform') return raw;
  return undefined;
}

export function registerAgentRoutes(app: Express): void {
  app.get('/api/agent/status', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const isAdmin = isTenantPlatformAdmin(ctx);
    const status = await getAgentStatus({
      tenantId: ctx.tenantId,
      actorId: ctx.principal.authUid,
      isPlatformAdmin: isAdmin
    });
    return res.json(status);
  });

  app.post('/api/agent/ask', agentLimiter, async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const body = req.body as {
      question?: unknown;
      screen?: unknown;
      currentView?: unknown;
      history?: unknown;
      context?: unknown;
      mode?: unknown;
      scope?: unknown;
    };

    const question = typeof body.question === 'string' ? body.question : '';
    const screen = typeof body.screen === 'string' ? body.screen.slice(0, 64) : undefined;
    const currentView =
      typeof body.currentView === 'string' ? body.currentView.slice(0, 64) : screen;
    const history: AssistantHistoryMessage[] = Array.isArray(body.history)
      ? body.history
          .filter(
            (m): m is AssistantHistoryMessage =>
              !!m &&
              typeof m === 'object' &&
              (m as AssistantHistoryMessage).role !== undefined &&
              typeof (m as AssistantHistoryMessage).content === 'string'
          )
          .slice(-4)
      : [];

    const isAdmin = isTenantPlatformAdmin(ctx);

    try {
      const result = await handleAgentAsk({
        tenantId: ctx.tenantId,
        actorId: ctx.principal.authUid,
        question,
        screen,
        currentView,
        history,
        context: body.context,
        mode: parseMode(body.mode),
        scope: parseScope(body.scope),
        isPlatformAdmin: isAdmin,
        allowLlm: isAdmin
      });

      if (!result.ok) {
        return res.status(result.remainingToday === 0 ? 429 : 400).json(result);
      }
      return res.json(result);
    } catch (e) {
      console.error('[agent/ask]', e);
      return res.status(500).json({
        ok: false,
        error: 'Não foi possível processar sua pergunta. Tente novamente.',
        remainingToday: 0
      });
    }
  });

  app.get('/api/agent/knowledge', async (req: Request, res: Response) => {
    const admin = await assertAdminFromBearer(req, res);
    if (!admin) return;
    const data = await listKnowledgeForAdmin();
    return res.json({ ok: true, ...data });
  });

  app.patch('/api/agent/knowledge', async (req: Request, res: Response) => {
    const admin = await assertAdminFromBearer(req, res);
    if (!admin) return;
    const overrides = Array.isArray(req.body?.overrides) ? (req.body.overrides as AgentKnowledgeOverride[]) : null;
    if (!overrides) {
      return res.status(400).json({ ok: false, error: 'Envie { overrides: [...] }.' });
    }
    const saved = await patchKnowledgeOverrides(overrides);
    return res.json({ ok: true, overrides: saved });
  });

  app.get('/api/agent/config', async (req: Request, res: Response) => {
    const admin = await assertAdminFromBearer(req, res);
    if (!admin) return;
    const cfg = await loadAgentConfig();
    return res.json({ ok: true, config: cfg });
  });

  app.patch('/api/agent/config', async (req: Request, res: Response) => {
    const admin = await assertAdminFromBearer(req, res);
    if (!admin) return;
    const partial = sanitizeAgentConfigPatch(req.body?.config ?? req.body);
    if (Object.keys(partial).length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo válido para atualizar.' });
    }
    const cfg = await saveAgentConfigMerge(partial);
    return res.json({ ok: true, config: cfg });
  });
}
