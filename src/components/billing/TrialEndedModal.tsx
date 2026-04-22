import React, { useState } from 'react';
import { Check, Clock3, CreditCard, Crown, Loader2, Sparkles, TrendingDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { Modal } from '../ui';

const FALLBACK_MONTHLY =
  (import.meta.env.VITE_MARKETING_PRICE_MONTHLY as string | undefined)?.trim() || 'R$ 49,90 / mês';
const FALLBACK_ANNUAL =
  (import.meta.env.VITE_MARKETING_PRICE_ANNUAL as string | undefined)?.trim() || 'R$ 479,90 / ano';

interface TrialEndedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type LoadingKey = 'idle' | 'mp-monthly' | 'mp-annual';

/**
 * Pop-up que aparece automaticamente quando o teste gratuito de 1h termina.
 * Explica que o sistema continua acessivel (leitura) mas as acoes ficam bloqueadas,
 * e convida a liberar definitivamente contratando o Pro via Mercado Pago.
 */
export const TrialEndedModal: React.FC<TrialEndedModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { config } = useAppConfig();
  const [loading, setLoading] = useState<LoadingKey>('idle');
  const priceMonthly = config.marketingPriceMonthly.trim() || FALLBACK_MONTHLY;
  const priceAnnual = config.marketingPriceAnnual.trim() || FALLBACK_ANNUAL;

  const startMp = async (plan: 'monthly' | 'annual') => {
    if (!user) return;
    setLoading(plan === 'monthly' ? 'mp-monthly' : 'mp-annual');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/mercadopago/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ plan })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Checkout Mercado Pago indisponível.');
        return;
      }
      if (data.init_point) {
        window.open(String(data.init_point), '_blank', 'noopener,noreferrer');
        toast.success('Conclua o pagamento na aba do Mercado Pago. Seu acesso libera após a confirmação.');
        onClose();
      } else toast.error('Resposta sem link de checkout.');
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setLoading('idle');
    }
  };

  const busy = loading !== 'idle';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdrop={false}>
      <div className="text-center -mt-2 mb-5">
        <div
          className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
            boxShadow: '0 14px 40px rgba(245,158,11,0.35)'
          }}
        >
          <Clock3 className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-[24px] font-extrabold leading-tight mb-1.5" style={{ color: 'var(--text-1)' }}>
          Seu teste grátis acabou
        </h2>
        <p className="text-[13.5px] leading-relaxed max-w-sm mx-auto" style={{ color: 'var(--text-2)' }}>
          Você pode continuar navegando, mas as ações (disparos, conexões, campanhas) estão bloqueadas.
          <span className="block mt-1 font-semibold" style={{ color: 'var(--text-1)' }}>
            Libere o sistema de forma definitiva assinando o Pro.
          </span>
        </p>
      </div>

      <div
        className="rounded-2xl p-4 mb-5"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(59,130,246,0.06))',
          border: '1px solid rgba(16,185,129,0.28)'
        }}
      >
        <p className="text-[11.5px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: 'var(--brand-600)' }}>
          <Sparkles className="w-3.5 h-3.5" />
          O que você desbloqueia com o Pro
        </p>
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]" style={{ color: 'var(--text-2)' }}>
          {[
            'Disparos em massa sem limite de 1h',
            'Vários chips WhatsApp no mesmo painel',
            'Campanhas com agendamento e pausa',
            'Importação de contatos e listas',
            'Relatórios de entrega e respostas',
            'Central de chat multi-chip'
          ].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <PlanCard
          label="Mensal"
          price={priceMonthly}
          sublabel="Cobrado todo mês"
          ctaLabel="Assinar mensal"
          loading={loading === 'mp-monthly'}
          disabled={busy}
          onClick={() => startMp('monthly')}
        />
        <PlanCard
          featured
          label="Anual"
          price={priceAnnual}
          sublabel="Melhor custo-benefício"
          badge="Economize ~25%"
          ctaLabel="Assinar anual"
          loading={loading === 'mp-annual'}
          disabled={busy}
          onClick={() => startMp('annual')}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <p className="text-[11.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
          Pagamento processado pelo <strong style={{ color: 'var(--text-2)' }}>Mercado Pago</strong>. Seu acesso libera
          automaticamente após a confirmação.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] font-semibold whitespace-nowrap hover:underline"
          style={{ color: 'var(--text-2)' }}
        >
          Agora não
        </button>
      </div>
    </Modal>
  );
};

interface PlanCardProps {
  label: string;
  price: string;
  sublabel: string;
  ctaLabel: string;
  featured?: boolean;
  badge?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
  label,
  price,
  sublabel,
  ctaLabel,
  featured,
  badge,
  loading,
  disabled,
  onClick
}) => {
  return (
    <div
      className="relative rounded-2xl p-4 flex flex-col gap-3 transition-all"
      style={
        featured
          ? {
              background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(59,130,246,0.06))',
              border: '1.5px solid rgba(16,185,129,0.5)',
              boxShadow: '0 10px 28px rgba(16,185,129,0.18)'
            }
          : {
              background: 'var(--surface-0)',
              border: '1px solid var(--border)'
            }
      }
    >
      {badge && (
        <span
          className="absolute -top-2.5 right-3 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full inline-flex items-center gap-1"
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#fff',
            boxShadow: '0 6px 18px rgba(16,185,129,0.45)'
          }}
        >
          <TrendingDown className="w-3 h-3" />
          {badge}
        </span>
      )}

      <div>
        <p
          className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-1"
          style={{ color: featured ? 'var(--brand-600)' : 'var(--text-3)' }}
        >
          {featured && <Crown className="w-3 h-3" />}
          {label}
        </p>
        <p className="text-[20px] font-extrabold mt-1 leading-tight" style={{ color: 'var(--text-1)' }}>
          {price}
        </p>
        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          {sublabel}
        </p>
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
        style={
          featured
            ? {
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#fff',
                boxShadow: '0 8px 22px rgba(16,185,129,0.35)'
              }
            : {
                background: 'var(--surface-1)',
                color: 'var(--text-1)',
                border: '1px solid var(--border-strong)'
              }
        }
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
        {ctaLabel}
      </button>
    </div>
  );
};
