function parseList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** E-mails admin no front (apenas para exibir o menu; gravacao exige ADMIN_EMAILS no servidor). */
export function isAdminUserEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = parseList(import.meta.env.VITE_ADMIN_EMAILS as string | undefined);
  return list.includes(email.trim().toLowerCase());
}
