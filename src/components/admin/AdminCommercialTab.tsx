import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppConfig } from '../../context/AppConfigContext';
import { useAuth } from '../../context/AuthContext';
import {
  LANDING_TRIAL_BODY_MAX_CHARS,
  LANDING_TRIAL_TITLE_MAX_CHARS
} from '../../constants/landingTrialLimits';
import { resolveLandingTrialCopy } from '../../utils/landingTrialResolved';
import { apiUrl } from '../../utils/apiBase';
import {
  fetchServerBillingPrices,
  parseMarketingPriceBRL,
  type ServerBillingPrices
} from '../../utils/marketingPrices';
import {
  describeTrialHoursImpact,
  MARKETING_PRICE_MAX_CHARS,
  parseTrialHoursInput,
  RECOMMENDED_TRIAL_HOURS,
  sanitizeMarketingPriceLabel,
  validateCommercialConfigPartial
} from '../../../shared/commercialConfigValidation';
import { Badge, Button, Card, CardHeader, SectionHeader } from '../ui';

const SAVE_TOAST_ID = 'commercial-config-save';
const NET_TOAST_ID = 'commercial-config-net';

type Props = {
  onOpenRevenueTab?: () => void;
};

type FieldErrors = Partial<
  Record<
    'marketingPriceMonthly' | 'marketingPriceAnnual' | 'trialHours' | 'landingTrialTitle' | 'landingTrialBody' | 'form',
    string
  >
>;

const toPtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

function snapshotFromConfig(c: {
  marketingPriceMonthly: string;
  marketingPriceAnnual: string;
  trialHours: number;
  landingTrialTitle: string;
  landingTrialBody: string;
}) {
  return {
    marketingPriceMonthly: c.marketingPriceMonthly,
    marketingPriceAnnual: c.marketingPriceAnnual,
    trialHours: String(c.trialHours),
    landingTrialTitle: c.landingTrialTitle,
    landingTrialBody: c.landingTrialBody
  };
}

