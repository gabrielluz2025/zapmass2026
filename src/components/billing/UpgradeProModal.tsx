import React, { useMemo, useState } from 'react';
import { Check, CreditCard, Crown, Loader2, Sparkles, TrendingDown, Zap, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { Modal } from '../ui';

const FALLBACK_MONTHLY =
  (import.meta.env.VITE_MARKETING_PRICE_MONTHLY as string | undefined)?.trim() || 'R$ 49,90 / mês';
const FALLBACK_ANNUAL =
  (import.meta.env.VITE_MARKETING_PRICE_ANNUAL as string | undefined)?.trim() || 'R$ 479,90 / ano';

const PIX_DISCOUNT_PCT = 0.05;

interface UpgradeProModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Plan = 'monthly' | 'annual';
type Method = 'pix' | 'card';
type LoadingKey = 'idle' | `${Plan}-${Method}`;

const BENEFITS: string[] = [
  'Vários chips WhatsApp no mesmo painel',
  'Campanhas com limite diário e atraso inteligente',
  'Importação de contatos, listas e etiquetas',
  'Relatórios de entrega, leitura e respostas',
  'Central de chat com contexto de disparo'
];

/** Extrai um numero (R$ X,YY) de uma string de preco marketing do tipo "R$ 199,90 / mes". */
function extractAmount(label: string): number | null {
  const m = label.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (!m) return null;
  const raw = m[1].replace(/\./g, '').replace(',', '.');
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const UpgradeProModal: React.FC<UpgradeProModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { config } = useAppConfig();
  const [loading, setLoading] = useState<LoadingKey>('idle');
  const priceMonthly = config.marketingPriceMonthly.trim() || FALLBACK_MONTHLY;
  const priceAnnual = config.marketingPriceAnnual.trim() || FALLBACK_ANNUAL;

  const amountMonthly = useMemo(() => extractAmount(priceMonthly), [priceMonthly]);
  const amountAnnual = useMemo(() => extractAmount(priceAnnual), [priceAnnual]);

  const pixMonthly = amountMonthly ? formatBRL(amountMonthly * (1 - PIX_DISCOUNT_PCT)) : null;
  const pixAnnual = amountAnnual ? formatBRL(amountAnnual * (1 - PIX_DISCOUNT_PCT)) : null;

  const startPayment = async (plan: Plan, method: Method) => {
    if (!user) return;
    setLoading(`${plan}-${method}`);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/mercadopago/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ plan, method })
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
          Acesso completo sem limites. Pague via Pix com desconto ou cartão.
        </p>
      </div>

      <div
        className="rounded-xl px-3.5 py-2.5 mb-3"
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

      <div className="grid sm:grid-cols-2 gap-2.5 mb-3">
        <PlanCard
          label="Mensal"
          price={priceMonthly}
          sublabel="Acesso por 30 dias"
          pixPrice={pixMonthly}
          cardInfo="Cartão, Pix, débito · 1x"
          loading={loading}
          busy={busy}
          onPix={() => startPayment('monthly', 'pix')}
          onCard={() => startPayment('monthly', 'card')}
          plan="monthly"
        />
        <PlanCard
          featured
          label="Anual"
          price={priceAnnual}
          sublabel="Acesso por 12 meses"
          badge="Economize ~25%"
          pixPrice={pixAnnual}
          cardInfo="Cartão até 12x, Pix, débito"
          loading={loading}
          busy={busy}
          onPix={() => startPayment('annual', 'pix')}
          onCard={() => startPayment('annual', 'card')}
          plan="annual"
        />
      </div>

      <div
        className="flex items-start gap-2 px-3 py-2 rounded-lg"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
        <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--brand-600)' }} />
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
          Pagamento seguro pelo <strong style={{ color: 'var(--text-2)' }}>Mercado Pago</strong>. Acesso liberado
          automaticamente após a confirmação. Desconto de 5% no Pix; parcelamento no cartão pode ter juros do MP.
        </p>
      </div>
    </Modal>
  );
};

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

interface PlanCardProps {
  label: string;
  price: string;
  sublabel: string;
  pixPrice: string | null;
  cardInfo: string;
  featured?: boolean;
  badge?: string;
  loading: LoadingKey;
  busy: boolean;
  plan: Plan;
  onPix: () => void;
  onCard: () => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
  label,
  price,
  sublabel,
  pixPrice,
  cardInfo,
  featured,
  badge,
  loading,
  busy,
  plan,
  onPix,
  onCard
}) => {
  const loadingPix = loading === `${plan}-pix`;
  const loadingCard = loading === `${plan}-card`;

  return (
    <div
      className="relative rounded-xl px-3.5 py-3 flex flex-col gap-2.5"
      style={
        featured
          ? {
              background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(59,130,246,0.06))',
              border: '1.5px solid rgba(16,185,129,0.45)',
              boxShadow: '0 8px 22px rgba(16,185,129,0.15)'
            }
          : {
              background: 'var(--surface-0)',
              border: '1px solid var(--border)'
            }
      }
    >
      {badge && (
        <span
          className="absolute -top-2 right-3 text-[9.5px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1"
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#fff',
            boxShadow: '0 4px 14px rgba(16,185,129,0.4)'
          }}
        >
          <TrendingDown className="w-2.5 h-2.5" />
          {badge}
        </span>
      )}

      <div>
        <p
          className="text-[10.5px] font-bold uppercase tracking-widest flex items-center gap-1"
          style={{ color: featured ? 'var(--brand-600)' : 'var(--text-3)' }}
        >
          {featured && <Crown className="w-3 h-3" />}
          {label}
        </p>
        <p className="text-[17px] font-extrabold mt-0.5 leading-tight" style={{ color: 'var(--text-1)' }}>
          {price}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          {sublabel}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <PayButton
          variant="pix"
          loading={loadingPix}
          disabled={busy}
          onClick={onPix}
          topLabel="Pagar com Pix"
          subLabel={pixPrice ? `${pixPrice} · −5%` : 'Desconto 5%'}
        />
        <PayButton
          variant={featured ? 'primary' : 'secondary'}
          loading={loadingCard}
          disabled={busy}
          onClick={onCard}
          topLabel="Outras formas"
          subLabel={cardInfo}
        />
      </div>
    </div>
  );
};

interface PayButtonProps {
  variant: 'pix' | 'primary' | 'secondary';
  topLabel: string;
  subLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const PayButton: React.FC<PayButtonProps> = ({ variant, topLabel, subLabel, loading, disabled, onClick }) => {
  const style: React.CSSProperties =
    variant === 'pix'
      ? {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#fff',
          boxShadow: '0 5px 14px rgba(16,185,129,0.3)'
        }
      : variant === 'primary'
        ? {
            background: 'var(--surface-2, #1f2937)',
            color: 'var(--text-1)',
            border: '1.5px solid var(--brand-600, #10b981)'
          }
        : {
            background: 'var(--surface-1)',
            color: 'var(--text-1)',
            border: '1px solid var(--border-strong)'
          };

  const Icon = variant === 'pix' ? Zap : CreditCard;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
      style={style}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-bold">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
        {topLabel}
      </span>
      <span className="text-[10.5px] font-semibold opacity-90">{subLabel}</span>
    </button>
  );
};
