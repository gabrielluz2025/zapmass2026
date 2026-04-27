import type { Express, Request, Response } from 'express';
import { assertAdminFromBearer } from './adminAuth.js';
import * as waService from './whatsappService.js';
import { submitDeleteConnection } from './sessionControlPlane.js';
import { ConnectionStatus } from './types.js';

function ownerFromConnectionId(id: string): { ownerUid: string | null; localId: string } {
  const idx = id.indexOf('__');
  if (idx <= 0) return { ownerUid: null, localId: id };
  return { ownerUid: id.slice(0, idx), localId: id.slice(idx + 2) };
}

export function registerAdminConnectionsRoutes(app: Express): void {
  app.get('/api/admin/connections-overview', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    const connections = waService.getConnections().map((c) => {
      const { ownerUid, localId } = ownerFromConnectionId(c.id);
      const isConnected = c.status === ConnectionStatus.CONNECTED;
      return {
        id: c.id,
        localId,
        name: c.name,
        status: c.status,
        lastActivity: c.lastActivity,
        phoneNumber: c.phoneNumber,
        ownerUid,
        canRevoke: !isConnected
      };
    });

    res.json({ ok: true, at: new Date().toISOString(), connections });
  });

  /**
   * Remove uma conexão no servidor (para de gerar QR / fechar browser) **desde que**
   * não esteja CONNECTED. Conexões já autenticadas no WhatsApp não podem ser
   * encerradas por aqui (protecção de dados operacionais).
   */
  app.post('/api/admin/connections/revoke-pending', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    const id = typeof (req.body as { id?: unknown })?.id === 'string' ? (req.body as { id: string }).id.trim() : '';
    if (!id) {
      res.status(400).json({ ok: false, error: 'Campo "id" obrigatório.' });
      return;
    }

    const list = waService.getConnections();
    const conn = list.find((c) => c.id === id);
    if (!conn) {
      res.status(404).json({ ok: false, error: 'Conexão não encontrada.' });
      return;
    }
    if (conn.status === ConnectionStatus.CONNECTED) {
      res.status(400).json({
        ok: false,
        error:
          'Esta conexão já está ligada ao WhatsApp. Não é possível encerrar por aqui (use o fluxo normal do cliente, se necessário).'
      });
      return;
    }

    try {
      await submitDeleteConnection(id, auth.uid);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao remover conexão';
      res.status(500).json({ ok: false, error: msg });
    }
  });
}
