import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  Crown,
  FileText,
  Loader2,
  Repeat,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  XCircle,
  Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { firestoreTimeToMs } from '../../utils/firestoreTime';
import { UpgradeProModal } from './UpgradeProModal';
import { readAndClearChannelExtrasScrollFlag } from '../../utils/openChannelExtraFlow';
import { FALLBACK_MARKETING_LABEL_ANNUAL, FALLBACK_MARKETING_LABEL_MONTHLY, fetchServerBillingPrices } from '../../utils/marketingPrices';
import { redirectToMercadoPagoCheckout } from '../../utils/mercadopagoCheckout';
import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  brl
} from '../../constants/channelTierPricing';
import type { UserSubscription } from '../../types';
import { apiUrl } from '../../utils/apiBase';
import { formatMercadoPagoCheckoutError } from '../../utils/mercadopagoCheckoutError';

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card' | 'recurring';
type ChannelTier = 1 | 2 | 3 | 4 | 5;

function tierPrice(channels: ChannelTier, plan: Plan): number {
  return plan === 'annual'
    ? CHANNEL_TIER_PRICES_ANNUAL[channels]
    : CHANNEL_TIER_PRICES_MONTHLY[channels];
}

function formatDate(ms: number | null): string {
  if (ms == null) return '—';
  return new Date(ms).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function daysUntil(ms: number | null): number | null {
  if (ms == null) return null;
  return Math.ceil((ms - Date.now()) / (1000 * 60 * 60 * 24));
}

/** Corrige docs antigos sem `status` ou com `none` quando ainda há período válido. */
function computeEffectiveSubscriptionStatus(sub: UserSubscription | null | undefined): string {
  if (!sub) return 'none';
  if (sub.blocked === true) return 'blocked';
  const s = sub.status;
  if (s === 'active' || s === 'trialing' || s === 'past_due' || s === 'canceled') return s;
  const trialEnd = firestoreTimeToMs(sub.trialEndsAt);
  if (trialEnd != null && trialEnd > Date.now()) return 'trialing';
  const manualEnd = firestoreTimeToMs(sub.manualAccessEndsAt);
  if (sub.manualGrant === true && (manualEnd == null || manualEnd > Date.now())) return 'active';
  if (s && s !== 'none') return s;
  return 'none';
}

function resolveProviderLabel(sub: UserSubscription | null | undefined): string {
  if (!sub) return '—';
  if (sub.mercadoPagoPreapprovalId || sub.mercadoPagoLastPaymentId) return 'Mercado Pago';
  if (sub.mercadoPagoChannelAddonPreapprovalId || sub.mercadoPagoChannelAddonOneTimePaymentId) return 'Mercado Pago';
  if (sub.infinitePayReference || sub.provider === 'infinitepay')
    return 'Pagamento legado (gateway descontinuado)';
  if (sub.provider === 'mercadopago') return 'Mercado Pago';
  if (sub.manualGrant === true) return 'Liberação manual';
  if (sub.status === 'trialing' || sub.provider === 'none') return '— (teste / sem gateway)';
  return '—';
}

function resolvePlanCycleLabel(sub: UserSubscription | null | undefined): string {
  if (!sub) return '—';
  const tier =
    typeof sub.includedChannels === 'number' && sub.includedChannels > 0
      ? `${sub.includedChannels} canal(is)`
      : null;
  if (sub.plan === 'annual') return tier ? `Anual · ${tier}` : 'Anual';
  if (sub.plan === 'monthly') return tier ? `Mensal · ${tier}` : 'Mensal';
  if (sub.status === 'trialing') return tier ? `Pro — teste gratuito · ${tier}` : 'Pro — período de teste';
  if (sub.manualGrant === true && !sub.plan) return 'Gestão manual';
  if (sub.status === 'active' || sub.status === 'past_due') {
    const n = typeof sub.includedChannels === 'number' ? sub.includedChannels : null;
    if (n != null && n > 0) return `${n} canal(is) ZapMass Pro`;
    return 'ZapMass Pro';
  }
  if (sub.manualGrant === true) return 'ZapMass Pro';
  return '—';
}

/**
 * Pagina "Minha assinatura": mostra estado atual da subscricao, dias restantes,
 * permite renovar, migrar para anual ou cancelar debito automatico.
 */
export const MySubscriptionTab: React.FC = () => {
  const { user } = useAuth();
  const { isTeamMember, ownerUid } = useWorkspace();
  const { subscription, loading } = useSubscription();
  const { config } = useAppConfig();
  const [busy, setBusy] = useState<Method | 'cancel' | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const accessEndsMs = useMemo(
    () => firestoreTimeToMs(subscription?.accessEndsAt),
    [subscription?.accessEndsAt]
  );
  const trialEndsMs = useMemo(
    () => firestoreTimeToMs(subscription?.trialEndsAt),
    [subscription?.trialEndsAt]
  );
  const manualAccessEndsMs = useMemo(
    () => firestoreTimeToMs(subscription?.manualAccessEndsAt),
    [subscription?.manualAccessEndsAt]
  );
  /** Data efetiva de fim do acesso (trial, plano ou liberação manual), alinhada ao SubscriptionContext. */
  const effectiveExpiryMs = useMemo(() => {
    if (!subscription) return null;
    if (subscription.blocked === true) return null;
    if (subscription.manualGrant === true) return manualAccessEndsMs;
    if (subscription.status === 'trialing') return trialEndsMs ?? accessEndsMs;
    return accessEndsMs;
  }, [subscription, manualAccessEndsMs, trialEndsMs, accessEndsMs]);

  const daysLeft = useMemo(() => {
    if (!subscription) return null;
    if (subscription.manualGrant === true && manualAccessEndsMs == null) return null;
    return daysUntil(effectiveExpiryMs);
  }, [subscription, manualAccessEndsMs, effectiveExpiryMs]);

  const effectiveStatus = useMemo(() => computeEffectiveSubscriptionStatus(subscription), [subscription]);

  const expiryInfoLabel =
    subscription?.manualGrant === true && manualAccessEndsMs == null ? 'Acesso' : 'Expira em';
  const expiryInfoValue =
    subscription?.manualGrant === true && manualAccessEndsMs == null
      ? 'Manual (sem data)'
      : formatDate(effectiveExpiryMs);
  const isRecurring = Boolean(
    subscription?.mercadoPagoPreapprovalId && effectiveStatus === 'active'
  );

  /** Nível de canais contratado (1–5): alinha a seleção de checkout ao plano atual. */
  const contractedChannels = useMemo(
    (): ChannelTier =>
      Math.max(
        1,
        Math.min(
          5,
          Math.floor(
            Number(subscription?.includedChannels) ||
              (2 + Math.max(0, Math.floor(Number(subscription?.extraChannelSlots) || 0)))
          )
        )
      ) as ChannelTier,
    [subscription?.includedChannels, subscription?.extraChannelSlots]
  );

  const contractedChannelsBumpRef = useRef<number | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<ChannelTier>(2);
  const [tierBusy, setTierBusy] = useState<null | 'pix' | 'card'>(null);
  const [tierPlanMode, setTierPlanMode] = useState<Plan>('monthly');
  const [serverProLabels, setServerProLabels] = useState<{
    monthly: string;
    annual: string;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    fetchServerBillingPrices().then((p) => {
      if (!alive || !p) return;
      if (p.displayMonthly && p.displayAnnual) {
        setServerProLabels({ monthly: p.displayMonthly, annual: p.displayAnnual });
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (loading) return;
    if (!readAndClearChannelExtrasScrollFlag()) return;
    const t = requestAnimationFrame(() => {
      document.getElementById('canais-extras-whatsapp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(t);
  }, [loading]);

  /**
   * A seleção padrão era 2; se o plano já cobre mais canais, isDowngradeSelection desativava o checkout sem aviso óbvio.
   * Sobe o alvo quando a assinatura carrega ou quando os canais contratados aumentam (ex.: trial → pago).
   */
  useEffect(() => {
    if (loading) return;
    const cc = contractedChannels;
    const prev = contractedChannelsBumpRef.current;
    contractedChannelsBumpRef.current = cc;
    if (prev === null || cc > prev) {
      setUpgradeTarget((t) => Math.max(t, cc) as ChannelTier);
    }
  }, [loading, contractedChannels]);

  const cancelRecurring = async () => {
    if (!user) return;
    if (!window.confirm('Cancelar o débito automático? Seu acesso continua até a data de expiração atual.')) return;
    setBusy('cancel');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/billing/mercadopago/cancel-subscription'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Erro ao cancelar.');
        return;
      }
      toast.success('Débito automático cancelado. Seu acesso continua até a expiração.');
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setBusy(null);
    }
  };

  const startChannelTierPlan = async (method: 'pix' | 'card', channels: ChannelTier, plan: Plan) => {
    if (!user) return;
    setTierBusy(method);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/billing/mercadopago/channel-plan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ method, channels, plan })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(formatMercadoPagoCheckoutError(typeof data?.error === 'string' ? data.error : undefined));
        return;
      }
      if (data.init_point) {
        redirectToMercadoPagoCheckout(String(data.init_point));
        return;
      }
      toast.error('Resposta do servidor sem link de checkout.');
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setTierBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-3)' }} />
      </div>
    );
  }

  if (isTeamMember) {
    const short = typeof ownerUid === 'string' && ownerUid.length > 10 ? `${ownerUid.slice(0, 8)}…` : ownerUid || '—';
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <div className="flex items-start gap-3 rounded-2xl p-5" style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center brand-soft shrink-0">
            <Users className="w-6 h-6" style={{ color: 'var(--brand-600)' }} />
          </div>
          <div>
            <h1 className="text-[17px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              Membro de equipa
            </h1>
            <p className="text-[13px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Esta sessão usa o <strong>plano e os dados da conta principal</strong> da organização. Pagamentos,
              Mercado Pago ou alteração de canais ficam{' '}
              <strong>a cargo do utilizador gestor</strong>{' '}
              <span className="font-mono text-[12px]">({short})</span>. Aqui apenas consulta o estado do plano ligado ao
              workspace — não iniciamos cobrança com o seu utilizador para evitar erro de cobrança.
            </p>
          </div>
        </div>
        {subscription && (
          <div className="rounded-xl px-4 py-3 text-[12px] space-y-1" style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}>
            <p>
              <strong style={{ color: 'var(--text-1)' }}>Situação: </strong>
              {computeEffectiveSubscriptionStatus(subscription)}
            </p>
            <p>
              <strong style={{ color: 'var(--text-1)' }}>Plano: </strong>
              {resolvePlanCycleLabel(subscription)} · <strong style={{ color: 'var(--text-1)' }}>Via: </strong>
              {resolveProviderLabel(subscription)}
            </p>
          </div>
        )}
      </div>
    );
  }

  const priceMonthly =
    serverProLabels?.monthly ||
    (config.marketingPriceMonthly.trim() || FALLBACK_MARKETING_LABEL_MONTHLY);
  const priceAnnual =
    serverProLabels?.annual || (config.marketingPriceAnnual.trim() || FALLBACK_MARKETING_LABEL_ANNUAL);

  /** Migração mensal → anual (Pix) com o mesmo número de canais contratado. */
  const migrateToAnnualPix = async () => {
    if (!user) return;
    setBusy('pix');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/billing/mercadopago/channel-plan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ plan: 'annual', method: 'pix', channels: contractedChannels })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(formatMercadoPagoCheckoutError(typeof data?.error === 'string' ? data.error : undefined));
        return;
      }
      if (data.init_point) {
        redirectToMercadoPagoCheckout(String(data.init_point));
        return;
      }
      toast.error('Resposta do servidor sem link de checkout.');
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setBusy(null);
    }
  };

  const selectedTierPrice = tierPrice(upgradeTarget, tierPlanMode);
  const contractedTierPrice = tierPrice(contractedChannels, tierPlanMode);
  const monthlyDiff = Math.max(0, selectedTierPrice - contractedTierPrice);
  const prorataHalf = monthlyDiff / 2;

  const statusLabel = getStatusLabel(effectiveStatus, daysLeft, trialEndsMs);
  const providerLabel = resolveProviderLabel(subscription);
  const planLabel = resolvePlanCycleLabel(subscription);

  const planSnapshotLine = useMemo(() => {
    if (!subscription) return '—';
    if (subscription.status === 'trialing') {
      return `Pro em teste · ${contractedChannels} canal(is) incluído(s) neste período`;
    }
    if (subscription.status === 'active' || subscription.status === 'past_due') {
      const cycle =
        subscription.plan === 'annual' ? 'Ciclo anual' : subscription.plan === 'monthly' ? 'Ciclo mensal' : 'Ciclo pago';
      return `${cycle} · ${contractedChannels} canal(is) contratado(s)`;
    }
    return planLabel;
  }, [subscription, contractedChannels, planLabel]);

  const isDowngradeSelection = upgradeTarget < contractedChannels;

  const totalCycleDays = subscription?.plan === 'annual' ? 365 : 30;
  const progressPct =
    daysLeft != null && daysLeft >= 0
      ? Math.max(4, Math.min(100, Math.round((daysLeft / totalCycleDays) * 100)))
      : null;
  const annualSavingsLabel = (() => {
    const m = CHANNEL_TIER_PRICES_MONTHLY[contractedChannels] * 12;
    const a = CHANNEL_TIER_PRICES_ANNUAL[contractedChannels];
    if (m <= 0 || a <= 0) return null;
    const pct = Math.round((1 - a / m) * 100);
    return pct > 0 ? `Economize ${pct}%` : null;
  })();
  const showRenewCta = subscription?.status === 'active' || subscription?.status === 'past_due';
  const heroAccent = statusLabel.color;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
            boxShadow: '0 8px 22px rgba(245,158,11,0.3)'
          }}
        >
          <Crown className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-[20px] font-extrabold" style={{ color: 'var(--text-1)' }}>
            Minha assinatura
          </h1>
          <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
            Veja seu plano, pague em segundos e contrate mais canais quando precisar.
          </p>
        </div>
      </header>

      {/* HERO STATUS — visão clara do plano + 1 CTA principal */}
      <section
        className="relative overflow-hidden rounded-2xl px-5 py-5"
        style={{
          background:
            'linear-gradient(135deg, color-mix(in srgb, ' +
            heroAccent +
            ' 14%, var(--surface-0)) 0%, var(--surface-0) 65%)',
          border: '1px solid var(--border)',
          boxShadow: '0 8px 28px color-mix(in srgb, ' + heroAccent + ' 18%, transparent)'
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 w-56 h-56 rounded-full opacity-30 blur-3xl"
          style={{ background: heroAccent }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px]">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider"
              style={{
                background: 'color-mix(in srgb, ' + heroAccent + ' 18%, transparent)',
                color: heroAccent,
                border: '1px solid color-mix(in srgb, ' + heroAccent + ' 35%, transparent)'
              }}
            >
              <Sparkles className="w-3 h-3" />
              {statusLabel.text}
            </span>
            <p
              className="text-[24px] sm:text-[26px] font-extrabold mt-2 leading-tight"
              style={{ color: 'var(--text-1)' }}
            >
              {planSnapshotLine}
            </p>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-2)' }}>
              {expiryInfoLabel} <strong style={{ color: 'var(--text-1)' }}>{expiryInfoValue}</strong>
              {statusLabel.sub ? (
                <>
                  {' · '}
                  <span>{statusLabel.sub}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {subscription?.plan !== 'annual' && (
              <Action
                onClick={() => void migrateToAnnualPix()}
                loading={busy === 'pix'}
                disabled={!!busy}
                icon={<TrendingUp className="w-4 h-4" />}
                primary
                label="Pagar 1 ano (Pix −5%)"
                hint={annualSavingsLabel ? `${annualSavingsLabel} vs mensal` : 'Soma os dias que faltam'}
              />
            )}
            <Action
              onClick={() => {
                if (showRenewCta) {
                  document
                    .getElementById('canais-extras-whatsapp')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  setUpgradeOpen(true);
                }
              }}
              disabled={!!busy}
              icon={<Zap className="w-4 h-4" />}
              label={showRenewCta ? 'Renovar / mudar plano' : 'Assinar Pro'}
              hint={showRenewCta ? 'Veja os planos abaixo' : `${priceMonthly} · ${priceAnnual}`}
            />
          </div>
        </div>

        {progressPct != null && (
          <div className="relative mt-5">
            <div className="flex items-center justify-between text-[11px] mb-1.5" style={{ color: 'var(--text-3)' }}>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" />
                Tempo restante do plano
              </span>
              <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'}
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--surface-2)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  background: `linear-gradient(90deg, ${heroAccent}, color-mix(in srgb, ${heroAccent} 70%, white))`
                }}
              />
            </div>
          </div>
        )}

        <div className="relative mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px]">
          <Info icon={<Crown className="w-3.5 h-3.5" />} label="Plano" value={planLabel} />
          <Info
            icon={<Users className="w-3.5 h-3.5" />}
            label="Canais"
            value={`${contractedChannels} canal${contractedChannels === 1 ? '' : 'is'}`}
          />
          <Info icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Pagamento via" value={providerLabel} />
        </div>

        {isRecurring && (
          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-2.5"
            style={{
              background: 'rgba(59,130,246,0.10)',
              border: '1px solid rgba(59,130,246,0.30)'
            }}
          >
            <div className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
              <Repeat className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#3b82f6' }} />
              <div>
                <strong style={{ color: 'var(--text-1)' }}>Renovação automática ativa.</strong>{' '}
                Seu cartão é cobrado todo ciclo. Pode cancelar quando quiser e o acesso continua até a data atual.
              </div>
            </div>
            <button
              type="button"
              onClick={cancelRecurring}
              disabled={busy === 'cancel'}
              className="text-[12px] font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
              style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', background: 'var(--surface-1)' }}
            >
              {busy === 'cancel' ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cancelando…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5" /> Cancelar renovação
                </span>
              )}
            </button>
          </div>
        )}
      </section>

      {/* PLANOS — escolher quantidade de canais */}
      <section
        id="canais-extras-whatsapp"
        className="rounded-2xl px-5 py-5 scroll-mt-4"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
          <div>
            <h2 className="text-[18px] font-extrabold" style={{ color: 'var(--text-1)' }}>
              Escolha seu plano
            </h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Quanto mais canais, menor o custo por canal. Pague em 1 clique.
            </p>
          </div>

          {/* Toggle Mensal / Anual */}
          <div
            className="inline-flex p-1 rounded-xl"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <button
              type="button"
              onClick={() => setTierPlanMode('monthly')}
              className="px-3.5 py-1.5 text-[12px] font-bold rounded-lg transition-all"
              style={{
                background: tierPlanMode === 'monthly' ? 'var(--surface-0)' : 'transparent',
                color: tierPlanMode === 'monthly' ? 'var(--text-1)' : 'var(--text-3)',
                boxShadow: tierPlanMode === 'monthly' ? '0 2px 8px rgba(0,0,0,0.08)' : undefined
              }}
            >
              Mensal
            </button>
            <button
              type="button"
              onClick={() => setTierPlanMode('annual')}
              className="px-3.5 py-1.5 text-[12px] font-bold rounded-lg transition-all flex items-center gap-1.5"
              style={{
                background: tierPlanMode === 'annual' ? 'var(--surface-0)' : 'transparent',
                color: tierPlanMode === 'annual' ? 'var(--text-1)' : 'var(--text-3)',
                boxShadow: tierPlanMode === 'annual' ? '0 2px 8px rgba(0,0,0,0.08)' : undefined
              }}
            >
              Anual
              {annualSavingsLabel && (
                <span
                  className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md"
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff'
                  }}
                >
                  {annualSavingsLabel}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Grid de planos */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mt-4">
          {(Object.keys(CHANNEL_TIER_PRICES_MONTHLY) as unknown as Array<keyof typeof CHANNEL_TIER_PRICES_MONTHLY>).map((n) => {
            const tier = Number(n) as ChannelTier;
            const price = tierPrice(tier, tierPlanMode);
            const monthly = tierPlanMode === 'annual' ? price / 12 : price;
            const per = monthly / tier;
            const isCurrent = contractedChannels === tier;
            const isSelected = upgradeTarget === tier;
            const isPopular = tier === 3;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setUpgradeTarget(tier)}
                className="relative text-left rounded-xl p-3.5 border-2 transition-all hover:scale-[1.02]"
                style={{
                  borderColor: isSelected
                    ? '#10b981'
                    : isCurrent
                      ? '#3b82f6'
                      : 'var(--border-subtle)',
                  background: isSelected
                    ? 'linear-gradient(160deg, rgba(16,185,129,0.14), rgba(6,182,212,0.06))'
                    : 'var(--surface-1)',
                  boxShadow: isSelected ? '0 8px 22px rgba(16,185,129,0.18)' : undefined
                }}
              >
                {isPopular && !isCurrent && (
                  <span
                    className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{
                      background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
                      color: '#fff',
                      boxShadow: '0 4px 10px rgba(245,158,11,0.4)'
                    }}
                  >
                    MAIS POPULAR
                  </span>
                )}
                {isCurrent && (
                  <span
                    className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{
                      background: '#3b82f6',
                      color: '#fff'
                    }}
                  >
                    SEU PLANO
                  </span>
                )}
                <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  {tier} canal{tier > 1 ? 'is' : ''}
                </p>
                <p className="text-[22px] font-extrabold mt-1 leading-none" style={{ color: 'var(--text-1)' }}>
                  {brl(monthly)}
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
                    /mês
                  </span>
                </p>
                {tierPlanMode === 'annual' && (
                  <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {brl(price)}/ano à vista
                  </p>
                )}
                <div
                  className="h-px my-2.5 opacity-50"
                  style={{ background: 'var(--border-subtle)' }}
                />
                <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                  <Check className="inline w-3 h-3 text-emerald-500 mr-1" />
                  {brl(per)} por canal
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>
                  <Check className="inline w-3 h-3 text-emerald-500 mr-1" />
                  Disparos ilimitados
                </p>
                {tier >= 2 && (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>
                    <Check className="inline w-3 h-3 text-emerald-500 mr-1" />
                    Multi-WhatsApp
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Resumo da escolha + CTAs */}
        <div
          className="rounded-xl px-4 py-4 mt-4"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--brand-500) 8%, var(--surface-1)), var(--surface-1))',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                Sua escolha
              </p>
              <p className="text-[16px] font-extrabold mt-0.5" style={{ color: 'var(--text-1)' }}>
                {upgradeTarget} canal{upgradeTarget > 1 ? 'is' : ''} ·{' '}
                {tierPlanMode === 'annual' ? 'Anual' : 'Mensal'}
              </p>
              {!isDowngradeSelection && monthlyDiff > 0 ? (
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                  Diferença vs seu plano atual: <strong>{brl(monthlyDiff)}/mês</strong>. Você só paga proporcional ao
                  tempo que falta no ciclo.
                </p>
              ) : isDowngradeSelection ? (
                <p className="text-[11.5px] mt-0.5" style={{ color: '#f59e0b' }}>
                  Para reduzir canais durante o ciclo, fale com o suporte ou aguarde o fim do período.
                </p>
              ) : (
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                  Mesmo número de canais do plano atual.
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[26px] font-extrabold leading-none" style={{ color: 'var(--text-1)' }}>
                {brl(selectedTierPrice)}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                /{tierPlanMode === 'annual' ? 'ano' : 'mês'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void startChannelTierPlan('pix', upgradeTarget, tierPlanMode)}
              disabled={!!tierBusy || isDowngradeSelection}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[14px] font-extrabold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#fff',
                boxShadow: '0 8px 22px rgba(16,185,129,0.32)'
              }}
            >
              {tierBusy === 'pix' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Zap className="w-5 h-5" />
              )}
              <span className="flex flex-col items-start leading-tight">
                <span>Pagar com Pix</span>
                <span className="text-[10.5px] font-medium opacity-90">5% off · liberação imediata</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void startChannelTierPlan('card', upgradeTarget, tierPlanMode)}
              disabled={!!tierBusy || isDowngradeSelection}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[14px] font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'var(--surface-0)',
                color: 'var(--text-1)',
                border: '1.5px solid var(--border)'
              }}
            >
              {tierBusy === 'card' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Crown className="w-5 h-5" />
              )}
              <span className="flex flex-col items-start leading-tight">
                <span>Pagar no Cartão</span>
                <span className="text-[10.5px] font-medium" style={{ color: 'var(--text-3)' }}>
                  {tierPlanMode === 'annual' ? 'Até 12x · pode renovar todo ano' : 'Renova todo mês'}
                </span>
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3 mt-3 text-[10.5px] flex-wrap" style={{ color: 'var(--text-3)' }}>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-500" /> Pagamento seguro Mercado Pago
            </span>
            <span>·</span>
            <span>Sem fidelidade · Cancele quando quiser</span>
          </div>
        </div>
      </section>

      {/* FAQ COMPACTO */}
      <section
        className="rounded-2xl px-5 py-5"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
        <h2 className="text-[15px] font-extrabold mb-3" style={{ color: 'var(--text-1)' }}>
          Dúvidas comuns
        </h2>
        <div className="space-y-1.5">
          <FaqItem
            q="Como funciona o pagamento?"
            a={
              <>
                Você escolhe <strong>Pix</strong> (5% off, libera na hora), <strong>cartão à vista</strong> ou <strong>parcelado em até 12x</strong> no anual.
                Também há a opção de <strong>renovação automática</strong> no cartão — cobramos todo ciclo até você cancelar.
              </>
            }
          />
          <FaqItem
            q="Posso cancelar quando quiser?"
            a={
              <>
                Sim. Se está em <strong>renovação automática</strong>, basta clicar em «Cancelar renovação» no card de status — o
                acesso continua até <strong>{expiryInfoValue}</strong>. Pagamentos via Pix/cartão à vista <strong>não renovam sozinhos</strong>:
                você paga novamente antes da expiração (enviamos lembrete por e-mail).
              </>
            }
          />
          <FaqItem
            q="Migrar de Mensal para Anual: perco os dias que sobram?"
            a={
              <>
                Não. Os dias restantes do seu plano <strong>mensal são somados</strong> ao novo plano anual automaticamente. Você
                não perde nada.
              </>
            }
          />
          <FaqItem
            q="Quero mais canais agora — preciso esperar?"
            a={
              <>
                Não. Pode subir de plano a qualquer momento. Você só paga a <strong>diferença proporcional aos dias que faltam</strong>{' '}
                no ciclo (sem cobrar o mês inteiro de novo).
              </>
            }
          />
          <FaqItem
            q="E se eu quiser MENOS canais?"
            a={
              <>
                A redução é feita ao <strong>final do ciclo</strong>: aguarde a expiração e contrate o pacote menor, ou fale com o{' '}
                <strong>suporte</strong> se precisa antes.
              </>
            }
          />
        </div>
      </section>

      {subscription?.nfeLastInvoiceId && (
        <section
          className="rounded-2xl px-5 py-4"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
        >
          <h2 className="text-[14px] font-bold mb-2 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <FileText className="w-4 h-4" style={{ color: '#3b82f6' }} />
            Nota fiscal
          </h2>
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>
              <p>
                <strong style={{ color: 'var(--text-1)' }}>Última NFS-e:</strong> {subscription.nfeLastInvoiceId}
              </p>
              <p className="opacity-85 mt-0.5">
                Status: <strong>{subscription.nfeLastInvoiceStatus || 'Processing'}</strong>
              </p>
            </div>
            {subscription.nfeLastInvoicePdfUrl ? (
              <a
                href={subscription.nfeLastInvoicePdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-bold transition-all hover:scale-[1.01]"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border)'
                }}
              >
                <FileText className="w-4 h-4" />
                Baixar PDF
              </a>
            ) : (
              <span className="text-[11.5px] opacity-75" style={{ color: 'var(--text-3)' }}>
                PDF em processamento na prefeitura...
              </span>
            )}
          </div>
        </section>
      )}

      <UpgradeProModal isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </div>
  );
};

