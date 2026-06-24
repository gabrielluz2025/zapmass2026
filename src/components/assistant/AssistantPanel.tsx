import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronRight,
  Database,
  Loader2,
  Send,
  Sparkles,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAiStatus } from '../../hooks/useAiStatus';
import {
  askAssistant,
  fetchAssistantStatus,
  type AssistantMessage,
  type AssistantStatus
} from '../../services/assistantApi';
import {
  getAssistantSuggestions,
  VIEW_LABEL_PT
} from './assistantSuggestedQuestions';

function renderAnswerText(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ color: 'var(--text-1)' }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function sourceLabel(source?: string): { text: string; className: string } | null {
  switch (source) {
    case 'tools':
      return { text: 'Dados ao vivo', className: 'zm-asst-source zm-asst-source--tools' };
    case 'rag':
      return { text: 'Tutorial', className: 'zm-asst-source zm-asst-source--rag' };
    case 'cache':
      return { text: 'Resposta salva', className: 'zm-asst-source zm-asst-source--cache' };
    case 'llm':
      return { text: 'IA externa', className: 'zm-asst-source zm-asst-source--llm' };
    default:
      return { text: 'Grátis', className: 'zm-asst-source zm-asst-source--rag' };
  }
}

const QUICK_ACTIONS = [
  { id: 'overview', label: 'Resumo', hint: 'Números da conta', question: 'Resumo da minha conta', Icon: BarChart3 },
  { id: 'chips', label: 'Chips', hint: 'Online/offline', question: 'Quantos chips estão online?', Icon: Database },
  { id: 'contacts', label: 'Contatos', hint: 'Total na base', question: 'Quantos contatos tenho?', Icon: Database },
  { id: 'help', label: 'Tutorial', hint: 'Como usar', question: 'Por onde começar no ZapMass?', Icon: BookOpen }
] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  currentView?: string;
  onNavigate?: (view: string) => void;
  onOpenGemini?: () => void;
};

