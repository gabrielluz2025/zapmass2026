import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { filterByConnectionScope } from '../src/utils/connectionScope.js';
import { conversationsPayloadForViewer } from './conversationsEmit.js';
import * as evolutionService from './evolutionService.js';

function parseBearer(req: Request): string | null {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : null;
}

async function resolveTenantUid(idToken: string): Promise<string | null> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return null;
    const decoded = await getAuth(adminApp).verifyIdToken(idToken);
    let tenantUid = decoded.uid;
    try {
        const lk = await adminApp.firestore().collection('userWorkspaceLinks').doc(decoded.uid).get();
        if (lk.exists) {
            const ou = lk.data()?.ownerUid;
            if (typeof ou === 'string' && ou.trim().length > 0) tenantUid = ou.trim();
        }
    } catch {
        /* workspace link opcional */
    }
    return tenantUid;
}

/**
 * Sincroniza instâncias Evolution → RAM da API, vincula canais abertos órfãos ao tenant
 * e importa chats para o pipeline.
 */
export function registerConnectionsSyncRoutes(app: Express): void {
    app.post('/api/connections/sync', async (req: Request, res: Response) => {
        try {
            const idToken = parseBearer(req);
            if (!idToken) {
                return res.status(401).json({ ok: false, error: 'Authorization: Bearer <token> obrigatório.' });
            }
            const tenantUid = await resolveTenantUid(idToken);
            if (!tenantUid) {
                return res.status(401).json({ ok: false, error: 'Token inválido.' });
            }

            const result = await evolutionService.syncConnectionsForOwner(tenantUid);
            const connections = filterByConnectionScope(tenantUid, result.connections);
            const conversations = conversationsPayloadForViewer(
                tenantUid,
                tenantUid,
                evolutionService.getConversations()
            );

            return res.json({
                ok: true,
                connections,
                conversationsCount: conversations.length,
                claimed: result.claimed,
                syncedChats: result.syncedChats,
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error('[api/connections/sync]', message);
            return res.status(500).json({ ok: false, error: message });
        }
    });
}