const FaqItem: React.FC<{ q: string; a: React.ReactNode }> = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: open ? 'var(--surface-1)' : 'transparent',
        border: '1px solid ' + (open ? 'var(--border)' : 'var(--border-subtle)')
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
          {q}
        </span>
        <ChevronDown
          className="w-4 h-4 shrink-0 transition-transform"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            color: 'var(--text-3)'
          }}
        />
      </button>
      {open && (
        <div
          className="px-3.5 pb-3 pt-0 text-[12.5px] leading-relaxed"
          style={{ color: 'var(--text-2)' }}
        >
          {a}
        </div>
      )}
    </div>
  );
};

interface StatusLabel {
  text: string;
  sub?: string;
  color: string;
}

function getStatusLabel(
  status: string | undefined,
  daysLeft: number | null,
  trialMs: number | null
): StatusLabel {
  if (status === 'blocked') {
    return {
      text: 'Conta bloqueada',
      sub: 'Entre em contacto com o suporte para rever o acesso.',
      color: '#ef4444'
    };
  }
  if (!status || status === 'none') {
    return { text: 'Sem plano ativo', sub: 'Assine para desbloquear o Pro', color: 'var(--text-2)' };
  }
  if (status === 'trialing') {
    if (daysLeft != null && daysLeft >= 0) {
      return {
        text: 'Teste grátis ativo',
        sub: `Expira em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}`,
        color: '#3b82f6'
      };
    }
    const trialDays = trialMs != null ? Math.ceil((trialMs - Date.now()) / (1000 * 60 * 60 * 24)) : null;
    return {
      text: 'Teste grátis ativo',
      sub:
        trialDays != null
          ? `Expira em ${Math.max(0, trialDays)} dia${trialDays === 1 ? '' : 's'}`
          : 'Teste em andamento',
      color: '#3b82f6'
    };
  }
  if (status === 'active') {
    if (daysLeft != null && daysLeft <= 7) {
      return {
        text: `Expira em ${Math.max(0, daysLeft)} dia${daysLeft === 1 ? '' : 's'}`,
        sub: 'Renove para não perder acesso',
        color: '#f59e0b'
      };
    }
    return { text: 'Pro ativo', sub: daysLeft != null ? `${daysLeft} dias restantes` : undefined, color: '#10b981' };
  }
  if (status === 'past_due') {
    return {
      text: 'Pagamento pendente',
      sub: 'Recusado ou aguardando. Tente novamente.',
      color: '#f59e0b'
    };
  }
  if (status === 'canceled') {
    return {
      text: 'Cancelado',
      sub: 'Acesso continua até a data de expiração',
      color: '#ef4444'
    };
  }
  return { text: status, color: 'var(--text-2)' };
}

const Info: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div
    className="rounded-lg px-2.5 py-1.5"
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
      {icon}
      {label}
    </p>
    <p className="text-[13px] font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>
      {value}
    </p>
  </div>
);

interface ActionProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  loading?: boolean;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}

const Action: React.FC<ActionProps> = ({ onClick, icon, label, hint, loading, disabled, primary, danger }) => {
  const style: React.CSSProperties = danger
    ? {
        background: 'var(--surface-1)',
        color: '#ef4444',
        border: '1px solid rgba(239,68,68,0.4)'
      }
    : primary
      ? {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#fff',
          boxShadow: '0 5px 14px rgba(16,185,129,0.28)'
        }
      : {
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
          border: '1px solid var(--border)'
        };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
      style={style}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      <span className="flex flex-col items-start">
        <span className="text-[13px] font-bold leading-tight">{label}</span>
        {hint && <span className="text-[10.5px] font-medium opacity-85 leading-tight">{hint}</span>}
      </span>
    </button>
  );
};
