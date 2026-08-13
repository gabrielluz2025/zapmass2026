/**
 * Escolhe o próximo chip aberto do grupo quando o atribuído caiu.
 * Não falha o contato: devolve null para o worker adiar o job.
 */
export function pickOpenFailoverChannel(
  currentId: string,
  alternateIds: string[] | undefined,
  isOpen: (id: string) => boolean
): string | null {
  const current = String(currentId || '').trim();
  if (current && isOpen(current)) return current;
  const alts = Array.isArray(alternateIds)
    ? alternateIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (alts.length === 0) return null;
  const curIdx = Math.max(0, alts.indexOf(current));
  for (let step = 1; step <= alts.length; step++) {
    const altId = alts[(curIdx + step) % alts.length];
    if (!altId || altId === current) continue;
    if (isOpen(altId)) return altId;
  }
  return null;
}
