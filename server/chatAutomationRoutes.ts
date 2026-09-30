import type { Express, Request, Response } from 'express';
import { requireTenant } from './httpTenant.js';
import { getConversations, broadcastConversationsUpdate } from './whatsappService.js';
import {
  pauseContactAutomationsForHumanClaim,
  resolveConnectionOwnerUid,
} from './evolutionService.js';
import { rememberClaim } from './inboxAssignments.js';
import { normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';

function ownsConversation(tenantUid: string, connectionId: string): boolean {
  const owner = resolveConnectionOwnerUid(connectionId);
  return !owner || owner === tenantUid;
}

/** Pausa fluxo por resposta, fila de disparo e nutrição — funciona com auth VPS (sem Firebase workspace). */
export function registerChatAutomationRoutes(app: Express): void {
  app.post('/api/chat/pause-contact-automation', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;

    const conversationId =
      typeof (req.body as { conversationId?: unknown })?.conversationId === 'string'
        ? String((req.body as { conversationId: string }).conversationId).trim()
        : '';
    if (!conversationId) {
      return res.status(400).json({ ok: false, error: 'conversationId é obrigatório.' });
    }

    const conv = getConversations().find((c) => c.id === conversationId);
    if (!conv || !ownsConversation(ctx.tenantId, conv.connectionId)) {
      return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
    }

    const phoneDigits = normalizePhoneDigits(conv.contactPhone || conversationId.split(':').pop() || '');
    if (phoneDigits.length < 8) {
      return res.status(400).json({ ok: false, error: 'Telefone da conversa inválido.' });
    }

    try {
      const result = await pauseContactAutomationsForHumanClaim(
        ctx.tenantId,
        conversationId,
        conv.connectionId,
        phoneDigits
      );
      rememberClaim(ctx.tenantId, conversationId, ctx.tenantId);
      broadcastConversationsUpdate();
      return res.json({
        ok: true,
        jobsCancelled: result.jobsCancelled,
        replySessionClosed: result.replySessionClosed,
      });
    } catch (e) {
      console.error('[chat/pause-contact-automation]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao pausar automações.' });
    }
  });
}
