/** Limites alinhados ao servidor (`mergeAppConfigPartial` em appConfigStore). */
export const LANDING_TRIAL_TITLE_MAX_CHARS = 120;
export const LANDING_TRIAL_BODY_MAX_CHARS = 600;

export function clampLandingTrialTitle(s: string): string {
  return s.slice(0, LANDING_TRIAL_TITLE_MAX_CHARS);
}

export function clampLandingTrialBody(s: string): string {
  return s.slice(0, LANDING_TRIAL_BODY_MAX_CHARS);
}
