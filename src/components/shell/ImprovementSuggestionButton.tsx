import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  LayoutGrid,
  Lightbulb,
  Link2,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Send,
  Sparkles,
  Timer,
  UserCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { Modal, Textarea } from '../ui';

interface ImprovementSuggestionButtonProps {
  /** Tela atual (para contextualizar feedback no painel administrativo). */
  currentView?: string;
}

/** Nomes amigáveis para a área atual (URL / view). */
const VIEW_LABEL_PT: Record<string, string> = {
  connections: 'Conexões WhatsApp',
  dashboard: 'Painel',
  chat: 'Chat',
  warmup: 'Aquecimento',
  campaigns: 'Campanhas',
  contacts: 'Contatos',
  reports: 'Relatórios',
  settings: 'Definições',
  subscription: 'Assinatura',
  help: 'Ajuda',
  team: 'Equipa',
  admin: 'Administrador',
  'creator-studio': 'Criador',
  'admin-ops': 'Operações servidor'
};

type SuggestionArea = 'usability' | 'campaigns' | 'reports' | 'integrations' | 'other';

const AREA_CHIPS: {
  id: SuggestionArea;
  label: string;
  hint: string;
  Icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
}[] = [
  {
    id: 'usability',
    label: 'Telas e fluxos',
    hint: 'Navegar, botões, clareza',
    Icon: LayoutGrid
  },
  {
    id: 'campaigns',
    label: 'Campanhas e envios',
    hint: 'Agendar, texto, velocidade',
    Icon: Send
  },
  {
    id: 'reports',
    label: 'Relatórios e números',
    hint: 'Exportar, filtros',
    Icon: BarChart3
  },
  {
    id: 'integrations',
    label: 'Conexões e canais',
    hint: 'WhatsApp, estabilidade',
    Icon: Link2
  },
  {
    id: 'other',
    label: 'Outro tema',
    hint: 'Qualquer ideia livre',
    Icon: MoreHorizontal
  }
];

const MAX_LEN = 2000;
/** Pausa após envio bem-sucedido antes de fechar o modal (tempo para ler a confirmação). */
const SUCCESS_MS = 2000;

function viewLabelPt(view?: string): string {
  if (!view || typeof view !== 'string') return '';
  const v = view.trim();
  return VIEW_LABEL_PT[v] || v.replace(/-/g, ' ');
}

/**
 * Botão «Sugestões» na barra: modal guiado por área temática + contexto da tela.
 * Persistência via API (`/api/product-suggestion`) com Admin SDK.
 */
