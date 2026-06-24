import type { Express, Request, Response } from 'express';
import { requireTenant } from './httpTenant.js';
import { getAssistantConfig, getRemainingQuota } from './assistant/assistantCache.js';
import { getStarterSuggestions, handleAssistantAsk } from './assistant/assistantEngine.js';
import type { AssistantHistoryMessage } from './assistant/assistantTypes.js';

export function registerAssistantRoutes(app: Express): void {
  app.get('/api/assistant/status', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const config = getAssistantConfig();
    const remainingToday = await getRemainingQuota(ctx.tenantId, ctx.principal.authUid);
    return res.json({
      ok: true,
      ...config,
      remainingToday,
      suggestions: getStarterSuggestions()
    });
  });

  app.post('/api/assistant/ask', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const body = req.body as {
      question?: unknown;
      currentView?: unknown;
      history?: unknown;
    };
    const question = typeof body.question === 'string' ? body.question : '';
    const currentView = typeof body.currentView === 'string' ? body.currentView.slice(0, 64) : undefined;
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

    try {
      const result = await handleAssistantAsk({
        tenantId: ctx.tenantId,
        actorId: ctx.principal.authUid,
        question,
        currentView,
        history
      });

      if (!result.ok) {
        return res.status(result.remainingToday === 0 ? 429 : 400).json(result);
      }
      return res.json(result);
    } catch (e) {
      console.error('[assistant/ask]', e);
      return res.status(500).json({
        ok: false,
        error: 'Não foi possível processar sua pergunta. Tente novamente.',
        remainingToday: await getRemainingQuota(ctx.tenantId, ctx.principal.authUid)
      });
    }
  });
}
