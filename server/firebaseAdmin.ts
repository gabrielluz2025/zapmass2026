import { readFileSync, existsSync } from 'fs';
import admin from 'firebase-admin';

/**
 * Inicializa o Firebase Admin uma vez (Firestore no servidor, ex.: webhooks de pagamento).
 * Configure UMA das variaveis:
 * - FIREBASE_SERVICE_ACCOUNT_JSON: string JSON completa da conta de servico (escape em producao)
 * - FIREBASE_SERVICE_ACCOUNT_PATH: caminho absoluto para o arquivo .json da conta de servico
 */
export function getFirebaseAdmin(): admin.app.App | null {
  if (admin.apps.length > 0) {
    return admin.app();
  }
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();

  try {
    if (jsonRaw) {
      const cred = JSON.parse(jsonRaw) as admin.ServiceAccount;
      admin.initializeApp({ credential: admin.credential.cert(cred) });
      console.log('[FirebaseAdmin] Inicializado via FIREBASE_SERVICE_ACCOUNT_JSON');
      return admin.app();
    }
    if (path && existsSync(path)) {
      const cred = JSON.parse(readFileSync(path, 'utf8')) as admin.ServiceAccount;
      admin.initializeApp({ credential: admin.credential.cert(cred) });
      console.log('[FirebaseAdmin] Inicializado via FIREBASE_SERVICE_ACCOUNT_PATH');
      return admin.app();
    }
  } catch (e) {
    console.error('[FirebaseAdmin] Falha ao inicializar:', e);
    return null;
  }
  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  return !!(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
    (process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() &&
      existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH.trim()))
  );
}
