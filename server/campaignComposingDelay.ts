/** Tempo de "digitando…" proporcional ao tamanho do texto (humanização). */
export function computeComposingDelayMs(text: string): number {
  const len = String(text || '').length;
  return Math.min(7000, Math.max(1500, (len / 15) * 1000));
}
