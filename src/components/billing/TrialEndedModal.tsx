import React, { useState } from 'react';
import { Check, Clock3, CreditCard, Crown, Loader2, Sparkles } from 'lucide-react';
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

type LoadingKey = 'idle' | 'mp-monthly' | 'mp-annual' | 'ip-monthly' | 'ip-annual';

/**
 * Pop-up que aparece automaticamente quando o teste gratuito de 1h termina.
 * Fica explicito que o sistema continua acessivel (leitura), mas convida a
 * liberar definitivamente contratando o plano Pro.
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
        toast.error(typeof data?.error === 'string' ? data.error : 'Checkout Mercado Pago indisponivel.');
        return;
      }
      if (data.init_point) {
        window.open(String(data.init_point), '_blank', 'noopener,noreferrer');
        toast.success('Conclua o pagamento na aba do Mercado Pago. Seu acesso libera apos a confirmacao.');
        onClose();
      } else toast.error('Resposta sem link de checkout.');
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setLoading('idle');
    }
  };

  const startIp = async (plan: 'monthly' | 'annual') => {
    if (!user) return;
    setLoading(plan === 'monthly' ? 'ip-monthly' : 'ip-annual');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/infinitepay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ plan })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Checkout Infinite Pay indisponivel.');
        return;
      }
      if (data.checkout_url) {
        window.open(String(data.checkout_url), '_blank', 'noopener,noreferrer');
        toast.success('Conclua o pagamento na aba da Infinite Pay.');
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
    <Modal isOpen={isOpen} onClose={onClose} size="md" closeOnBackdrop={false}>
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
        <h2 className="text-[22px] font-extrabold leading-tight mb-1.5" style={{ color: 'var(--text-1)' }}>
          Seu teste grátis acabou
        </h2>
        <p className="text-[13.5px] leading-relaxed max-w-sm mx-auto" style={{ color: 'var(--text-2)' }}>
          Você pode continuar a navegar no ZapMass, mas as ações (disparos, conexões, campanhas) estão bloqueadas.
          <span className="block mt-1 font-semibold" style={{ color: 'var(--text-1)' }}>
            Libere o sistema de forma definitiva assinando o Pro.
          </span>
        </p>
      </div>

      <div
        className="rounded-2xl p-5 mb-5"
        style={{
          background:
            'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(59,130,246,0.08))',
          border: '1px solid rgba(16,185,129,0.3)'
        }}
      >
        <p className="text-[12px] font-bold uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: 'var(--brand-600)' }}>
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
        <div className="flex flex-wrap gap-2 pt-4">
          <span
            className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--brand-700, #047857)' }}
          >
            <Crown className="w-3.5 h-3.5" />
            Mensal · {priceMonthly}
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--brand-700, #047857)' }}
          >
            <Crown className="w-3.5 h-3.5" />
            Anual · {priceAnnual}
          </span>
        </div>
      </div>

      <section className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
          Mercado Pago (recorrente)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <CtaButton
            primary
            loading={loading === 'mp-monthly'}
            disabled={busy}
            onClick={() => startMp('monthly')}
            label="Assinar mensal"
            sub={priceMonthly}
          />
          <CtaButton
            loading={loading === 'mp-annual'}
            disabled={busy}
            onClick={() => startMp('annual')}
            label="Assinar anual"
            sub={priceAnnual}
          />
        </div>
      </section>

      <section className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
          Infinite Pay (link de pagamento)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <CtaButton
            variant="soft"
            loading={loading === 'ip-monthly'}
            disabled={busy}
            onClick={() => startIp('monthly')}
            label="Pagar mensal"
            sub={priceMonthly}
          />
          <CtaButton
            variant="soft"
            loading={loading === 'ip-annual'}
            disabled={busy}
            onClick={() => startIp('annual')}
            label="Pagar anual"
            sub={priceAnnual}
          />
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
          Após o pagamento seu acesso libera automaticamente. Pode fechar esta janela e voltar quando quiser.
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

interface CtaButtonProps {
  label: string;
  sub: string;
  loading?: boolean;
  disabled?: boolean;
  primary?: boolean;
  variant?: 'solid' | 'soft';
  onClick: () => void;
}

const CtaButton: React.FC<CtaButtonProps> = ({ label, sub, loading, disabled, primary, variant = 'solid', onClick }) => {
  const isPrimary = primary && variant === 'solid';
  const isSoft = variant === 'soft';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start justify-center gap-0.5 px-3.5 py-3 rounded-xl font-bold text-left transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
      style={
        isPrimary
          ? {
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#fff',
              boxShadow: '0 10px 28px rgba(16,185,129,0.35)'
            }
          : isSoft
          ? {
              background: 'var(--surface-1)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)'
            }
          : {
              background: 'var(--surface-0)',
              color: 'var(--text-1)',
              border: '1px solid var(--border-strong)'
            }
      }
    >
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
        {label}
      </span>
      <span className="text-[10.5px] font-semibold opacity-80">{sub}</span>
    </button>
  );
};
