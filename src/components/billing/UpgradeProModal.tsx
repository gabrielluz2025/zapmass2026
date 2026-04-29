import React, { useState } from 'react';
import { Check, Crown, X, Sparkles, ShieldCheck, XCircle, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import type { ChannelTier } from '../../constants/channelTierPricing';
import { BASE_CHANNEL_SLOTS } from '../../utils/connectionLimitPolicy';
import { useProBillingPrices } from '../../hooks/useProBillingPrices';
import { redirectToMercadoPagoCheckout } from '../../utils/mercadopagoCheckout';
import { Modal } from '../ui';
import { ProChannelTierSelect } from './ProChannelTierSelect';
import { ProPlanCard, type ProLoadingKey } from './ProPlanCard';

interface UpgradeProModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card' | 'recurring';

const BENEFITS: string[] = [
  'Múltiplos canais WhatsApp no mesmo painel',
  'Importação de contatos, listas e etiquetas',
  'Central de chat com contexto de disparo',
  'Campanhas com limite diário e atraso inteligente',
  'Relatórios de entrega, leitura e respostas em tempo real'
];

export const UpgradeProModal: React.FC<UpgradeProModalProps> = ({ isOpen, onClose }) => {
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
        toast.error(typeof data?.error === 'string' ? data.error : 'Checkout Mercado Pago indisponível.');
        return;
      }
      if (data.init_point) {
        onClose();
        redirectToMercadoPagoCheckout(String(data.init_point));
        return;
      }
      toast.error('Resposta sem link de checkout.');
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setLoading('idle');
    }
  };

  const busy = loading !== 'idle';

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <CloseX onClose={onClose} />

      <div className="text-center -mt-1 mb-3">
        <div
          className="mx-auto w-11 h-11 rounded-xl flex items-center justify-center mb-2"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
            boxShadow: '0 10px 24px rgba(245,158,11,0.35)'
          }}
        >
          <Crown className="w-6 h-6 text-white" />
        </div>
        <h2 className="text-[19px] font-extrabold leading-tight mb-0.5" style={{ color: 'var(--text-1)' }}>
          ZapMass Pro
        </h2>
        <p className="text-[12px] leading-snug max-w-md mx-auto" style={{ color: 'var(--text-2)' }}>
          Selecione a quantidade de canais e a forma de pagamento ideal para começar.
        </p>
      </div>

      <div
        className="rounded-xl px-3.5 py-2.5 mb-2"
        style={{
          background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(234,88,12,0.06))',
          border: '1px solid rgba(245, 158, 11, 0.28)'
        }}
      >
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
        <p className="text-[10px] text-center mb-2 leading-snug" style={{ color: 'var(--text-3)' }}>
          Valores sincronizados com a cobrança do Mercado Pago para evitar divergências.
        </p>
      )}

      <ProChannelTierSelect
        value={channels}
        onChange={setChannels}
        disabled={busy}
        id="upgrade-pro-channels"
      />

      <div className="grid sm:grid-cols-2 gap-2.5 mb-3">
        <ProPlanCard
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
        <ReassureBadge
          icon={<ShieldCheck className="w-3.5 h-3.5" />}
          title="Mercado Pago"
          sub="Seguro e certificado"
        />
        <ReassureBadge
          icon={<XCircle className="w-3.5 h-3.5" />}
          title="Sem fidelidade"
          sub="Cancele em 1 clique"
        />
        <ReassureBadge
          icon={<Zap className="w-3.5 h-3.5" />}
          title="Acesso na hora"
          sub="Libera após aprovação"
        />
      </div>

      <div
        className="flex items-start gap-2 px-3 py-2 rounded-lg"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
        <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--brand-600)' }} />
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
          No débito automático, a renovação ocorre mensalmente no cartão. Você pode cancelar a qualquer momento em{' '}
          <strong>Minha assinatura</strong>. Sem letra miúda, sem fidelidade.
        </p>
      </div>
      <p
        className="text-[9px] text-center font-mono tabular-nums pt-1 select-all"
        style={{ color: 'var(--text-3)' }}
        title="Confirme se o deploy aplicou: deve coincidir com o commit do Git (Settings também mostra)."
      >
        build {import.meta.env.VITE_GIT_REF || 'dev'}
      </p>
    </Modal>
  );
};

const ReassureBadge: React.FC<{ icon: React.ReactNode; title: string; sub: string }> = ({
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

const CloseX: React.FC<{ onClose: () => void }> = ({ onClose }) => (
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
);
