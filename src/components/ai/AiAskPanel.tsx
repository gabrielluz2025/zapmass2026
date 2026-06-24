import React, { useState } from 'react';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { aiAsk } from '../../services/aiApi';
import { useAiStatus } from '../../hooks/useAiStatus';

type Props = {
  screen: string;
  context?: unknown;
  placeholder?: string;
  compact?: boolean;
};

/** Painel de pergunta livre à IA (contexto da tela atual). */
export const AiAskPanel: React.FC<Props> = ({
  screen,
  context,
  placeholder = 'Pergunte como organizar, corrigir ou melhorar…',
  compact = false,
}) => {
  const { configured, loading: statusLoading } = useAiStatus();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (statusLoading) return null;
  if (!configured) return null;

  const ask = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await aiAsk(screen, q, context);
      if (!res.ok) throw new Error(res.error || 'Falha na IA');
      setAnswer(res.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao consultar IA');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={`zm-ai-ask-fab${compact ? ' zm-ai-ask-fab--compact' : ''}`}
        onClick={() => setOpen(true)}
        title="Assistente IA"
      >
        <Sparkles className="w-4 h-4" />
        {!compact && <span>Assistente IA</span>}
      </button>
    );
  }

  return (
    <div className="zm-ai-ask-panel">
      <header className="zm-ai-ask-panel__head">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span>Assistente IA</span>
        <button type="button" className="zm-ai-ask-panel__close" onClick={() => setOpen(false)} aria-label="Fechar">
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="zm-ai-ask-panel__body">
        <textarea
          className="zm-ai-ask-panel__input"
          rows={compact ? 2 : 3}
          placeholder={placeholder}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask();
          }}
        />
        <button type="button" className="zm-ai-ask-panel__send" onClick={() => void ask()} disabled={loading || !question.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Perguntar
        </button>
        {error && <p className="zm-ai-ask-panel__error">{error}</p>}
        {answer && (
          <div className="zm-ai-ask-panel__answer">
            {answer}
            <p className="zm-ai-ask-panel__data-note">Resposta com dados ao vivo da sua conta.</p>
          </div>
        )}
      </div>
    </div>
  );
};
