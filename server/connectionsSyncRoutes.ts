import type { Express, Request, Response } from 'express';
import { filterByConnectionScope } from './connectionScopeServer.js';
import { conversationsPayloadForViewer } from './conversationsEmit.js';
import * as evolutionService from './evolutionService.js';
import {
  getWorkspaceMembersForPrincipal,
  parseBearer,
  resolveAuthPrincipal
} from './resolveAuth.js';

/**
 * Sincroniza instâncias Evolution → RAM da API, vincula canais abertos órfãos ao tenant
 * e importa chats para o pipeline.
 */
export function registerConnectionsSyncRoutes(app: Express): void {
  app.post('/api/connections/sync', async (req: Request, res: Response) => {
    try {
      const token = parseBearer(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'Authorization: Bearer <token> obrigatório.' });
      }
      const principal = await resolveAuthPrincipal(token);
      if (!principal) {
        return res.status(401).json({ ok: false, error: 'Token inválido.' });
      }
      const tenantUid = principal.tenantUid;
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { force?: boolean };
      const force = body.force === true;

      const result = await evolutionService.syncConnectionsForOwner(tenantUid, { force });
      const connections = filterByConnectionScope(tenantUid, result.connections);
      const conversations = conversationsPayloadForViewer(
        tenantUid,
        principal.authUid,
        evolutionService.getConversations(),
        evolutionService.resolveConnectionOwnerUid
      );

      if (conversations.length === 0 && connections.some((c) => c.status === 'CONNECTED')) {
        console.warn('[api/connections/sync] conversas vazias com canal CONNECTED', {
          tenantUid,
          syncedChats: result.syncedChats,
          claimed: result.claimed,
          connectionIds: connections.map((c) => c.id),
          ramConversations: evolutionService.getConversations().length
        });
      }

      return res.json({
        ok: true,
        connections,
        conversations,
        conversationsCount: conversations.length,
        claimed: result.claimed,
        syncedChats: result.syncedChats
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[api/connections/sync]', message);
      return res.status(500).json({ ok: false, error: message });
    }
  });

  /** Fallback quando o socket não entrega o QR — o modal faz polling até aparecer. */
  app.get('/api/connections/:id/qr', async (req: Request, res: Response) => {
    try {
      const token = parseBearer(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'Authorization: Bearer <token> obrigatório.' });
      }
      const principal = await resolveAuthPrincipal(token);
      if (!principal) {
        return res.status(401).json({ ok: false, error: 'Token inválido.' });
      }
      const tenantUid = principal.tenantUid;
      const connectionId = String(req.params.id || '').trim();
      if (!connectionId) {
        return res.status(400).json({ ok: false, error: 'Canal inválido.' });
      }
      const members = await getWorkspaceMembersForPrincipal(principal);
      if (!evolutionService.ensureTenantOwnsConnection(tenantUid, connectionId, members)) {
        return res.status(403).json({ ok: false, error: 'Canal não pertence a esta conta.' });
      }
      const qrCode = await evolutionService.refreshConnectionQr(connectionId);
      if (!qrCode) {
        return res.json({ ok: false, error: 'QR ainda não disponível. Aguarde alguns segundos.' });
      }
      return res.json({ ok: true, connectionId, qrCode });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[api/connections/:id/qr]', message);
      return res.status(500).json({ ok: false, error: message });
    }
  });
}
