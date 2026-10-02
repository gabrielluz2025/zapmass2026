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

export type FreqCapTriagedContact = {
  phone: string;
  name: string;
  vars: Record<string, string>;
  capped: boolean;
  lastSentAt?: string;
};

export function triageRecipientsForFreqCap(
  recipients: Array<{ phone: string; name?: string; vars: Record<string, string> }>,
  capContacts: Array<{ phoneKey: string; capped?: boolean; lastSentAt?: string }>
): { triaged: FreqCapTriagedContact[]; cappedCount: number } {
  const cappedByPhone = new Map(
    capContacts.map((c) => [c.phoneKey, { capped: Boolean(c.capped), lastSentAt: c.lastSentAt }])
  );
  let cappedCount = 0;
  const triaged: FreqCapTriagedContact[] = recipients.map((r) => {
    const digits = r.phone.replace(/\D/g, '');
    const key = phoneKeyForFreqPreview(digits);
    const cap = cappedByPhone.get(key);
    const capped = cap?.capped ?? false;
    if (capped) cappedCount += 1;
    return {
      phone: digits,
      name: r.name || r.phone,
      vars: r.vars,
      capped,
      lastSentAt: cap?.lastSentAt,
    };
  });
  return { triaged, cappedCount };
}

export function frequencyCapAllowPhonesFromTriaged(
  triaged: Array<{ phone: string; capped: boolean }>,
  selectedCappedKeys: ReadonlySet<string>
): string[] {
  return triaged
    .filter((c) => c.capped && selectedCappedKeys.has(phoneKeyForFreqPreview(c.phone)))
    .map((c) => c.phone);
}
