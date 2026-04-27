import React from 'react';
import { CreditCard, Crown, Loader2, Repeat, TrendingDown, Zap } from 'lucide-react';

export type ProPlan = 'monthly' | 'annual';
export type ProLoadingKey = 'idle' | `${ProPlan}-pix` | `${ProPlan}-card` | `${ProPlan}-recurring`;

interface ProPlanCardProps {
  label: string;
  price: string;
  sublabel: string;
  /** Linha extra abaixo do sublabel (ex.: média mensal no plano anual). */
  sublabelExtra?: string;
  /** Texto completo do botão Pix (valor + desconto), já formatado. */
  pixSubLabel: string | null;
  cardInfo: string;
  featured?: boolean;
  badge?: string;
  showRecurring?: boolean;
  /** Estilo leve: trial modal usa borda um pouco mais forte. */
  frame?: 'default' | 'trial';
  loading: ProLoadingKey;
  busy: boolean;
  plan: ProPlan;
  onPix: () => void;
  onCard: () => void;
  onRecurring?: () => void;
}

export const ProPlanCard: React.FC<ProPlanCardProps> = ({
  label,
  price,
  sublabel,
  sublabelExtra,
  pixSubLabel,
  cardInfo,
  featured,
  badge,
  showRecurring,
  frame = 'default',
  loading,
  busy,
  plan,
  onPix,
  onCard,
  onRecurring
}) => {
  const loadingPix = loading === `${plan}-pix`;
  const loadingCard = loading === `${plan}-card`;
  const loadingRec = loading === `${plan}-recurring`;
  const trial = frame === 'trial';

  return (
    <div
      className="relative rounded-xl px-3.5 py-3 flex flex-col gap-2.5"
      style={
        featured
          ? {
              background: trial
                ? 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(59,130,246,0.05))'
                : 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(59,130,246,0.06))',
              border: trial
                ? '1.5px solid rgba(16,185,129,0.5)'
                : '1.5px solid rgba(16,185,129,0.45)',
              boxShadow: trial
                ? '0 8px 22px rgba(16,185,129,0.18)'
                : '0 8px 22px rgba(16,185,129,0.15)'
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
        {sublabelExtra && (
          <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
            {sublabelExtra}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <PayLine
          variant="pix"
          loading={loadingPix}
          disabled={busy}
          onClick={onPix}
          topLabel={featured ? 'Assinar com Pix' : 'Pagar com Pix'}
          subLabel={pixSubLabel || '5% de desconto no Pix (sobre o valor do plano)'}
        />
        <PayLine
          variant={featured ? 'primary' : 'secondary'}
          loading={loadingCard}
          disabled={busy}
          onClick={onCard}
          topLabel={featured ? 'Assinar no cartão' : 'Outras formas'}
          subLabel={cardInfo}
        />
        {showRecurring && onRecurring && (
          <PayLine
            variant="recurring"
            loading={loadingRec}
            disabled={busy}
            onClick={onRecurring}
            topLabel="Débito automático"
            subLabel="Renova todo mês · Cancela quando quiser"
          />
        )}
      </div>
    </div>
  );
};

const PayLine: React.FC<{
  variant: 'pix' | 'primary' | 'secondary' | 'recurring';
  topLabel: string;
  subLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ variant, topLabel, subLabel, loading, disabled, onClick }) => {
  const style: React.CSSProperties =
    variant === 'pix'
      ? {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#fff',
          boxShadow: '0 5px 14px rgba(16,185,129,0.3)'
        }
      : variant === 'recurring'
        ? {
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: '#fff',
            boxShadow: '0 5px 14px rgba(59,130,246,0.3)'
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

  const Icon = variant === 'pix' ? Zap : variant === 'recurring' ? Repeat : CreditCard;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
      style={style}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-bold min-w-0">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Icon className="w-3.5 h-3.5 shrink-0" />}
        {topLabel}
      </span>
      <span className="text-[10.5px] font-semibold opacity-90 text-right min-w-0 pl-1">{subLabel}</span>
    </button>
  );
};
