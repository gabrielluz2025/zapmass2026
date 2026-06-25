import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Send, Sparkles, User } from 'lucide-react';
import { aiAsk } from '../../services/aiApi';
import { useAiStatus } from '../../hooks/useAiStatus';
import { getAiSuggestions } from './aiSuggestedQuestions';
import { AiAnswerText } from './AiAnswerText';
import type { AiAssistPayload } from '../../utils/aiAssistEvents';

type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type Props = {
  screen: string;
  context?: unknown;
  variant?: 'drawer' | 'page';
  placeholder?: string;
  assistPayload?: AiAssistPayload | null;
  onAssistPayloadConsumed?: () => void;
};

export const AiAssistantChat: React.FC<Props> = ({
  screen,
  context,
  variant = 'drawer',
  placeholder = 'Pergunte sobre contatos, bairros, campanhas, listas…',
  assistPayload,
  onAssistPayloadConsumed
}) => {
  const { configured, loading: statusLoading, model } = useAiStatus();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => getAiSuggestions(screen), [screen]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [turns, loading, scrollToBottom]);

  const ask = useCallback(
    async (raw: string, ctxOverride?: unknown) => {
      const q = raw.trim();
      if (!q || loading || !configured) return;
      setQuestion('');
      setError('');
      const userTurn: ChatTurn = { id: `u_${Date.now()}`, role: 'user', text: q };
      setTurns((prev) => [...prev, userTurn]);
      setLoading(true);
      try {
        const res = await aiAsk(screen, q, ctxOverride ?? context);
        if (!res.ok) throw new Error(res.error || 'Falha na IA');
        setTurns((prev) => [
          ...prev,
          { id: `a_${Date.now()}`, role: 'assistant', text: res.answer },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao consultar IA');
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [configured, context, loading, screen]
  );

  useEffect(() => {
    if (!assistPayload?.question || !configured || loading) return;
    const ctx = assistPayload.context ?? context;
    if (assistPayload.autoSend) {
      void ask(assistPayload.question, ctx);
    } else {
      setQuestion(assistPayload.question);
    }
    onAssistPayloadConsumed?.();
  }, [assistPayload, configured, loading, ask, context, onAssistPayloadConsumed]);

  if (statusLoading) {
    return (
      <div className={`zm-ai-chat zm-ai-chat--${variant} zm-ai-chat--loading`}>
        <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className={`zm-ai-chat zm-ai-chat--${variant}`}>
        <p className="zm-ai-not-configured">
          IA não configurada no servidor. Adicione <code>GEMINI_API_KEY</code> no .env da VPS.
        </p>
      </div>
    );
  }

  return (
    <div className={`zm-ai-chat zm-ai-chat--${variant}`}>
      {variant === 'page' && (
        <header className="zm-ai-chat__hero">
          <div className="zm-ai-chat__hero-icon">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="zm-ai-chat__hero-title">Assistente IA</h1>
            <p className="zm-ai-chat__hero-sub">
              Análises profundas com Gemini — importação, mapa, textos e perguntas abertas.
              {model ? ` Modelo: ${model}.` : ''}
            </p>
          </div>
        </header>
      )}

      {turns.length === 0 && (
        <p className="zm-ai-cost-banner">
          <strong>Custo:</strong> cada pergunta consome a API Gemini. Para números simples (contatos, chips),
          use o botão <strong>Assistente</strong> verde na barra — é grátis.
        </p>
      )}

      <div className="zm-ai-chat__messages" ref={scrollRef}>
        {turns.length === 0 && !loading && (
          <div className="zm-ai-chat__welcome">
            <div className="zm-ai-chat__welcome-icon">
              <Bot className="w-8 h-8" />
            </div>
            <p className="zm-ai-chat__welcome-title">Olá! Sou seu assistente no ZapMass.</p>
            <p className="zm-ai-chat__welcome-hint">
              Pergunte sobre sua base, bairros, campanhas ou conversas — ou toque numa sugestão abaixo.
            </p>
            <div className="zm-ai-capabilities">
              <div className="zm-ai-capability">
                <span className="zm-ai-capability__title">Importação</span>
                <span className="zm-ai-capability__desc">Organizar CSV, colar listas, corrigir nomes</span>
              </div>
              <div className="zm-ai-capability">
                <span className="zm-ai-capability__title">Mapa</span>
                <span className="zm-ai-capability__desc">Bairros, cidades, dados incompletos</span>
              </div>
              <div className="zm-ai-capability">
                <span className="zm-ai-capability__title">Textos</span>
                <span className="zm-ai-capability__desc">Mensagens de campanha criativas</span>
              </div>
            </div>
          </div>
        )}

        {turns.map((t) => (
          <div
            key={t.id}
            className={`zm-ai-bubble zm-ai-bubble--${t.role}`}
          >
            <div className="zm-ai-bubble__avatar" aria-hidden>
              {t.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            </div>
            <div className="zm-ai-bubble__body">
              {t.role === 'assistant' ? <AiAnswerText text={t.text} /> : <p>{t.text}</p>}
              {t.role === 'assistant' && (
                <span className="zm-ai-bubble__badge">Gemini · dados ao vivo</span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="zm-ai-bubble zm-ai-bubble--assistant zm-ai-bubble--typing">
            <div className="zm-ai-bubble__avatar" aria-hidden>
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="zm-ai-bubble__body">
              <span className="zm-ai-typing">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Analisando seus dados…
              </span>
            </div>
          </div>
        )}
      </div>

      {error && <p className="zm-ai-chat__error">{error}</p>}

      <div className="zm-ai-suggestions" role="group" aria-label="Perguntas sugeridas">
        <span className="zm-ai-suggestions__label">Sugestões</span>
        <div className="zm-ai-suggestions__scroll">
          {suggestions.map((s) => (
            <button
              key={s.question}
              type="button"
              className="zm-ai-suggestion-chip"
              disabled={loading}
              onClick={() => void ask(s.question)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="zm-ai-composer">
        <textarea
          ref={inputRef}
          className="zm-ai-composer__input"
          rows={variant === 'page' ? 2 : 2}
          placeholder={placeholder}
          value={question}
          disabled={loading}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <button
          type="button"
          className="zm-ai-composer__send"
          disabled={loading || !question.trim()}
          onClick={() => void ask(question)}
          title="Enviar (Enter)"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      <p className="zm-ai-composer__hint">Enter envia · Shift+Enter nova linha</p>
    </div>
  );
};