export const AdminCommercialTab: React.FC<Props> = ({ onOpenRevenueTab }) => {
  const { user } = useAuth();
  const { config, reload } = useAppConfig();

  const [baseline, setBaseline] = useState(() => snapshotFromConfig(config));
  const [marketingPriceMonthly, setMarketingPriceMonthly] = useState(config.marketingPriceMonthly);
  const [marketingPriceAnnual, setMarketingPriceAnnual] = useState(config.marketingPriceAnnual);
  const [trialHours, setTrialHours] = useState(String(config.trialHours));
  const [landingTrialTitle, setLandingTrialTitle] = useState(config.landingTrialTitle);
  const [landingTrialBody, setLandingTrialBody] = useState(config.landingTrialBody);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [mpPrices, setMpPrices] = useState<ServerBillingPrices | null>(null);
  const [mpLoading, setMpLoading] = useState(true);
  const [metaUpdatedAt, setMetaUpdatedAt] = useState<string | undefined>(config.commercialUpdatedAt);
  const [metaUpdatedBy, setMetaUpdatedBy] = useState<string | undefined>(config.commercialUpdatedBy);

  const syncFromConfig = useCallback(
    (c: typeof config) => {
      const snap = snapshotFromConfig(c);
      setBaseline(snap);
      setMarketingPriceMonthly(snap.marketingPriceMonthly);
      setMarketingPriceAnnual(snap.marketingPriceAnnual);
      setTrialHours(snap.trialHours);
      setLandingTrialTitle(snap.landingTrialTitle);
      setLandingTrialBody(snap.landingTrialBody);
      setMetaUpdatedAt(c.commercialUpdatedAt);
      setMetaUpdatedBy(c.commercialUpdatedBy);
      setFieldErrors({});
      setTouched({});
    },
    []
  );

  useEffect(() => {
    syncFromConfig(config);
  }, [config, syncFromConfig]);

  const loadAdminMeta = useCallback(async () => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/admin/app-config'), {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data?.config) {
        const c = data.config as typeof config;
        setMetaUpdatedAt(c.commercialUpdatedAt);
        setMetaUpdatedBy(c.commercialUpdatedBy);
      }
    } catch {
      /* meta opcional */
    }
  }, [user]);

  const loadMpPrices = useCallback(async () => {
    setMpLoading(true);
    try {
      const p = await fetchServerBillingPrices();
      setMpPrices(p);
    } finally {
      setMpLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAdminMeta();
    void loadMpPrices();
  }, [loadAdminMeta, loadMpPrices]);

  const parsedTrialHours = useMemo(() => {
    const th = parseTrialHoursInput(trialHours);
    return th ?? 1;
  }, [trialHours]);

  const landingTrialPreview = useMemo(
    () =>
      resolveLandingTrialCopy({
        trialHours: parsedTrialHours,
        landingTrialTitle,
        landingTrialBody
      }),
    [parsedTrialHours, landingTrialTitle, landingTrialBody]
  );

  const isDirty = useMemo(() => {
    const cur = {
      marketingPriceMonthly,
      marketingPriceAnnual,
      trialHours,
      landingTrialTitle,
      landingTrialBody
    };
    return JSON.stringify(cur) !== JSON.stringify(baseline);
  }, [baseline, marketingPriceAnnual, marketingPriceMonthly, landingTrialBody, landingTrialTitle, trialHours]);

  const clientValidation = useMemo((): FieldErrors => {
    const errs: FieldErrors = {};
    if (touched.trialHours || isDirty) {
      if (parseTrialHoursInput(trialHours) == null) {
        errs.trialHours = 'Use um número inteiro entre 1 e 168.';
      }
    }
    if (marketingPriceMonthly.length > MARKETING_PRICE_MAX_CHARS) {
      errs.marketingPriceMonthly = `Máximo ${MARKETING_PRICE_MAX_CHARS} caracteres.`;
    }
    if (marketingPriceAnnual.length > MARKETING_PRICE_MAX_CHARS) {
      errs.marketingPriceAnnual = `Máximo ${MARKETING_PRICE_MAX_CHARS} caracteres.`;
    }
    if (landingTrialTitle.length > LANDING_TRIAL_TITLE_MAX_CHARS) {
      errs.landingTrialTitle = `Máximo ${LANDING_TRIAL_TITLE_MAX_CHARS} caracteres.`;
    }
    if (landingTrialBody.length > LANDING_TRIAL_BODY_MAX_CHARS) {
      errs.landingTrialBody = `Máximo ${LANDING_TRIAL_BODY_MAX_CHARS} caracteres.`;
    }
    return errs;
  }, [
    isDirty,
    landingTrialBody.length,
    landingTrialTitle.length,
    marketingPriceAnnual.length,
    marketingPriceMonthly.length,
    touched.trialHours,
    trialHours
  ]);

  const displayErrors = { ...clientValidation, ...fieldErrors };
  const hasBlockingErrors = Object.keys(displayErrors).length > 0;

  const marketingMismatch = useMemo(() => {
    if (!mpPrices) return null;
    const m = parseMarketingPriceBRL(marketingPriceMonthly);
    const a = parseMarketingPriceBRL(marketingPriceAnnual);
    const warnM = m != null && Math.abs(m - mpPrices.monthly) > 0.02;
    const warnA = a != null && Math.abs(a - mpPrices.annual) > 0.02;
    if (!warnM && !warnA) return null;
    return { warnM, warnA };
  }, [marketingPriceAnnual, marketingPriceMonthly, mpPrices]);

  const trialShortWarning =
    parsedTrialHours === 1 || (parsedTrialHours < RECOMMENDED_TRIAL_HOURS && parsedTrialHours > 1);

  const revert = () => {
    setMarketingPriceMonthly(baseline.marketingPriceMonthly);
    setMarketingPriceAnnual(baseline.marketingPriceAnnual);
    setTrialHours(baseline.trialHours);
    setLandingTrialTitle(baseline.landingTrialTitle);
    setLandingTrialBody(baseline.landingTrialBody);
    setFieldErrors({});
    setTouched({});
  };

  const save = async () => {
    if (!user) return;
    setTouched({
      trialHours: true,
      marketingPriceMonthly: true,
      marketingPriceAnnual: true,
      landingTrialTitle: true,
      landingTrialBody: true
    });

    const payload = {
      marketingPriceMonthly: sanitizeMarketingPriceLabel(marketingPriceMonthly),
      marketingPriceAnnual: sanitizeMarketingPriceLabel(marketingPriceAnnual),
      trialHours: trialHours.trim(),
      landingTrialTitle,
      landingTrialBody
    };
    const validated = validateCommercialConfigPartial(payload);
    if (validated.ok === false) {
      setFieldErrors(validated.errors);
      toast.error(
        validated.errors.form ||
          validated.errors.trialHours ||
          'Corrija os campos destacados antes de publicar.',
        { id: SAVE_TOAST_ID }
      );
      return;
    }
    if (hasBlockingErrors) {
      toast.error('Corrija os campos destacados antes de publicar.', { id: SAVE_TOAST_ID });
      return;
    }

    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/admin/app-config'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify(validated.data)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const apiErrors = data?.fieldErrors as FieldErrors | undefined;
        if (apiErrors) setFieldErrors(apiErrors);
        toast.error(typeof data?.error === 'string' ? data.error : 'Falha ao salvar.', { id: SAVE_TOAST_ID });
        return;
      }
      toast.success('Configuração comercial publicada. Clientes veem na próxima leitura (~15s no servidor).', {
        id: SAVE_TOAST_ID
      });
      if (data.config) {
        syncFromConfig({ ...config, ...data.config });
      }
      await reload();
      void loadAdminMeta();
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.', { id: NET_TOAST_ID });
    } finally {
      setSaving(false);
    }
  };

  const mpDisplayMonthly =
    mpPrices?.displayMonthly ?? (mpPrices ? mpPrices.monthly.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
  const mpDisplayAnnual =
    mpPrices?.displayAnnual ?? (mpPrices ? mpPrices.annual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <SectionHeader
        eyebrow="Comercial"
        title="Exibição comercial e trial"
        description="Textos de preço (marketing), duração do teste grátis e bloco da landing. Publicação leva alguns segundos para replicar no app e na API de trial."
        icon={<TrendingUp className="w-5 h-5 text-emerald-500" />}
        actions={
          <>
            {isDirty ? (
              <Badge variant="warning" className="!text-[11px]">
                Alterações não publicadas
              </Badge>
            ) : (
              <Badge variant="success" className="!text-[11px]">
                Sincronizado
              </Badge>
            )}
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={!isDirty || saving}
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={revert}
            >
              Descartar
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={saving || !isDirty || hasBlockingErrors}
              loading={saving}
              leftIcon={saving ? undefined : <Save className="w-3.5 h-3.5" />}
              onClick={() => void save()}
            >
              Salvar e publicar
            </Button>
          </>
        }
      />

      {(metaUpdatedAt || metaUpdatedBy) && (
        <p className="text-xs -mt-2" style={{ color: 'var(--text-3)' }}>
          Última publicação: {toPtDateTime(metaUpdatedAt)}
          {metaUpdatedBy ? ` · ${metaUpdatedBy}` : ''}
          {!metaUpdatedAt && metaUpdatedBy ? ` · por ${metaUpdatedBy}` : ''}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Preços (marketing)"
            subtitle="O que o cliente lê no upgrade. Vazio usa fallback do front. Não altera cobrança no Mercado Pago."
            icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
          />
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="ui-eyebrow text-[10px]">Mensal (texto livre)</label>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {marketingPriceMonthly.length}/{MARKETING_PRICE_MAX_CHARS}
                </span>
              </div>
              <input
                className={`ui-input mt-1 ${displayErrors.marketingPriceMonthly ? 'ring-2 ring-red-500/40' : ''}`}
                value={marketingPriceMonthly}
                maxLength={MARKETING_PRICE_MAX_CHARS}
                onChange={(e) => setMarketingPriceMonthly(sanitizeMarketingPriceLabel(e.target.value))}
                onBlur={() => setTouched((t) => ({ ...t, marketingPriceMonthly: true }))}
                placeholder="Ex.: R$ 49,90 / mês"
              />
              {displayErrors.marketingPriceMonthly ? (
                <p className="text-[11px] mt-1 text-red-500">{displayErrors.marketingPriceMonthly}</p>
              ) : null}
              {marketingMismatch?.warnM ? (
                <p className="text-[11px] mt-1 flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Valor numérico difere do preço real MP ({mpDisplayMonthly}).
                </p>
              ) : null}
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="ui-eyebrow text-[10px]">Anual (texto livre)</label>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {marketingPriceAnnual.length}/{MARKETING_PRICE_MAX_CHARS}
                </span>
              </div>
              <input
                className={`ui-input mt-1 ${displayErrors.marketingPriceAnnual ? 'ring-2 ring-red-500/40' : ''}`}
                value={marketingPriceAnnual}
                maxLength={MARKETING_PRICE_MAX_CHARS}
                onChange={(e) => setMarketingPriceAnnual(sanitizeMarketingPriceLabel(e.target.value))}
                onBlur={() => setTouched((t) => ({ ...t, marketingPriceAnnual: true }))}
                placeholder="Ex.: R$ 479,90 / ano"
              />
              {displayErrors.marketingPriceAnnual ? (
                <p className="text-[11px] mt-1 text-red-500">{displayErrors.marketingPriceAnnual}</p>
              ) : null}
              {marketingMismatch?.warnA ? (
                <p className="text-[11px] mt-1 flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Valor numérico difere do preço real MP ({mpDisplayAnnual}).
                </p>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Mercado Pago (cobrança real)"
            subtitle="Somente leitura — checkout e MRR usam estes valores."
            icon={<CircleDollarSign className="w-4 h-4 text-sky-600" />}
          />
          <div className="mt-4 space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {mpLoading ? (
              <div className="flex items-center gap-2 py-2" style={{ color: 'var(--text-3)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando preços MP…
              </div>
            ) : mpPrices ? (
              <>
                <p>
                  Plano mensal: <strong>{mpDisplayMonthly}</strong>
                </p>
                <p>
                  Plano anual: <strong>{mpDisplayAnnual}</strong>
                </p>
                <p className="text-xs pt-1" style={{ color: 'var(--text-3)' }}>
                  Compare com os textos de marketing à esquerda para evitar promessas diferentes do checkout.
                </p>
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                API de preços indisponível. Confira a aba Ganhos ou variáveis MP no servidor.
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="secondary" size="sm" type="button" disabled={mpLoading} onClick={() => void loadMpPrices()}>
                Atualizar MP
              </Button>
              {onOpenRevenueTab ? (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
                  onClick={onOpenRevenueTab}
                >
                  Ver em Ganhos
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Janela de teste"
            subtitle="1—168 h · aplicada em POST /api/billing/trial/start (sem alterar a rota)."
            icon={<Clock3 className="w-4 h-4 text-sky-600" />}
          />
          <div className="mt-4 space-y-3">
            <div>
              <label className="ui-eyebrow text-[10px]">Duração (horas)</label>
              <input
                type="number"
                min={1}
                max={168}
                step={1}
                className={`ui-input mt-1 max-w-[200px] ${displayErrors.trialHours ? 'ring-2 ring-red-500/40' : ''}`}
                value={trialHours}
                onChange={(e) => setTrialHours(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, trialHours: true }))}
              />
              {displayErrors.trialHours ? (
                <p className="text-[11px] mt-1 text-red-500">{displayErrors.trialHours}</p>
              ) : null}
            </div>
            {trialShortWarning ? (
              <div
                className="rounded-lg border px-3 py-2.5 text-[12px] flex gap-2"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
              >
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <div style={{ color: 'var(--text-2)' }}>
                  {parsedTrialHours === 1 ? (
                    <>
                      <strong className="text-amber-600 dark:text-amber-400">1 hora</strong> é curto para onboarding
                      completo. Recomendado: {RECOMMENDED_TRIAL_HOURS}h ou mais.
                    </>
                  ) : (
                    <>
                      Abaixo de {RECOMMENDED_TRIAL_HOURS}h pode limitar conversão. Valor atual:{' '}
                      <strong>{parsedTrialHours}h</strong>.
                    </>
                  )}
                </div>
              </div>
            ) : null}
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {describeTrialHoursImpact(parsedTrialHours)}
            </p>
          </div>
        </Card>

        <Card className="lg:row-span-2">
          <CardHeader
            title="Landing — bloco de teste grátis"
            subtitle={`Opcional; máx. ${LANDING_TRIAL_TITLE_MAX_CHARS} / ${LANDING_TRIAL_BODY_MAX_CHARS} caracteres. Eventos GA4: landing_cta_click, trial_started, etc.`}
            icon={<Sparkles className="w-4 h-4 text-amber-600" />}
          />
          <div className="mt-4 space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="ui-eyebrow text-[10px]">Título</label>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {landingTrialTitle.length}/{LANDING_TRIAL_TITLE_MAX_CHARS}
                </span>
              </div>
              <input
                className={`ui-input mt-1 ${displayErrors.landingTrialTitle ? 'ring-2 ring-red-500/40' : ''}`}
                value={landingTrialTitle}
                maxLength={LANDING_TRIAL_TITLE_MAX_CHARS}
                onChange={(e) => setLandingTrialTitle(e.target.value)}
                placeholder="Vazio = título automático a partir das horas"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="ui-eyebrow text-[10px]">Texto</label>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {landingTrialBody.length}/{LANDING_TRIAL_BODY_MAX_CHARS}
                </span>
              </div>
              <textarea
                rows={4}
                maxLength={LANDING_TRIAL_BODY_MAX_CHARS}
                className={`ui-input mt-1 resize-y min-h-[100px] ${displayErrors.landingTrialBody ? 'ring-2 ring-red-500/40' : ''}`}
                value={landingTrialBody}
                onChange={(e) => setLandingTrialBody(e.target.value)}
                placeholder="Vazio = texto padrão da landing"
              />
            </div>
            <div
              className="rounded-xl border p-4 space-y-2"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Pré-visualização (atualiza ao digitar)
              </p>
              <p className="text-[13px] font-bold leading-snug" style={{ color: 'var(--text-1)' }}>
                {landingTrialPreview.title}
              </p>
              <p className="text-[12px] leading-relaxed font-medium whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
                {landingTrialPreview.body}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div
        className="sticky bottom-0 z-10 -mx-2 sm:mx-0 px-3 py-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 backdrop-blur-md"
        style={{ borderColor: 'var(--border-subtle)', background: 'color-mix(in srgb, var(--surface-0) 88%, transparent)' }}
      >
        <p className="text-xs max-w-xl" style={{ color: 'var(--text-3)' }}>
          Após publicar, valide o modal Pro e a landing. Trial existente não muda — só novos POST /api/billing/trial/start.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" type="button" disabled={!isDirty || saving} onClick={revert}>
            Descartar
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            disabled={saving || !isDirty || hasBlockingErrors}
            loading={saving}
            leftIcon={saving ? undefined : <Save className="w-3.5 h-3.5" />}
            onClick={() => void save()}
          >
            Salvar e publicar
          </Button>
        </div>
      </div>
    </div>
  );
};
