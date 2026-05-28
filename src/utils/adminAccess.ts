/** Identidade mínima para checagem de admin no front (Firebase User ou equivalente). */
export type PlatformAdminIdentity = {
  email?: string | null;
  uid?: string | null;
} | null | undefined;

function parseList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseUidList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** E-mails admin no front (menu). Gravação em /api/admin exige ADMIN_EMAILS ou ADMIN_UIDS no servidor. */
export function isAdminUserEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = parseList(import.meta.env.VITE_ADMIN_EMAILS as string | undefined);
  return list.includes(email.trim().toLowerCase());
}

function isAdminUserUid(uid: string | null | undefined): boolean {
  if (!uid?.trim()) return false;
  const merged = [import.meta.env.VITE_ADMIN_UIDS, import.meta.env.VITE_ZAPMASS_ADMIN_UIDS]
    .filter(Boolean)
    .join(',');
  const list = parseUidList(merged);
  return list.includes(uid.trim());
}

/** Menu / UX: alinhar VITE_ADMIN_EMAILS e VITE_ADMIN_UIDS com ADMIN_* no servidor após rebuild. */
export function isPlatformAdminUser(identity: PlatformAdminIdentity): boolean {
  if (!identity) return false;
  if (isAdminUserUid(identity.uid)) return true;
  return isAdminUserEmail(identity.email);
}
