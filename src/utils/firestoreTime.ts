/** Converte Timestamp do Firestore (client SDK) ou objeto { seconds } em ms. */
export function firestoreTimeToMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === 'object' && v !== null && 'seconds' in v) {
    const s = Number((v as { seconds: number }).seconds);
    if (Number.isFinite(s)) return s * 1000;
  }
  return null;
}
