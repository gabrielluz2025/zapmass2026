import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  Crown,
  FileText,
  Loader2,
  Radio,
  Repeat,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle
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
import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  brl
} from '../../constants/channelTierPricing';

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

  const expiryInfoLabel =
    subscription?.manualGrant === true && manualAccessEndsMs == null ? 'Acesso' : 'Expira em';
  const expiryInfoValue =
    subscription?.manualGrant === true && manualAccessEndsMs == null
      ? 'Manual (sem data)'
      : formatDate(effectiveExpiryMs);
  const isRecurring = Boolean(subscription?.mercadoPagoPreapprovalId && subscription.status === 'active');
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

  const cancelRecurring = async () => {
    if (!user) return;
    if (!window.confirm('Cancelar o débito automático? Seu acesso continua até a data de expiração atual.')) return;
    setBusy('cancel');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/mercadopago/cancel-subscription', {
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
    const checkoutTab = window.open('', '_blank', 'noopener,noreferrer');
    setTierBusy(method);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/mercadopago/channel-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ method, channels, plan })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        checkoutTab?.close();
        toast.error(typeof data?.error === 'string' ? data.error : 'Não foi possível abrir o checkout do plano por canais.');
        return;
      }
      if (data.init_point) {
        if (checkoutTab) {
          checkoutTab.location.href = String(data.init_point);
        } else {
          window.open(String(data.init_point), '_blank', 'noopener,noreferrer');
        }
        const charged = Number(data?.charged_brl);
        const isUpgrade = data?.is_upgrade_prorata === true;
        const priceText = Number.isFinite(charged) ? ` Valor: ${brl(charged)}.` : '';
        toast.success(
          isUpgrade
            ? `Upgrade pró-rata (${plan === 'annual' ? 'anual' : 'mensal'}) aberto para ${channels} canal(is).${priceText}`
            : `Checkout ${plan === 'annual' ? 'anual' : 'mensal'} aberto para ${channels} canal(is).${priceText}`
        );
      } else checkoutTab?.close();
    } catch (e) {
      checkoutTab?.close();
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
          <div className="rounded-xl px-4 py-3 text-[12px]" style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--text-1)' }}>Situação do plano (read-only): </strong>
            {(subscription.status as string) || '—'} · plano {(subscription.plan as string) || '—'}
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
  const contractedChannels = Math.max(
    1,
    Math.min(
      5,
      Math.floor(
        Number(subscription?.includedChannels) || (2 + Math.max(0, Math.floor(Number(subscription?.extraChannelSlots) || 0)))
      )
    )
  ) as ChannelTier;

  /** Migração mensal → anual (Pix) com o mesmo número de canais contratado. */
  const migrateToAnnualPix = async () => {
    if (!user) return;
    const checkoutTab = window.open('', '_blank', 'noopener,noreferrer');
    setBusy('pix');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/mercadopago/channel-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ plan: 'annual', method: 'pix', channels: contractedChannels })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        checkoutTab?.close();
        toast.error(typeof data?.error === 'string' ? data.error : 'Erro ao abrir o checkout.');
        return;
      }
      if (data.init_point) {
        if (checkoutTab) {
          checkoutTab.location.href = String(data.init_point);
        } else {
          window.open(String(data.init_point), '_blank', 'noopener,noreferrer');
        }
        toast.success('Abrimos o Mercado Pago numa nova aba. O acesso é estendido após confirmação.');
      } else checkoutTab?.close();
    } catch (e) {
      checkoutTab?.close();
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

  const statusLabel = getStatusLabel(subscription?.status, daysLeft, trialEndsMs);
  const providerLabel =
    subscription?.provider === 'mercadopago'
      ? 'Mercado Pago'
      : subscription?.provider === 'infinitepay'
        ? 'Infinite Pay'
        : '—';
  const planLabel =
    subscription?.plan === 'annual' ? 'Anual' : subscription?.plan === 'monthly' ? 'Mensal' : '—';

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
            Gerencie seu plano, métodos de pagamento e renovações.
          </p>
        </div>
      </header>

      <section
        className="rounded-2xl px-5 py-5"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
      >
        <div className="flex flex-wrap items-start gap-4 justify-between mb-4">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Situação atual
            </p>
            <p className="text-[22px] font-extrabold mt-1" style={{ color: statusLabel.color }}>
              {statusLabel.text}
            </p>
            {statusLabel.sub && (
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                {statusLabel.sub}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
            <Info icon={<CalendarDays className="w-3.5 h-3.5" />} label={expiryInfoLabel} value={expiryInfoValue} />
            <Info icon={<Crown className="w-3.5 h-3.5" />} label="Plano" value={planLabel} />
            <Info icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Via" value={providerLabel} />
          </div>
        </div>

        {isRecurring && (
          <div
            className="rounded-xl px-3.5 py-2.5 flex items-start gap-2 mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(14,165,233,0.05))',
              border: '1px solid rgba(59,130,246,0.3)'
            }}
          >
            <Repeat className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#3b82f6' }} />
            <div className="flex-1 text-[12px]" style={{ color: 'var(--text-2)' }}>
              <strong style={{ color: 'var(--text-1)' }}>Débito automático ativo.</strong> Seu cartão será cobrado
              automaticamente no próximo ciclo. Você pode cancelar a qualquer momento — o acesso continua até o fim do
              período pago.
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {subscription?.plan !== 'annual' && (
            <Action
              onClick={() => void migrateToAnnualPix()}
              loading={busy === 'pix'}
              disabled={!!busy}
              icon={<TrendingUp className="w-4 h-4" />}
              primary
              label="Migrar para Anual (Pix −5%)"
              hint={`Soma os dias restantes · ${priceAnnual}`}
            />
          )}
          <Action
            onClick={() => setUpgradeOpen(true)}
            disabled={!!busy}
            icon={<Crown className="w-4 h-4" />}
            label={subscription?.status === 'active' ? 'Renovar ou mudar plano' : 'Assinar Pro'}
            hint={`${priceMonthly} · ${priceAnnual}`}
          />
          {isRecurring && (
            <Action
              onClick={cancelRecurring}
              loading={busy === 'cancel'}
              disabled={!!busy}
              icon={<XCircle className="w-4 h-4" />}
              danger
              label="Cancelar débito automático"
              hint="Acesso mantido até a expiração"
            />
          )}
        </div>
      </section>

      <section
        id="canais-extras-whatsapp"
        className="rounded-2xl px-5 py-5 scroll-mt-4"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)' }}
          >
            <Radio className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
              Planos por quantidade de canais
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              O plano contratado define seu limite total de canais (1 a 5), com upgrade pró-rata durante o ciclo.
            </p>
          </div>
        </div>
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--text-2)' }}>
          Situação:{' '}
          <strong style={{ color: 'var(--text-1)' }}>
            {typeof subscription?.includedChannels === 'number' && subscription.includedChannels > 0
              ? `${subscription.includedChannels} canal(is) no plano atual.`
              : typeof subscription?.extraChannelSlots === 'number' && subscription.extraChannelSlots > 0
                ? `+${subscription.extraChannelSlots} extra(s) — até ${2 + (subscription.extraChannelSlots || 0)} canais.`
                : 'Sem informação de plano por canais ainda (modelo legado).'}
          </strong>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
          Selecione seu plano mensal
          </h2>
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => setTierPlanMode('monthly')}
              className="px-2.5 py-1 text-[11px] font-semibold"
              style={{
                background: tierPlanMode === 'monthly' ? 'rgba(16,185,129,0.14)' : 'transparent',
                color: 'var(--text-1)'
              }}
            >
              Mensal
            </button>
            <button
              type="button"
              onClick={() => setTierPlanMode('annual')}
              className="px-2.5 py-1 text-[11px] font-semibold"
              style={{
                background: tierPlanMode === 'annual' ? 'rgba(16,185,129,0.14)' : 'transparent',
                color: 'var(--text-1)'
              }}
            >
              Anual
            </button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
          {(Object.keys(CHANNEL_TIER_PRICES_MONTHLY) as Array<keyof typeof CHANNEL_TIER_PRICES_MONTHLY>).map((n) => {
            const tier = Number(n) as ChannelTier;
            const price = tierPrice(tier, tierPlanMode);
            const per = price / tier;
            const isCurrent = contractedChannels === tier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setUpgradeTarget(tier)}
                className="text-left rounded-lg px-3 py-2 border transition-all"
                style={{
                  borderColor:
                    upgradeTarget === tier ? 'rgba(16,185,129,0.55)' : isCurrent ? 'rgba(59,130,246,0.55)' : 'var(--border-subtle)',
                  background:
                    upgradeTarget === tier
                      ? 'linear-gradient(135deg, rgba(16,185,129,0.13), rgba(6,182,212,0.08))'
                      : isCurrent
                        ? 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(59,130,246,0.05))'
                        : 'var(--surface-1)'
                }}
              >
                <p className="text-[11px] font-bold" style={{ color: 'var(--text-1)' }}>
                  {tier} canal{tier > 1 ? 'is' : ''}
                </p>
                <p className="text-[14px] font-extrabold mt-0.5" style={{ color: 'var(--text-1)' }}>
                  {brl(price)}
                </p>
                <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  {brl(per)} por canal ({tierPlanMode === 'annual' ? 'ano' : 'mês'})
                </p>
              </button>
            );
          })}
        </div>
        <div
          className="rounded-lg px-3.5 py-3 mb-4"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Upgrade simulado ({tierPlanMode === 'annual' ? 'anual' : 'mensal'}): {contractedChannels} → {upgradeTarget} canal{upgradeTarget > 1 ? 'is' : ''}
          </p>
          <p className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>
            Diferença mensal: <strong>{brl(monthlyDiff)}</strong>. Exemplo pró-rata (50% do ciclo restante):{' '}
            <strong>{brl(prorataHalf)}</strong>.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Action
              onClick={() => void startChannelTierPlan('pix', upgradeTarget, tierPlanMode)}
              loading={tierBusy === 'pix'}
              disabled={!!tierBusy}
              icon={<TrendingUp className="w-4 h-4" />}
              label={`Contratar ${upgradeTarget} canal(is) ${tierPlanMode === 'annual' ? 'anual' : 'mensal'} (Pix -5%)`}
              hint="Novo modelo de plano por quantidade de canais"
            />
            <Action
              onClick={() => void startChannelTierPlan('card', upgradeTarget, tierPlanMode)}
              loading={tierBusy === 'card'}
              disabled={!!tierBusy}
              icon={<Crown className="w-4 h-4" />}
              label={`Contratar ${upgradeTarget} canal(is) ${tierPlanMode === 'annual' ? 'anual' : 'mensal'} (cartão)`}
              hint="Checkout Mercado Pago"
            />
          </div>
        </div>

        <h2 className="text-[14px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          Como funciona
        </h2>
        <ul className="space-y-1.5 text-[12.5px]" style={{ color: 'var(--text-2)' }}>
          <li className="flex items-start gap-2">
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              Paga via Pix (5% off), cartão à vista/parcelado (anual até 12x) ou débito automático (cartão, renova
              todo mês).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              Migração <strong>mensal → anual</strong>: os dias restantes do mensal são somados ao anual (você não
              perde nada).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              Débito automático: cancela a qualquer momento. O acesso continua até o fim do ciclo já pago.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <span>
              Pagamentos via Pix/cartão one-time <strong>não renovam sozinhos</strong>. Você paga novamente antes da
              expiração (recebe lembrete por email).
            </span>
          </li>
        </ul>
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
  if (!status || status === 'none') {
    return { text: 'Sem plano ativo', sub: 'Assine para desbloquear o Pro', color: 'var(--text-2)' };
  }
  if (status === 'trialing') {
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
