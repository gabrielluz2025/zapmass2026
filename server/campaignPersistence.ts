import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getFirestore } from 'firebase-admin/firestore';

export async function persistCampaignLogToFirestore(
    ownerUid: string | undefined,
    campaignId: string | undefined,
    level: string,
    message: string,
    payload?: Record<string, unknown>
): Promise<void> {
    if (!ownerUid || !campaignId) return;
    try {
        const admin = getFirebaseAdmin();
        if (!admin) return;
        const db = getFirestore(admin);
        await db.collection('users').doc(ownerUid).collection('campaigns').doc(campaignId).collection('logs').add({
            level: level.toUpperCase(),
            message,
            to: String(payload?.to || ''),
            connectionId: String(payload?.connectionId || ''),
            error: String(payload?.error || ''),
            createdAt: new Date().toISOString(),
        });
    } catch (e) {
        console.warn('[FirestoreLog] Erro ao salvar log no Firestore:', e);
    }
}

export async function persistCampaignProgressToFirestore(
    ownerUid: string | undefined,
    campaignId: string | undefined,
    successCount: number,
    failCount: number,
    processedCount: number,
    status?: string
): Promise<void> {
    if (!ownerUid || !campaignId) return;
    try {
        const admin = getFirebaseAdmin();
        if (!admin) return;
        const db = getFirestore(admin);
        const updateData: Record<string, unknown> = {
            successCount,
            failedCount: failCount,
            processedCount,
        };
        if (status) updateData.status = status;
        await db.collection('users').doc(ownerUid).collection('campaigns').doc(campaignId).update(updateData);
    } catch (e) {
        console.warn('[FirestoreProgress] Erro ao atualizar progresso da campanha no Firestore:', e);
    }
}
