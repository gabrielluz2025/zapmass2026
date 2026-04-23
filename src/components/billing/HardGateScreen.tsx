import React, { useState } from 'react';
import { CheckCircle2, Crown, Loader2, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialDurationPhrase, formatTrialHoursLabel } from '../../utils/trialCopy';
import { persistTrialEndFromServer } from '../../utils/trialLocalEnd';
import { Button } from '../ui';
import { UpgradeProModal } from './UpgradeProModal';

/**
 * Primeiro acesso pós-login: oferece teste gratuito OU assinatura Pro.
 * UI de boas-vindas (não de erro) para maximizar conversão.
 */
export const HardGateScreen: React.FC = () => {
  const { user, signOut } = useAuth();
  const { config } = useAppConfig();
  const [trialLoading, setTrialLoading] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const firstName = (user?.displayName || user?.email?.split('@')[0] || '').split(/\s+/)[0];

  const startTrial = async () => {
    if (!user) return;
    setTrialLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/billing/trial/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Não foi possível iniciar o teste.');
        return;
      }
      persistTrialEndFromServer(typeof data.trialEndsAt === 'string' ? data.trialEndsAt : undefined);
      toast.success(`Teste de ${formatTrialHoursLabel(config.trialHours)} ativado!`);
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setTrialLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Aurora */}
      <div
        aria-hidden
        className="absolute top-[-20%] left-[-10%] w-[560px] h-[560px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(16,185,129,0.18), transparent 65%)',
          filter: 'blur(40px)'
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-[-20%] right-[-10%] w-[520px] h-[520px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.14), transparent 60%)',
          filter: 'blur(50px)'
        }}
      />

      <div className="relative z-10 w-full max-w-lg text-center">
        <div
          className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
          style={{
            background: 'linear-gradient(135deg, #10b981, #059669)',
            boxShadow: '0 18px 48px rgba(16,185,129,0.35)'
          }}
        >
          <Zap className="w-8 h-8 text-white fill-white" />
        </div>

        <div
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3"
          style={{
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.28)'
          }}
        >
          <Sparkles className="w-3 h-3" style={{ color: 'var(--brand-600)' }} />
          <span
            className="text-[10.5px] uppercase tracking-widest font-bold"
            style={{ color: 'var(--brand-600)' }}
          >
            Boas-vindas ao ZapMass
          </span>
        </div>

        <h1
          className="text-[28px] sm:text-[32px] font-black leading-[1.05] mb-3"
          style={{ color: 'var(--text-1)' }}
        >
          {firstName ? `Olá, ${firstName}` : 'Olá'} 👋<br />
          Escolha como quer começar
        </h1>
        <p className="text-[14px] leading-relaxed mb-7 max-w-md mx-auto" style={{ color: 'var(--text-2)' }}>
          Ative o teste gratuito de {formatTrialDurationPhrase(config.trialHours)} para testar agora, sem cartão,
          ou assine o Pro direto com Pix, cartão ou débito automático.
        </p>

        {/* Cards lado a lado: trial vs pro */}
        <div className="grid sm:grid-cols-2 gap-3 mb-6 text-left">
          <div
            className="rounded-xl p-4 flex flex-col justify-between"
            style={{
              background:
                'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.02))',
              border: '1px solid rgba(16,185,129,0.3)'
            }}
          >
            <div>
              <div
                className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest mb-2 px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(16,185,129,0.18)',
                  color: 'var(--brand-600)'
                }}
              >
                Recomendado
              </div>
              <h2 className="text-[15px] font-extrabold" style={{ color: 'var(--text-1)' }}>
                Teste grátis {formatTrialHoursLabel(config.trialHours)}
              </h2>
              <p className="text-[11.5px] mt-1 mb-3" style={{ color: 'var(--text-3)' }}>
                Sem cartão. Acesso completo ao painel, conexões e campanhas durante o período.
              </p>
              <ul className="space-y-1 text-[11.5px]" style={{ color: 'var(--text-2)' }}>
                <TrialPerk>Criar campanhas e conectar chips</TrialPerk>
                <TrialPerk>Testar envio e ver relatórios reais</TrialPerk>
                <TrialPerk>Sem surpresas: zero cobrança</TrialPerk>
              </ul>
            </div>
            <Button
              variant="primary"
              type="button"
              disabled={trialLoading}
              leftIcon={trialLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              onClick={startTrial}
              className="mt-4 w-full"
            >
              {trialLoading ? 'Ativando…' : 'Começar teste grátis'}
            </Button>
          </div>

          <div
            className="rounded-xl p-4 flex flex-col justify-between"
            style={{
              background: 'var(--surface-0)',
              border: '1px solid var(--border)'
            }}
          >
            <div>
              <div
                className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest mb-2 px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(245,158,11,0.15)',
                  color: '#d97706'
                }}
              >
                <Crown className="w-3 h-3" />
                Assine agora
              </div>
              <h2 className="text-[15px] font-extrabold" style={{ color: 'var(--text-1)' }}>
                ZapMass Pro
              </h2>
              <p className="text-[11.5px] mt-1 mb-3" style={{ color: 'var(--text-3)' }}>
                Acesso imediato e ilimitado. Pix com 5% off, cartão parcelado ou débito automático.
              </p>
              <ul className="space-y-1 text-[11.5px]" style={{ color: 'var(--text-2)' }}>
                <TrialPerk>Todos os recursos liberados</TrialPerk>
                <TrialPerk>Cancele quando quiser</TrialPerk>
                <TrialPerk>Suporte prioritário</TrialPerk>
              </ul>
            </div>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setUpgradeOpen(true)}
              leftIcon={<Crown className="w-4 h-4" />}
              className="mt-4 w-full"
            >
              Ver planos e preços
            </Button>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-center gap-3 mb-5 text-[11.5px]"
          style={{ color: 'var(--text-3)' }}
        >
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--brand-600)' }} />
            Pagamento via Mercado Pago
          </span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--brand-600)' }} />
            Cancele a qualquer momento
          </span>
        </div>

        <p
          className="text-[11px] leading-relaxed max-w-md mx-auto px-1"
          style={{ color: 'var(--text-3)' }}
        >
          O WhatsApp é da Meta. Banimentos e responsabilidades LGPD são de quem envia.
          Depois do acesso, confira <strong>Configurações → WhatsApp / LGPD</strong>.
        </p>

        <button
          type="button"
          className="mt-5 text-[12px] underline-offset-2 hover:underline"
          style={{ color: 'var(--text-3)' }}
          onClick={() => signOut()}
        >
          Sair e usar outra conta
        </button>
      </div>

      <UpgradeProModal isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </div>
  );
};

const TrialPerk: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex items-start gap-1.5">
    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--brand-600)' }} />
    <span>{children}</span>
  </li>
);
