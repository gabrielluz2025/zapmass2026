import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import {
  askAssistant,
  fetchAssistantStatus,
  type AssistantMessage,
  type AssistantStatus
} from '../../services/assistantApi';

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

type Props = {
  open: boolean;
  onClose: () => void;
  currentView?: string;
  onNavigate?: (view: string) => void;
};

export const AssistantPanel: React.FC<Props> = ({ open, onClose, currentView, onNavigate }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
  }, [messages, open]);

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

      setStatus((s) =>
        s ? { ...s, remainingToday: res.remainingToday, llmEnabled: res.usedLlm || s.llmEnabled } : s
      );

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

  const suggestions = status?.suggestions ?? [
    'Quantos contatos tenho?',
    'Como conectar um chip?',
    'Resumo da minha conta'
  ];

  return (
    <>
      <div
        className="fixed inset-0 zm-layer-modal bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 z-[60] flex h-full w-full max-w-md flex-col border-l shadow-2xl"
        style={{ background: 'var(--surface-0)', borderColor: 'var(--border)' }}
        role="dialog"
        aria-label="Assistente ZapMass"
      >
        <header
          className="flex items-center gap-3 border-b px-4 py-3 shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(59,130,246,0.12))' }}
          >
            <Bot className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>
              Assistente ZapMass
            </h2>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
              {status
                ? `${status.remainingToday} perguntas restantes hoje${status.llmEnabled ? ` · IA ${status.provider}` : ' · sem custo de API'}`
                : 'Carregando…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: 'var(--text-2)' }}
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div
              className="rounded-xl border p-4 space-y-3"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
            >
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                Pergunte sobre o sistema ou peça seus números (contatos, campanhas, chips). A maior parte das
                respostas é **grátis** — sem Gemini.
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                <Sparkles className="h-3 w-3" /> Sugestões
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void sendQuestion(s)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors hover:bg-[var(--surface-2)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className="max-w-[92%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
                style={
                  m.role === 'user'
                    ? { background: 'var(--brand-500)', color: '#fff' }
                    : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
                }
              >
                {m.role === 'assistant' ? renderAnswerText(m.content) : m.content}
                {m.navigateTo && onNavigate && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(m.navigateTo!);
                      onClose();
                    }}
                    className="mt-2 block text-[11px] font-semibold underline"
                    style={{ color: m.role === 'user' ? '#fff' : 'var(--brand-500)' }}
                  >
                    Abrir tela →
                  </button>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Pensando…
            </div>
          )}
        </div>

        <footer
          className="border-t p-3 shrink-0 space-y-2"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <div className="flex gap-2 items-end">
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
              className="flex-1 resize-none rounded-xl border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface-0)',
                color: 'var(--text-1)'
              }}
              disabled={sending}
            />
            <button
              type="button"
              onClick={() => void sendQuestion(input)}
              disabled={sending || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-40 transition-opacity"
              style={{ background: 'var(--brand-500)' }}
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[10px] text-center" style={{ color: 'var(--text-3)' }}>
            Enter envia · Shift+Enter quebra linha
          </p>
        </footer>
      </aside>
    </>
  );
};