export const ImprovementSuggestionButton: React.FC<ImprovementSuggestionButtonProps> = ({
  currentView
}) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [area, setArea] = useState<SuggestionArea>('usability');
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<'form' | 'success'>('form');
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const whereLabel = useMemo(() => viewLabelPt(currentView), [currentView]);

  useEffect(() => {
    if (!open) return;
    setPhase('form');
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const requestClose = () => {
    if (sending) return;
    if (phase === 'success') {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setOpen(false);
      setPhase('form');
      return;
    }
    setOpen(false);
  };

  if (!user) return null;

  const trimmedLen = text.trim().length;

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length < 1) {
      toast.error('Escreva pelo menos uma frase sobre a sua ideia.');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      toast.error(`Use no máximo ${MAX_LEN} caracteres.`);
      return;
    }
    setSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/product-suggestion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          text: trimmed,
          screen: typeof currentView === 'string' ? currentView.slice(0, 64) : '',
          category: area
        })
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data?.ok !== true) {
        throw new Error(
          typeof data?.error === 'string' && data.error.length > 0 ? data.error : `HTTP ${res.status}`
        );
      }
      setText('');
      setArea('usability');
      setPhase('success');
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setOpen(false);
        setPhase('form');
      }, SUCCESS_MS);
    } catch (e) {
      console.error('[Suggestion]', e);
      const msg =
        e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : '';
      toast.error(
        msg.length > 0
          ? `Não foi possível enviar (${msg}). Tente novamente.`
          : 'Não foi possível enviar. Verifique a ligação e tente novamente.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative flex h-9 items-center gap-1.5 pl-2.5 pr-2.5 sm:pr-3.5 rounded-full border shrink-0 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] overflow-hidden"
        style={{
          borderColor: 'rgba(245, 158, 11, 0.35)',
          color: 'var(--text-2)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 16px rgba(245,158,11,0.08)',
          background: 'linear-gradient(135deg, var(--surface-2) 0%, rgba(245,158,11,0.07) 100%)'
        }}
        title="Partilhar uma ideia ou sugestão sobre o ZapMass"
        aria-label="Abrir sugestão de melhoria"
      >
        <span
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: 'linear-gradient(120deg, rgba(245,158,11,0.12), rgba(139,92,246,0.08), transparent)'
          }}
        />
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'rgba(245,158,11,0.15)' }}>
          <Sparkles className="w-3.5 h-3.5 text-amber-500" aria-hidden />
        </span>
        <span className="relative text-[11px] font-semibold tracking-tight hidden sm:inline bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 bg-clip-text text-transparent">
          Ideias
        </span>
      </button>

      <Modal
        isOpen={open}
        onClose={requestClose}
        title={phase === 'success' ? 'Recebemos a sua ideia' : 'A sua voz faz a diferença'}
        subtitle={
          phase === 'success'
            ? 'Obrigado por dedicar um minuto ao ZapMass.'
            : 'Sem formulário gigante — escolha o tema, escreva o essencial e nós tratamos do resto.'
        }
        icon={
          phase === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden />
          ) : (
            <Lightbulb className="w-5 h-5 text-amber-500" />
          )
        }
        size="lg"
        closeOnBackdrop={!sending}
        footer={
          phase === 'form' ? (
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-3 w-full">
              <p className="text-[11px] text-left order-2 sm:order-1 max-w-[20rem]" style={{ color: 'var(--text-3)' }}>
                Não usamos esta mensagem para marketing. Serve só para entender prioridades no produto.
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-2 order-1 sm:order-2 w-full sm:w-auto">
                <Button variant="ghost" disabled={sending} onClick={requestClose}>
                  Agora não
                </Button>
                <Button
                  variant="primary"
                  disabled={sending || trimmedLen < 1}
                  leftIcon={<Send className="w-4 h-4 shrink-0" />}
                  onClick={() => void submit()}
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                    boxShadow: '0 10px 24px rgba(245,158,11,0.28)'
                  }}
                >
                  {sending ? 'A enviar…' : 'Enviar mensagem'}
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {phase === 'success' ? (
          <div
            className="flex flex-col items-center justify-center py-10 sm:py-14 px-2 text-center animate-in fade-in zoom-in-95 duration-500"
            role="status"
            aria-live="polite"
          >
            <div className="relative mb-6">
              <span
                className="absolute inset-0 rounded-full animate-ping opacity-30"
                style={{
                  background: 'radial-gradient(circle, rgba(16,185,129,0.55) 0%, transparent 70%)',
                  transform: 'scale(1.4)'
                }}
              />
              <div
                className="relative flex h-20 w-20 items-center justify-center rounded-full border-4"
                style={{
                  borderColor: 'rgba(16,185,129,0.35)',
                  background: 'linear-gradient(145deg, rgba(16,185,129,0.12), rgba(16,185,129,0.04))',
                  animation: 'suggestion-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                }}
              >
                <CheckCircle2 className="w-11 h-11 text-emerald-500 drop-shadow-sm" strokeWidth={2.25} aria-hidden />
              </div>
            </div>
            <p className="text-[16px] sm:text-[17px] font-bold" style={{ color: 'var(--text-1)' }}>
              Tudo certo — mensagem entregue
            </p>
            <p className="text-[13px] mt-2 max-w-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
              A equipa vai ler com o tema e o contexto da área em que estava. Ideias boas costumam voltar no produto.
            </p>
            <p className="text-[11px] mt-8 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
              <span className="inline-flex gap-0.5" aria-hidden>
                <span className="w-1 h-1 rounded-full bg-emerald-500/80 animate-pulse" />
                <span className="w-1 h-1 rounded-full bg-emerald-500/60 animate-pulse [animation-delay:150ms]" />
                <span className="w-1 h-1 rounded-full bg-emerald-500/40 animate-pulse [animation-delay:300ms]" />
              </span>
              A fechar automaticamente…
            </p>
          </div>
        ) : (
          <div className="space-y-6">
          {/* Faixa inspiracional + contexto */}
          <section
            className="relative overflow-hidden rounded-2xl px-4 py-5 sm:px-5 sm:py-6"
            style={{
              border: '1px solid rgba(139,92,246,0.2)',
              background:
                'linear-gradient(145deg, rgba(245,158,11,0.09) 0%, rgba(139,92,246,0.08) 45%, rgba(14,165,233,0.06) 100%)'
            }}
          >
            <span
              className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-60"
              style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.35) 0%, transparent 70%)' }}
            />
            <span
              className="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full opacity-40"
              style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.25) 0%, transparent 70%)' }}
            />
            <div className="relative z-[1] space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-2)',
                    border: '1px solid rgba(255,255,255,0.06)'
                  }}
                >
                  <Timer className="w-3 h-3 text-amber-500" aria-hidden />
                  Menos de 1 minuto
                </span>
              </div>
              <p className="text-[14px] sm:text-[15px] font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                O que poderíamos acrescentar ou simplificar{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-violet-500">
                  para o seu trabalho ficar mais leve?
                </span>
              </p>
              <p className="text-[12.5px] leading-relaxed max-w-xl" style={{ color: 'var(--text-2)' }}>
                Seja bem direto: o problema de hoje, o que já tentou, e como gostaria que fosse. Quanto mais
                concreto, mais fácil de encaixar no roadmap.
              </p>

              {whereLabel ? (
                <div
                  className="inline-flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[12px]"
                  style={{
                    background: 'var(--surface-0)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-2)'
                  }}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-sky-500" aria-hidden />
                  <span>
                    Quando enviar, registamos automaticamente que estava na área{' '}
                    <strong style={{ color: 'var(--text-1)' }}>{whereLabel}</strong> — assim percebemos onde ocorreu o
                    “clique” ou a confusão.
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          {/* Escolha do tema */}
          <div className="space-y-3">
            <div>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                Sobre qual destes temas é a sua ideia?
              </p>
              <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
                Escolha a que estiver mais perto — assim priorizamos com mais clareza.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {AREA_CHIPS.map(({ id, label, hint, Icon }) => {
                const sel = area === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={sending}
                    onClick={() => setArea(id)}
                    className="text-left rounded-xl px-3.5 py-3 transition-all duration-200 border hover:brightness-[1.03]"
                    style={{
                      borderColor: sel ? 'rgba(245,158,11,0.55)' : 'var(--border-subtle)',
                      background: sel ? 'rgba(245,158,11,0.09)' : 'var(--surface-1)',
                      boxShadow: sel ? '0 0 0 1px rgba(245,158,11,0.15)' : undefined
                    }}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background: sel ? 'rgba(245,158,11,0.2)' : 'var(--surface-2)'
                        }}
                      >
                        <Icon
                          className="w-[18px] h-[18px]"
                          style={{ color: sel ? '#d97706' : 'var(--text-3)' }}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>
                          {label}
                        </span>
                        <span className="block text-[10.5px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                          {hint}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mensagem */}
          <div className="space-y-2">
            <label className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              A sua mensagem
              <span className="text-[11px] font-normal font-mono px-2 py-0.5 rounded-md" style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                {text.length}/{MAX_LEN}
              </span>
            </label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              placeholder="Por exemplo: “No relatório X, queria agrupar por canal e exportar em PDF às segundas.”"
              style={{ minHeight: '148px', fontSize: '13.5px', lineHeight: 1.55 }}
              disabled={sending}
            />
          </div>

          {/* Pillars de confiança */}
          <div
            className="rounded-xl px-4 py-3 grid sm:grid-cols-3 gap-4 sm:gap-3 border"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <div className="flex gap-3 sm:flex-col sm:gap-1.5">
              <MessageCircle className="w-4 h-4 shrink-0 text-emerald-500 sm:mx-auto" aria-hidden />
              <div>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Lida pela equipa
                </p>
                <p className="text-[10.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Analisamos todas as mensagens ao longo do tempo; não há um número de espera nem chat automático aqui.
                </p>
              </div>
            </div>
            <div className="flex gap-3 sm:flex-col sm:gap-1.5 border-t border-b sm:border-0 pt-4 pb-4 sm:p-0" style={{ borderColor: 'var(--border-subtle)' }}>
              <UserCheck className="w-4 h-4 shrink-0 text-indigo-500 sm:mx-auto" aria-hidden />
              <div>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  E-mail apenas para contextualizar
                </p>
                <p className="text-[10.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Associa a conta para evitar spam; não enviamos publicidade através deste canal.
                </p>
              </div>
            </div>
            <div className="flex gap-3 sm:flex-col sm:gap-1.5">
              <Sparkles className="w-4 h-4 shrink-0 text-amber-500 sm:mx-auto" aria-hidden />
              <div>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Ajuda na priorização
                </p>
                <p className="text-[10.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Tema + tela atual + texto livre são o trio que nos diz onde investir primeiro.
                </p>
              </div>
            </div>
          </div>
          </div>
        )}
      </Modal>
    </>
  );
};
