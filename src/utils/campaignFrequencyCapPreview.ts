/** Lógica compartilhada do preview de disparo (limite 24 h). */

export function phoneKeyForFreqPreview(phone: string): string {
  return String(phone || '').replace(/\D/g, '').slice(-11);
}

export function computeDispatchableAfterFreqCap(params: {
  contactCount: number;
  cappedCount: number;
  selectedCappedKeys: ReadonlySet<string>;
  largeBaseSkipClientCap: boolean;
}): number {
  if (params.largeBaseSkipClientCap) return params.contactCount;
  const liberated = Math.max(0, params.contactCount - params.cappedCount);
  return liberated + params.selectedCappedKeys.size;
}
