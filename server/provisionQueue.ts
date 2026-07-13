import fs from 'node:fs';
import path from 'node:path';
import { structuredLog } from './structuredLog.js';

export type InfraTier = 'starter' | 'pro' | 'business';

export type ProvisionQueueEntry = {
  uid: string;
  email: string;
  displayName: string;
  plan: 'monthly' | 'annual';
  channels: number;
  infraTier: InfraTier;
  createdAt: string;
  source: 'mercadopago';
};

const RESERVED_SLUGS = new Set([
  'demo',
  'admin',
  'api',
  'www',
  'redis',
  'postgres',
  'zapmass',
  'mail',
  'ftp',
  'test',
  'staging',
  'prod',
  'production'
]);

export function channelsToInfraTier(channels: number): InfraTier {
  const n = Math.max(1, Math.min(5, Math.floor(channels) || 1));
  if (n >= 5) return 'business';
  if (n >= 3) return 'pro';
  return 'starter';
}

/** Sugere slug a partir do e-mail ou nome (apenas heurística; colisões tratadas no script VPS). */
export function suggestSlugFromIdentity(email: string, displayName: string): string {
  const raw =
    (displayName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
    (email.split('@')[0] || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  let slug = raw.slice(0, 32).replace(/-+$/g, '');
  if (slug.length < 2) {
    slug = 'cliente';
  }
  if (RESERVED_SLUGS.has(slug)) {
    slug = `${slug}-cli`;
  }
  return slug;
}

function autoProvisionEnabled(): boolean {
  const raw = (process.env.ZAPMASS_AUTO_PROVISION || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  // Sem flag explícita: ativa se o diretório da fila existir e for gravável.
  const dir = queueRoot();
  return !!dir && fs.existsSync(dir);
}

function skipUidSet(): Set<string> {
  const raw = (process.env.ZAPMASS_PROVISION_SKIP_UIDS || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function queueRoot(): string | null {
  const dir = (process.env.ZAPMASS_PROVISION_QUEUE_DIR || '/run/provision-queue').trim();
  if (!dir) return null;
  return dir;
}

function ensureQueueDirs(root: string): { pending: string; done: string } | null {
  const pending = path.join(root, 'pending');
  const done = path.join(root, 'done');
  try {
    fs.mkdirSync(pending, { recursive: true });
    fs.mkdirSync(done, { recursive: true });
    return { pending, done };
  } catch (e) {
    structuredLog('warn', 'provision.queue.mkdir_failed', {
      root,
      error: e instanceof Error ? e.message : String(e)
    });
    return null;
  }
}

/**
 * Enfileira provisionamento Plano B após primeira assinatura paga.
 * Idempotente por uid (não sobrescreve pending/done existentes).
 */
export function enqueueProvisionAfterPaidIfNeeded(params: {
  uid: string;
  email: string;
  displayName: string;
  plan: 'monthly' | 'annual';
  channels: number;
  wasRenewal: boolean;
}): boolean {
  const { uid, email, displayName, plan, channels, wasRenewal } = params;
  if (!uid || wasRenewal) return false;
  if (!autoProvisionEnabled()) return false;
  if (skipUidSet().has(uid)) {
    structuredLog('info', 'provision.queue.skipped_uid', { uid });
    return false;
  }

  const root = queueRoot();
  if (!root) return false;
  const dirs = ensureQueueDirs(root);
  if (!dirs) return false;

  const doneFile = path.join(dirs.done, `${uid}.json`);
  const pendingFile = path.join(dirs.pending, `${uid}.json`);
  if (fs.existsSync(doneFile) || fs.existsSync(pendingFile)) {
    return false;
  }

  const entry: ProvisionQueueEntry & { suggestedSlug: string } = {
    uid,
    email: email.trim(),
    displayName: displayName.trim(),
    plan,
    channels: Math.max(1, Math.min(5, Math.floor(channels) || 1)),
    infraTier: channelsToInfraTier(channels),
    createdAt: new Date().toISOString(),
    source: 'mercadopago',
    suggestedSlug: suggestSlugFromIdentity(email, displayName)
  };

  try {
    fs.writeFileSync(pendingFile, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
    structuredLog('info', 'provision.queue.enqueued', {
      uid,
      slug: entry.suggestedSlug,
      tier: entry.infraTier,
      channels: entry.channels
    });
    return true;
  } catch (e) {
    structuredLog('warn', 'provision.queue.write_failed', {
      uid,
      error: e instanceof Error ? e.message : String(e)
    });
    return false;
  }
}
