import React, { useState } from 'react';
import { Check, Clock3, ShieldCheck, Sparkles, XCircle, Zap, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import type { ChannelTier } from '../../constants/channelTierPricing';
import { BASE_CHANNEL_SLOTS } from '../../utils/connectionLimitPolicy';
import { useProBillingPrices } from '../../hooks/useProBillingPrices';
import { Modal } from '../ui';
import { ProChannelTierSelect } from './ProChannelTierSelect';
import { ProPlanCard, type ProLoadingKey } from './ProPlanCard';

interface TrialEndedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card' | 'recurring';

const BENEFITS: string[] = [
  'Disparos em massa sem bloqueio por limite de 1h',
  'Múltiplos canais WhatsApp no mesmo painel',
  'Campanhas com agendamento, pausa e retomada',
  'Importação de contatos e listas',
  'Relatórios de entrega e respostas em tempo real',
  'Central de chat multicanal'
];

export const TrialEndedModal: React.FC<TrialEndedModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { config } = useAppConfig();
  const [loading, setLoading] = useState<ProLoadingKey>('idle');
  const [channels, setChannels] = useState<ChannelTier>(
    Math.min(5, Math.max(1, BASE_CHANNEL_SLOTS)) as ChannelTier
  );
  const {
    priceMonthlyLabel,
    priceAnnualLabel,
    pixMonthlySub,
    pixAnnualSub,
    annualSavingsBadge,
    annualEquivalencyHint,
    fromServer
  } = useProBillingPrices(isOpen, config, channels);

  const startPayment = async (plan: Plan, method: Method) => {
    if (!user) return;
    const checkoutTab = window.open('', '_blank', 'noopener,noreferrer');
    setLoading(`${plan}-${method}` as ProLoadingKey);
    try {
      const idToken = await user.getIdToken();
      const url =
        method === 'recurring'
          ? '/api/billing/mercadopago/start'
          : '/api/billing/mercadopago/channel-plan';
      const body =
        method === 'recurring'
          ? { plan, method, channels }
          : { plan, method: method === 'pix' ? 'pix' : 'card', channels };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        checkoutTab?.close();
        toast.error(typeof data?.error === 'string' ? data.error : 'Checkout Mercado Pago indisponível.');
        return;
      }
      if (data.init_point) {
        if (checkoutTab) {
          checkoutTab.location.href = String(data.init_point);
        } else {
          window.open(String(data.init_point), '_blank', 'noopener,noreferrer');
        }
        const msg =
          method === 'recurring'
            ? 'Conclua a autorização do débito automático. Seu acesso libera após a aprovação.'
            : 'Conclua o pagamento na aba do Mercado Pago. Seu acesso libera após a confirmação.';
        toast.success(msg);
        onClose();
      } else {
        checkoutTab?.close();
        toast.error('Resposta sem link de checkout.');
      }
    } catch (e) {
      checkoutTab?.close();
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setLoading('idle');
    }
  };

  const busy = loading !== 'idle';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdrop={false}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-2)',
          zIndex: 10
        }}
      >
        <X className="w-4 h-4" />
      </button>

      <div className="text-center -mt-1 mb-3">
        <div
          className="mx-auto w-12 h-12 rounded-xl flex items-center justify-center mb-2"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
            boxShadow: '0 12px 30px rgba(245,158,11,0.35)'
          }}
        >
          <Clock3 className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-[20px] font-extrabold leading-tight mb-1" style={{ color: 'var(--text-1)' }}>
          Seu teste grátis acabou
        </h2>
        <p className="text-[12px] leading-snug max-w-md mx-auto" style={{ color: 'var(--text-2)' }}>
          Você ainda pode navegar, mas as ações ficam bloqueadas.{' '}
          <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
            Escolha a quantidade de canais e libere o Pro com Pix, cartão ou débito automático.
          </span>
        </p>
      </div>

      <div
        className="rounded-xl px-3.5 py-2.5 mb-3"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(59,130,246,0.05))',
          border: '1px solid rgba(16,185,129,0.28)'
        }}
      >
        <p
          className="text-[10.5px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1"
          style={{ color: 'var(--brand-600)' }}
        >
          <Sparkles className="w-3 h-3" />O que você desbloqueia
        </p>
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--text-2)' }}>
          {BENEFITS.map((t) => (
            <li key={t} className="flex items-start gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>

      {fromServer && (
        <p className="text-[10px] text-center mb-2" style={{ color: 'var(--text-3)' }}>
          Valores sincronizados com a cobrança do Mercado Pago.
        </p>
      )}

      <ProChannelTierSelect
        value={channels}
        onChange={setChannels}
        disabled={busy}
        id="trial-ended-channels"
      />

      <div className="grid sm:grid-cols-2 gap-2.5 mb-3">
        <ProPlanCard
          frame="trial"
          featured
          label="Anual"
          price={priceAnnualLabel}
          sublabel={`Comece com ${channels} canal${channels > 1 ? 'is' : ''} · Acesso por 12 meses`}
          sublabelExtra={
            annualEquivalencyHint
              ? `Equivale a ${annualEquivalencyHint} • melhor previsibilidade de custo no ano`
              : 'Melhor previsibilidade de custo no ano'
          }
          badge={annualSavingsBadge || 'Melhor custo-benefício'}
          pixSubLabel={pixAnnualSub}
          cardInfo="Mais econômico no longo prazo · Cartão até 12x, Pix e débito"
          loading={loading}
          busy={busy}
          onPix={() => startPayment('annual', 'pix')}
          onCard={() => startPayment('annual', 'card')}
          plan="annual"
        />
        <ProPlanCard
          frame="trial"
          label="Mensal"
          price={priceMonthlyLabel}
          sublabel={`Comece com ${channels} canal${channels > 1 ? 'is' : ''} · Acesso por 30 dias`}
          pixSubLabel={pixMonthlySub}
          cardInfo="Ideal para começar · Cartão, Pix e débito"
          showRecurring
          loading={loading}
          busy={busy}
          onPix={() => startPayment('monthly', 'pix')}
          onCard={() => startPayment('monthly', 'card')}
          onRecurring={() => startPayment('monthly', 'recurring')}
          plan="monthly"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2.5">
        <TrialReassure icon={<ShieldCheck className="w-3.5 h-3.5" />} title="Mercado Pago" sub="Seguro e certificado" />
        <TrialReassure icon={<XCircle className="w-3.5 h-3.5" />} title="Sem fidelidade" sub="Cancele em 1 clique" />
        <TrialReassure icon={<Zap className="w-3.5 h-3.5" />} title="Acesso na hora" sub="Libera após aprovação" />
      </div>

      <div
        className="flex items-center justify-between gap-3 pt-2.5 border-t"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
          Acesso liberado automaticamente após confirmação do pagamento. Cancele quando quiser em{' '}
          <strong style={{ color: 'var(--text-2)' }}>Minha assinatura</strong>.
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

const TrialReassure: React.FC<{ icon: React.ReactNode; title: string; sub: string }> = ({
  icon,
  title,
  sub
}) => (
  <div
    className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
    style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
  >
    <div
      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.06))',
        color: 'var(--brand-600)'
      }}
    >
      {icon}
    </div>
    <div className="min-w-0 leading-tight">
      <p className="text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
        {title}
      </p>
      <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
        {sub}
      </p>
    </div>
  </div>
);
