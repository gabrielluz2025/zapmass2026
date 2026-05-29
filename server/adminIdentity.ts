/** Identidade de administrador da plataforma (não confundir com dono de workspace / tenant). */

export function parseCsvEnvSet(raw: string | undefined): Set<string> {
  if (!raw || !raw.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function adminEmailSet(): Set<string> {
  const emails = [...parseCsvEnvSet(process.env.ADMIN_EMAILS)].map((e) => e.toLowerCase());
  if (!emails.includes('festaimportgabriel@gmail.com')) {
    emails.push('festaimportgabriel@gmail.com');
  }
  return new Set(emails);
}

/** UIDs Firebase (ADMIN_UIDS ou ZAPMASS_ADMIN_UIDS — mesma lista unificada). */
export function adminUidSet(): Set<string> {
  const merged = [process.env.ADMIN_UIDS, process.env.ZAPMASS_ADMIN_UIDS]
    .filter((s) => s?.trim())
    .join(',');
  return parseCsvEnvSet(merged);
}

export type PlatformAdminDecoded = {
  uid: string;
  email: string;
  admin?: boolean;
};

export function isPlatformAdminDecoded(decoded: PlatformAdminDecoded): boolean {
  if (decoded.admin === true) return true;
  const email = (decoded.email || '').trim().toLowerCase();
  if (email && adminEmailSet().has(email)) return true;
  const uid = (decoded.uid || '').trim();
  if (uid && adminUidSet().has(uid)) return true;
  return false;
}

export function platformAdminDenyHint(): string {
  const hasEmails = adminEmailSet().size > 0;
  const hasUids = adminUidSet().size > 0;
  if (!hasEmails && !hasUids) {
    return 'Servidor sem ADMIN_EMAILS nem ADMIN_UIDS/ZAPMASS_ADMIN_UIDS no .env — configure na VPS e reinicie o contentor api.';
  }
  return 'Confirme que seu e-mail ou UID Firebase consta em ADMIN_EMAILS ou ADMIN_UIDS no .env da VPS (rebuild se alterar VITE_*).';
}
