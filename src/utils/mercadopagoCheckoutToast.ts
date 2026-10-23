import toast from 'react-hot-toast';
import {
  formatMercadoPagoCheckoutError,
  mercadoPagoAdminSetupHint,
  type MpCheckoutIssue
} from './mercadopagoCheckoutError';

/** Toast de falha no checkout MP; admin vê dica VPS (`mpIssue` da API). */
export function toastMercadoPagoCheckoutFailure(
  data: { error?: unknown; mpIssue?: unknown },
  isPlatformAdmin: boolean
): void {
  const errText = formatMercadoPagoCheckoutError(typeof data?.error === 'string' ? data.error : undefined);
  if (isPlatformAdmin && typeof data?.mpIssue === 'string') {
    toast.error(`${errText}\n\nAdmin: ${mercadoPagoAdminSetupHint(data.mpIssue as MpCheckoutIssue)}`, {
      duration: 9000
    });
  } else {
    toast.error(errText);
  }
}
