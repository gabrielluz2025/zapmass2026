import type { AppConfigGlobal } from '../types/appConfig';
import { formatTrialDurationPhrase, formatTrialHoursLabel } from './trialCopy';

/** Texto efetivo do bloco de trial na landing (custom ou fallback por horas). */
export function resolveLandingTrialCopy(
  config: Pick<AppConfigGlobal, 'trialHours' | 'landingTrialTitle' | 'landingTrialBody'>
): { title: string; body: string } {
  const title =
    config.landingTrialTitle.trim() ||
    `Experimente ${formatTrialHoursLabel(config.trialHours)} grátis`;
  const body =
    config.landingTrialBody.trim() ||
    `Você usa todos os recursos durante ${formatTrialDurationPhrase(config.trialHours)}, sem cartão e sem cobrança automática. Ao final do teste, você escolhe o plano ideal para continuar com os envios liberados.`;
  return { title, body };
}
