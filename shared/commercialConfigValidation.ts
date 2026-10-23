/** Alinhado a `src/constants/landingTrialLimits.ts` e `appConfigStore`. */
export const LANDING_TRIAL_TITLE_MAX_CHARS = 120;
export const LANDING_TRIAL_BODY_MAX_CHARS = 600;

/** Horas de trial sugeridas para conversão (alerta abaixo disso, exceto 1h). */
export const RECOMMENDED_TRIAL_HOURS = 24;

export const MARKETING_PRICE_MAX_CHARS = 80;

const CTRL_RE = /[\u0000-\u001F\u007F]/g;

export type CommercialConfigFields = {
  marketingPriceMonthly: string;
  marketingPriceAnnual: string;
  trialHours: number;
  landingTrialTitle: string;
  landingTrialBody: string;
};

export type CommercialConfigValidationResult =
  | { ok: true; data: CommercialConfigFields }
  | { ok: false; errors: Partial<Record<keyof CommercialConfigFields | 'form', string>> };

export function sanitizeMarketingPriceLabel(raw: string): string {
  let s = String(raw ?? '')
    .replace(CTRL_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > MARKETING_PRICE_MAX_CHARS) {
    s = s.slice(0, MARKETING_PRICE_MAX_CHARS);
  }
  return s;
}

export function clampTrialHoursInput(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const r = Math.round(n);
  if (r < 1) return 1;
  if (r > 168) return 168;
  return r;
}

export function parseTrialHoursInput(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? clampTrialHoursInput(raw) : null;
  }
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return clampTrialHoursInput(n);
}

function clampLandingStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export type CommercialConfigPutInput = {
  marketingPriceMonthly?: string;
  marketingPriceAnnual?: string;
  trialHours?: number | string;
  landingTrialTitle?: string;
  landingTrialBody?: string;
};

export function validateCommercialConfigPartial(
  partial: CommercialConfigPutInput
): CommercialConfigValidationResult {
  const errors: Partial<Record<keyof CommercialConfigFields | 'form', string>> = {};
  const data: Partial<CommercialConfigFields> = {};

  if (partial.marketingPriceMonthly !== undefined) {
    data.marketingPriceMonthly = sanitizeMarketingPriceLabel(partial.marketingPriceMonthly);
  }
  if (partial.marketingPriceAnnual !== undefined) {
    data.marketingPriceAnnual = sanitizeMarketingPriceLabel(partial.marketingPriceAnnual);
  }

  if (partial.trialHours !== undefined) {
    const th = parseTrialHoursInput(partial.trialHours);
    if (th == null) {
      errors.trialHours = 'Informe entre 1 e 168 horas.';
    } else {
      data.trialHours = th;
    }
  }

  if (partial.landingTrialTitle !== undefined) {
    const t = clampLandingStr(String(partial.landingTrialTitle).replace(CTRL_RE, ''), LANDING_TRIAL_TITLE_MAX_CHARS);
    data.landingTrialTitle = t;
  }
  if (partial.landingTrialBody !== undefined) {
    const b = clampLandingStr(String(partial.landingTrialBody).replace(CTRL_RE, ''), LANDING_TRIAL_BODY_MAX_CHARS);
    data.landingTrialBody = b;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, errors: { form: 'Nenhum campo válido para salvar.' } };
  }
  return { ok: true, data: data as CommercialConfigFields };
}

/** Texto de impacto exibido no painel ao alterar horas de trial. */
export function describeTrialHoursImpact(hours: number): string {
  const h = clampTrialHoursInput(hours);
  if (h === 1) {
    return 'Com 1 hora, novos testes expiram rápido — útil para demos, mas pode reduzir conversão na landing e no gate Pro.';
  }
  if (h < RECOMMENDED_TRIAL_HOURS) {
    return `Com ${h} horas, o cliente tem menos tempo para conectar WhatsApp e rodar campanhas antes do gate. Recomendado: ${RECOMMENDED_TRIAL_HOURS}h ou mais.`;
  }
  if (h >= 72) {
    return `Com ${h} horas (${Math.round(h / 24)} dias), o teste cobre vários dias úteis — alinha com POST /api/billing/trial/start e textos automáticos da landing.`;
  }
  return `Novos testes via POST /api/billing/trial/start duram ${h} horas; modais Pro e landing usam os mesmos textos após publicar (~15s de cache).`;
}
