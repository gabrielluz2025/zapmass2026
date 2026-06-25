import React, { useCallback, useState } from 'react';
import { Bot, ClipboardCopy, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SessionUser } from '../../types/sessionUser';
import { Button } from '../ui';
import { useAiStatus } from '../../hooks/useAiStatus';
import {
  adminOpsAssistantQuestion,
  fetchAdminOpsReport,
  formatAdminOpsReportMarkdown
} from '../../utils/buildAdminOpsReport';
import { dispatchAiAssistPayload } from '../../utils/aiAssistEvents';

type Props = {
  user: SessionUser | null;
  className?: string;
};

export const AdminSendOpsToAssistantButton: React.FC<Props> = ({ user, className }) => {
  const { configured: aiConfigured, loading: aiLoading } = useAiStatus();
  const [loading, setLoading] = useState(false);

  const collectReport = useCallback(async () => {
    if (!user) throw new Error('Sessão expirada');
    const token = await user.getIdToken();
    return fetchAdminOpsReport(token);
  }, [user]);

  const sendToAssistant = useCallback(async () => {
    if (!user || loading) return;
    if (!aiConfigured) {
      toast.error('Assistente IA não configurado (GEMINI_API_KEY na VPS).');
      return;
    }
    setLoading(true);
    try {
      const bundle = await collectReport();
      dispatchAiAssistPayload({
        screen: 'admin-ops',
        question: adminOpsAssistantQuestion(),
        context: { relatorioServidor: bundle },
        autoSend: true
      });
      toast.success('Relatório enviado ao Assistente IA');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao coletar métricas');
    } finally {
      setLoading(false);
    }
  }, [aiConfigured, collectReport, loading, user]);

  const copyReport = useCallback(async () => {
    if (!user || loading) return;
    setLoading(true);
    try {
      const bundle = await collectReport();
      const md = formatAdminOpsReportMarkdown(bundle);
      await navigator.clipboard.writeText(md);
      toast.success('Relatório copiado — cole no chat (Cursor ou suporte)');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao copiar relatório');
    } finally {
      setLoading(false);
    }
  }, [collectReport, loading, user]);

  if (!user) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      <Button
        type="button"
        variant="primary"
        size="sm"
        loading={loading}
        disabled={aiLoading || !aiConfigured}
        leftIcon={
          loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
          )
        }
        onClick={() => void sendToAssistant()}
        title={
          aiConfigured
            ? 'Coleta métricas desta aba e envia ao Assistente IA (Gemini)'
            : 'Configure GEMINI_API_KEY na VPS'
        }
      >
        Enviar ao Assistente IA
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={loading}
        leftIcon={<ClipboardCopy className="w-3.5 h-3.5" aria-hidden />}
        onClick={() => void copyReport()}
        title="Copia relatório em Markdown para colar no Cursor ou chat externo"
      >
        Copiar relatório
      </Button>
      {!aiConfigured && !aiLoading && (
        <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
          <Bot className="w-3 h-3" aria-hidden />
          IA off — use Copiar relatório
        </span>
      )}
    </div>
  );
};
