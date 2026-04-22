import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  Crown,
  Loader2,
  Repeat,
  ShieldCheck,
  TrendingUp,
  XCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { firestoreTimeToMs } from '../../utils/firestoreTime';
import { UpgradeProModal } from './UpgradeProModal';

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card' | 'recurring';

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
  const daysLeft = daysUntil(accessEndsMs);
  const isRecurring = Boolean(subscription?.mercadoPagoPreapprovalId && subscription.status === 'active');

  const startPayment = async (plan: Plan, method: Method) => {
    if (!user) return;
    setBusy(method);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/mercadopago/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ plan, method })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Erro ao abrir o checkout.');
        return;
      }
      if (data.init_point) {
        window.open(String(data.init_point), '_blank', 'noopener,noreferrer');
        toast.success('Abrimos o Mercado Pago numa nova aba. O acesso é estendido após confirmação.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setBusy(null);
    }
  };

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-3)' }} />
      </div>
    );
  }

  const priceMonthly = config.marketingPriceMonthly.trim() || 'R$ 49,90 / mês';
  const priceAnnual = config.marketingPriceAnnual.trim() || 'R$ 479,90 / ano';

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
            <Info icon={<CalendarDays className="w-3.5 h-3.5" />} label="Expira em" value={formatDate(accessEndsMs)} />
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
              onClick={() => startPayment('annual', 'pix')}
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
        className="rounded-2xl px-5 py-4"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
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
    const trialDays = trialMs != null ? Math.ceil((trialMs - Date.now()) / (1000 * 60 * 60)) : null;
    return {
      text: 'Teste grátis ativo',
      sub: trialDays != null ? `Termina em ~${Math.max(0, trialDays)}h` : 'Teste em andamento',
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
