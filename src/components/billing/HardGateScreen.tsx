import React, { useState } from 'react';
import { Loader2, Sparkles, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialDurationPhrase, formatTrialHoursLabel } from '../../utils/trialCopy';
import { persistTrialEndFromServer } from '../../utils/trialLocalEnd';
import { Button } from '../ui';
import { UpgradeProModal } from './UpgradeProModal';

/**
 * Primeiro acesso com cobranca ativa e sem documento no Firestore: oferece teste 1h ou pagamento.
 */
export const HardGateScreen: React.FC = () => {
  const { user, signOut } = useAuth();
  const { config } = useAppConfig();
  const [trialLoading, setTrialLoading] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

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
        toast.error(typeof data?.error === 'string' ? data.error : 'Nao foi possivel iniciar o teste.');
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
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
        style={{
          background: 'linear-gradient(135deg, #10b981, #059669)',
          boxShadow: '0 12px 40px rgba(16,185,129,0.3)'
        }}
      >
        <Zap className="w-7 h-7 text-white fill-white" />
      </div>
      <div
        className="max-w-lg w-full rounded-2xl border p-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
      >
        <div className="flex justify-center mb-2">
          <Sparkles className="w-5 h-5 text-emerald-500" />
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          Bem-vindo ao ZapMass
        </h1>
        <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-2)' }}>
          Para usar disparos, conexoes e campanhas com a cobranca ativa neste ambiente, escolha um teste gratuito de{' '}
          {formatTrialDurationPhrase(config.trialHours)} ou assine o plano Pro (mensal ou anual).
        </p>
        <p className="text-[11px] leading-relaxed mb-5 px-1" style={{ color: 'var(--text-3)' }}>
          O WhatsApp e da Meta: banimentos e LGPD sao de responsabilidade de quem envia. Depois do acesso, leia{' '}
          <strong>Configuracoes → WhatsApp / LGPD</strong> e a opcao de vincular a API oficial se for o seu caso.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="primary"
            type="button"
            disabled={trialLoading}
            leftIcon={trialLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            onClick={startTrial}
          >
            Teste {formatTrialHoursLabel(config.trialHours)} gratis
          </Button>
          <Button variant="secondary" type="button" onClick={() => setUpgradeOpen(true)}>
            Assinar Pro
          </Button>
        </div>
        <button
          type="button"
          className="mt-6 text-[12px] underline-offset-2 hover:underline"
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
