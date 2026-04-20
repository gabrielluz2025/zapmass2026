import React, { useState } from 'react';
import { Check, CreditCard, Crown, Loader2, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { Button, Modal } from '../ui';

const FALLBACK_MONTHLY =
  (import.meta.env.VITE_MARKETING_PRICE_MONTHLY as string | undefined)?.trim() || 'R$ 49,90 / mês';
const FALLBACK_ANNUAL =
  (import.meta.env.VITE_MARKETING_PRICE_ANNUAL as string | undefined)?.trim() || 'R$ 479,90 / ano';

interface UpgradeProModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type LoadingKey =
  | 'idle'
  | 'mp-monthly'
  | 'mp-annual'
  | 'ip-monthly'
  | 'ip-annual';

export const UpgradeProModal: React.FC<UpgradeProModalProps> = ({ isOpen, onClose }) => {
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="ZapMass Pro"
      subtitle="Acesso completo: disparos, multi-chip, campanhas, relatórios e central de mensagens. Renovação por mês calendário (não só 30 dias fixos)."
      icon={<Crown className="w-5 h-5 text-amber-500" />}
      size="md"
    >
      <div className="space-y-5">
        <div
          className="rounded-xl p-4 space-y-3"
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(234,88,12,0.1))',
            border: '1px solid rgba(245, 158, 11, 0.35)'
          }}
        >
          <p className="text-[13px] font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
            Por que vale a pena
          </p>
          <ul className="grid gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
            {[
              'Vários chips WhatsApp no mesmo painel',
              'Campanhas com limite diário e atraso inteligente',
              'Importação de contatos, listas e etiquetas',
              'Relatórios de entrega, leitura e respostas',
              'Central de chat com contexto de disparo'
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3 pt-1">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-black/20 text-amber-100">
              Mensal · {priceMonthly}
            </span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-black/20 text-amber-100">
              Anual · {priceAnnual}
            </span>
          </div>
          <p className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
            Valores de referência para divulgação; o checkout confirma o valor final no Mercado Pago / Infinite Pay.
          </p>
        </div>

        <section>
          <p className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
            Mercado Pago (assinatura)
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={busy}
              leftIcon={loading === 'mp-monthly' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              onClick={() => startMp('monthly')}
            >
              Mensal
            </Button>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={busy}
              leftIcon={loading === 'mp-annual' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              onClick={() => startMp('annual')}
            >
              Anual
            </Button>
          </div>
        </section>
        <section>
          <p className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
            Infinite Pay (link de pagamento)
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={busy}
              leftIcon={loading === 'ip-monthly' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              onClick={() => startIp('monthly')}
            >
              Mensal
            </Button>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={busy}
              leftIcon={loading === 'ip-annual' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              onClick={() => startIp('annual')}
            >
              Anual
            </Button>
          </div>
        </section>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Apos o pagamento, o servidor atualiza seu acesso automaticamente. O plano mensal soma 1 mes calendario por cobranca; o anual soma 12 meses (como no calendario, nao apenas 30 dias fixos).
        </p>
      </div>
    </Modal>
  );
};
