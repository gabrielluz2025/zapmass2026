import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';

export type FirebaseAdminProbeResult = {
  ok: boolean;
  ms?: number;
  projectId?: string;
  error?: string;
};

/** Ping leve ao Auth (listUsers(1)) — usar com moderação (ex.: 60s). */
export async function pingFirebaseAdmin(): Promise<FirebaseAdminProbeResult> {
  const app = getFirebaseAdmin();
  if (!app) {
    return { ok: false, error: 'Firebase Admin nao inicializado no processo da API.' };
  }
  const projectId = typeof app.options.projectId === 'string' ? app.options.projectId : undefined;
  const t0 = Date.now();
  try {
    await getAuth(app).listUsers(1);
    return { ok: true, ms: Date.now() - t0, projectId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, projectId };
  }
}