export const AssistantPanel: React.FC<Props> = ({
  open,
  onClose,
  currentView,
  onNavigate,
  onOpenGemini
}) => {
  const { user } = useAuth();
  const { configured: geminiConfigured } = useAiStatus();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const screenLabel = VIEW_LABEL_PT[currentView || ''] || 'Painel';
  const suggestions = useMemo(
    () => getAssistantSuggestions(currentView || 'dashboard'),
    [currentView]
  );

  const quotaPct = useMemo(() => {
    if (!status?.dailyLimit) return 100;
    return Math.max(0, Math.min(100, (status.remainingToday / status.dailyLimit) * 100));
  }, [status]);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const s = await fetchAssistantStatus(token);
      if (s) setStatus(s);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    if (!open) return;
    void loadStatus();
    inputRef.current?.focus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open, sending]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sendQuestion = async (raw: string) => {
    const question = raw.trim();
    if (!question || !user || sending) return;

    const userMsg: AssistantMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const token = await user.getIdToken();
      const history = [...messages, userMsg].slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await askAssistant(token, { question, currentView, history });

      if (!res.ok) {
        const err = 'error' in res ? res.error : 'Erro desconhecido';
        toast.error(err);
        setStatus((s) => (s ? { ...s, remainingToday: res.remainingToday } : s));
        return;
      }

      setStatus((s) => (s ? { ...s, remainingToday: res.remainingToday } : s));

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.answer,
          navigateTo: res.navigateTo,
          source: res.source
        }
      ]);
    } catch (e) {
      console.error('[Assistant]', e);
      toast.error('Não foi possível obter resposta. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="zm-asst-backdrop" onClick={onClose} aria-hidden />
      <aside className="zm-asst-panel" role="dialog" aria-label="Assistente ZapMass">
        <header className="zm-asst-head">
          <div className="zm-asst-head__row">
            <div className="zm-asst-head__icon">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="zm-asst-head__title">Assistente ZapMass</h2>
              <p className="zm-asst-head__sub">
                <span className="zm-asst-badge zm-asst-badge--free">Grátis</span>{' '}
                <span className="zm-asst-badge zm-asst-badge--screen">Tela: {screenLabel}</span>
              </p>
            </div>
            <button type="button" className="zm-asst-close" onClick={onClose} aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>

          {status && (
            <div className="zm-asst-quota">
              <div className="zm-asst-quota__bar">
                <div className="zm-asst-quota__fill" style={{ width: `${quotaPct}%` }} />
              </div>
              <div className="zm-asst-quota__label">
                <span>{status.remainingToday} de {status.dailyLimit} perguntas hoje</span>
                <span>Sem custo de API</span>
              </div>
            </div>
          )}
        </header>

        <div ref={listRef} className="zm-asst-body">
          {messages.length === 0 && (
            <div className="zm-asst-welcome">
              <p className="zm-asst-welcome__title">Olá! Posso ajudar com o ZapMass.</p>
              <p className="zm-asst-welcome__text">
                Respondo com <strong>dados reais</strong> da sua conta (contatos, chips, campanhas) e com o{' '}
                <strong>tutorial do sistema</strong>. A maior parte é gratuita — não usa Gemini.
              </p>

              <div className="zm-asst-quick">
                {QUICK_ACTIONS.map(({ label, hint, question, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    className="zm-asst-quick__btn"
                    onClick={() => void sendQuestion(question)}
                  >
                    <Icon className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="zm-asst-quick__label">{label}</span>
                    <span className="zm-asst-quick__hint">{hint}</span>
                  </button>
                ))}
              </div>

              <div className="zm-asst-suggestions">
                <span className="zm-asst-suggestions__label">
                  <Sparkles className="inline h-3 w-3 mr-1 -mt-0.5" />
                  Sugestões para {screenLabel}
                </span>
                <div className="zm-asst-suggestions__grid">
                  {suggestions.map((s) => (
                    <button
                      key={s.question}
                      type="button"
                      className="zm-asst-chip"
                      onClick={() => void sendQuestion(s.question)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((m) => {
            const src = m.role === 'assistant' ? sourceLabel(m.source) : null;
            return (
              <div
                key={m.id}
                className={`zm-asst-msg ${m.role === 'user' ? 'zm-asst-msg--user' : 'zm-asst-msg--bot'}`}
              >
                <div
                  className={`zm-asst-bubble ${m.role === 'user' ? 'zm-asst-bubble--user' : 'zm-asst-bubble--bot'}`}
                >
                  {m.role === 'assistant' ? renderAnswerText(m.content) : m.content}
                  {src && <span className={src.className}>{src.text}</span>}
                  {m.navigateTo && onNavigate && (
                    <button
                      type="button"
                      className="zm-asst-nav-btn"
                      onClick={() => {
                        onNavigate(m.navigateTo!);
                        onClose();
                      }}
                    >
                      Abrir {VIEW_LABEL_PT[m.navigateTo] || m.navigateTo}
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="zm-asst-typing">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando seus dados…
            </div>
          )}
        </div>

        <footer className="zm-asst-foot">
          <div className="zm-asst-foot__row">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendQuestion(input);
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="Ex.: quantos chips online? Como importar contatos?"
              className="zm-asst-input"
              disabled={sending}
            />
            <button
              type="button"
              onClick={() => void sendQuestion(input)}
              disabled={sending || !input.trim()}
              className="zm-asst-send"
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="zm-asst-foot__hint">Enter envia · Shift+Enter nova linha</p>
          {geminiConfigured && onOpenGemini && (
            <p className="zm-asst-foot__gemini">
              Para importação inteligente, mapa ou análises profundas, use o{' '}
              <button
                type="button"
                className="underline font-semibold text-violet-400 hover:text-violet-300"
                onClick={() => {
                  onClose();
                  onOpenGemini();
                }}
              >
                Assistente IA (Gemini)
              </button>{' '}
              no canto inferior — consome API paga.
            </p>
          )}
        </footer>
      </aside>
    </>
  );
};
