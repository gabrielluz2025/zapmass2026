import React, { useCallback, useState } from 'react';
import { Tags } from 'lucide-react';
import toast from 'react-hot-toast';
import { autoApplyReplyIntents } from '../../services/replyIntentApi';
import { Button } from '../ui';

type Props = {
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
  /** Texto curto no botão */
  label?: string;
};

export const ClassifyPendingReplyIntentsButton: React.FC<Props> = ({
  size = 'sm',
  variant = 'secondary',
  className,
  label = 'Classificar respostas pendentes',
}) => {
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    const ok = window.confirm(
      'Varre todas as conversas do workspace e aplica os gatilhos do fluxo (quero / sair):\n\n' +
        '• «Quero» / interesse → lista quente\n' +
        '• «Sair» → lista negra\n' +
        '• Quem disse «quero» e depois «sair» → lista negra\n\n' +
        'Não reenvia o texto automático do fluxo — só classifica quem ficou sem roteamento.\n' +
        'Threads de aquecimento são ignoradas.\n\n' +
        'Continuar?'
    );
    if (!ok) return;

    setLoading(true);
    try {
      const preview = await autoApplyReplyIntents({ excludeWarmup: true, dryRun: true });
      if (preview.eligible === 0) {
        const parts = [
          `${preview.scanned} conversas analisadas`,
          preview.withInbound > 0 ? `${preview.withInbound} com resposta` : null,
          preview.skippedWarmup > 0 ? `${preview.skippedWarmup} só aquecimento` : null,
          preview.skippedNeutral > 0 ? `${preview.skippedNeutral} neutras/cortesia` : null,
        ].filter(Boolean);
        toast(
          `Nenhuma resposta «quero» ou «sair» pendente.${parts.length ? ` (${parts.join(' · ')})` : ''}`,
          { icon: 'ℹ️', duration: 6000 }
        );
        return;
      }
      const confirmApply = window.confirm(
        `Encontradas ${preview.eligible} conversa(s) para classificar:\n` +
          `• ${preview.appliedHot} quente(s)\n` +
          `• ${preview.appliedBlacklist} lista negra` +
          (preview.queroThenSair > 0 ? ` (incl. ${preview.queroThenSair} quero→sair)` : '') +
          '\n\nAplicar agora?'
      );
      if (!confirmApply) return;

      const result = await autoApplyReplyIntents({ excludeWarmup: true });
      toast.success(
        `Classificação concluída: ${result.appliedHot} quente(s), ${result.appliedBlacklist} lista negra.` +
          (result.queroThenSair > 0 ? ` (${result.queroThenSair} quero→sair)` : '')
      );
      if (result.skippedNoContact > 0) {
        toast(`${result.skippedNoContact} sem cadastro na base — opt-out/quente aplicado só pelo telefone.`, {
          icon: 'ℹ️',
        });
      }
      if (result.errors.length > 0) {
        toast(`${result.errors.length} erro(s) — veja logs do servidor.`, { icon: '⚠️' });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na classificação.');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={loading}
      leftIcon={<Tags className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />}
      onClick={() => void run()}
    >
      {loading ? 'Classificando…' : label}
    </Button>
  );
};
