import toast from 'react-hot-toast';

export type CampaignErrorBurstState = {
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const TOAST_ID_RECIPIENT_DIGEST = 'campaign-recipient-errors-digest';

/**
 * Falhas por destinatário durante disparo são comuns numerosas.
 * Agrupa várias falhas num único toast (debounce) para não inundar utilizadores nem gerar falsas urgências de suporte.
 */
export function scheduleCampaignRecipientErrorDigest(
  stateRef: { current: CampaignErrorBurstState },
  debounceMs = 2400
): void {
  const s = stateRef.current;
  s.count += 1;
  if (s.timer !== null) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    const n = s.count;
    s.count = 0;
    if (n < 1) return;
    const text =
      n === 1
        ? 'Falhou um envio no disparo atual. Veja relatório ou «Registos do sistema» para o número e o motivo — não repetimos toast por cada contacto.'
        : `${n} falhas de envio num curto intervalo foram registadas — mostramos um resumo só, para não incomodar. Abra relatório/registos para detalhar por número.`;
    toast.error(text, {
      id: TOAST_ID_RECIPIENT_DIGEST,
      duration: n === 1 ? 7000 : 9000
    });
  }, debounceMs);
}

export function resetCampaignRecipientErrorBurst(stateRef: { current: CampaignErrorBurstState }): void {
  const s = stateRef.current;
  if (s.timer !== null) clearTimeout(s.timer);
  s.timer = null;
  s.count = 0;
}
