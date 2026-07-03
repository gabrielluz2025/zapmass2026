import toast from 'react-hot-toast';
import { formatDispatchPhone } from './campaignDispatchLogUi';

export type CampaignErrorBurstState = {
  /** Falhas ainda não refletidas no toast visível. */
  pending: number;
  timer: ReturnType<typeof setTimeout> | null;
  lastPhone?: string;
  lastReason?: string;
  lastToastAt: number;
  /** Total já anunciado ao utilizador (para atualizar o mesmo toast durante o cooldown). */
  announcedTotal: number;
};

const TOAST_ID_RECIPIENT_DIGEST = 'campaign-recipient-errors-digest';
const DIGEST_DEBOUNCE_MS = 2400;
const DIGEST_COOLDOWN_MS = 45_000;

function clipReason(reason: string, max = 120): string {
  const t = reason.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildDigestText(total: number, phone?: string, reason?: string): string {
  if (total === 1 && phone) {
    const display = formatDispatchPhone(phone) || phone;
    const detail = reason ? `: ${clipReason(reason)}` : '';
    return `Falha ao enviar para ${display}${detail}. Veja «Log do disparo» ou Relatório de envios na campanha.`;
  }
  if (total === 1) {
    return 'Falhou um envio no disparo atual. Veja «Log do disparo» ou Relatório de envios na campanha para o número e o motivo.';
  }
  return `${total} falhas de envio no disparo. Abra a campanha → «Log do disparo» ou Relatório de envios (aba Falhas) para detalhar por número.`;
}

function flushCampaignRecipientErrorDigest(stateRef: { current: CampaignErrorBurstState }): void {
  const s = stateRef.current;
  if (s.pending < 1) return;

  const batch = s.pending;
  s.pending = 0;
  const total = s.announcedTotal + batch;
  s.announcedTotal = total;

  const phone = total === 1 ? s.lastPhone : undefined;
  const reason = total === 1 ? s.lastReason : undefined;
  const text = buildDigestText(total, phone, reason);

  toast.error(text, {
    id: TOAST_ID_RECIPIENT_DIGEST,
    duration: total === 1 ? 9000 : 9500
  });
  s.lastToastAt = Date.now();
}

/**
 * Falhas por destinatário durante disparo são comuns numerosas.
 * Agrupa várias falhas num único toast (debounce + cooldown) para não inundar utilizadores.
 */
export function scheduleCampaignRecipientErrorDigest(
  stateRef: { current: CampaignErrorBurstState },
  debounceMs = DIGEST_DEBOUNCE_MS,
  sample?: { phone?: string; reason?: string }
): void {
  const s = stateRef.current;
  s.pending += 1;
  if (sample?.phone) s.lastPhone = sample.phone;
  if (sample?.reason) s.lastReason = sample.reason;

  const inCooldown = s.lastToastAt > 0 && Date.now() - s.lastToastAt < DIGEST_COOLDOWN_MS;

  if (inCooldown) {
    if (s.timer !== null) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    flushCampaignRecipientErrorDigest(stateRef);
    return;
  }

  if (s.timer !== null) return;

  s.timer = setTimeout(() => {
    s.timer = null;
    flushCampaignRecipientErrorDigest(stateRef);
  }, debounceMs);
}

export function resetCampaignRecipientErrorBurst(stateRef: { current: CampaignErrorBurstState }): void {
  const s = stateRef.current;
  if (s.timer !== null) clearTimeout(s.timer);
  s.timer = null;
  s.pending = 0;
  s.lastPhone = undefined;
  s.lastReason = undefined;
  s.lastToastAt = 0;
  s.announcedTotal = 0;
}
