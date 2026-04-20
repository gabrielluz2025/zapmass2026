/** Documento Firestore `appConfig/global` + resposta de GET /api/app-config (valores vazios = usar fallback no cliente). */
export interface AppConfigGlobal {
  marketingPriceMonthly: string;
  marketingPriceAnnual: string;
  /** Duracao do teste gratuito (servidor e textos). Entre 1 e 168. */
  trialHours: number;
  /** Se vazio, o cliente monta titulo a partir de `trialHours`. */
  landingTrialTitle: string;
  /** Se vazio, o cliente usa texto padrao da landing. */
  landingTrialBody: string;
}

export const DEFAULT_APP_CONFIG: AppConfigGlobal = {
  marketingPriceMonthly: '',
  marketingPriceAnnual: '',
  trialHours: 1,
  landingTrialTitle: '',
  landingTrialBody: ''
};
