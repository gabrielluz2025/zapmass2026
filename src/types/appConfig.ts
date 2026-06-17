/** Documento Firestore `appConfig/global` + resposta de GET /api/app-config (valores vazios = usar fallback no cliente). */
export type SystemAnnouncementKind = 'info' | 'warning' | 'error';

export type SystemAnnouncement = {
  active: boolean;
  title: string;
  body: string;
  kind: SystemAnnouncementKind;
  showBanner: boolean;
  updatedAt: string;
  expiresAt: string | null;
  publishedBy?: string;
};

export interface AppConfigGlobal {
  marketingPriceMonthly: string;
  marketingPriceAnnual: string;
  /** Duracao do teste gratuito (servidor e textos). Entre 1 e 168. */
  trialHours: number;
  /** Se vazio, o cliente monta titulo a partir de `trialHours`. */
  landingTrialTitle: string;
  /** Se vazio, o cliente usa texto padrao da landing. */
  landingTrialBody: string;
  /** Aviso global (manutenção, etc.) — visível a todos os utilizadores. */
  systemAnnouncement?: SystemAnnouncement | null;
}

export const DEFAULT_APP_CONFIG: AppConfigGlobal = {
  marketingPriceMonthly: '',
  marketingPriceAnnual: '',
  trialHours: 1,
  landingTrialTitle: '',
  landingTrialBody: '',
  systemAnnouncement: null
};
