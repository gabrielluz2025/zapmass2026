import React, { useCallback, useState } from 'react';
import {
  Workflow,
  StickyNote,
  Tag,
  Bell,
  LayoutGrid,
  Image as ImageIcon,
  Pin,
  Search,
  Zap,
  ShieldCheck,
  ArrowRight,
  EyeOff,
  Eye
} from 'lucide-react';

const INTRO_HIDDEN_KEY = 'zapmass-chat-pipeline-intro-hidden';

function readIntroHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(INTRO_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  totalConversations: number;
  totalUnread: number;
  totalChannels: number;
  crmStats: {
    total: number;
    pinned: number;
    leads: number;
    clientes: number;
    pendentes: number;
    resolvidos: number;
    comReminder: number;
  };
}

/**
 * Empty state do painel de chat — “showcase” quando nenhuma conversa está selecionada.
 */
export const ChatEmptyShowcase: React.FC<Props> = ({
  totalConversations,
  totalUnread,
  totalChannels,
  crmStats
}) => {
  const [introHidden, setIntroHiddenState] = useState(readIntroHidden);

  const setIntroHidden = useCallback((hidden: boolean) => {
    setIntroHiddenState(hidden);
    try {
      if (hidden) window.localStorage.setItem(INTRO_HIDDEN_KEY, '1');
      else window.localStorage.removeItem(INTRO_HIDDEN_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const features = [
    { icon: <StickyNote className="w-4 h-4 stroke-[2]" />, label: 'Anotações privadas', hint: 'Histórico por cliente' },
    { icon: <Tag className="w-4 h-4 stroke-[2]" />, label: 'Tags coloridas', hint: 'VIP, lead, urgente…' },
    { icon: <Bell className="w-4 h-4 stroke-[2]" />, label: 'Lembretes', hint: 'Follow-up automatizado' },
    { icon: <LayoutGrid className="w-4 h-4 stroke-[2]" />, label: 'Quadro Kanban', hint: 'Arraste entre etapas' },
    { icon: <ImageIcon className="w-4 h-4 stroke-[2]" />, label: 'Galeria de mídias', hint: 'Ficheiros ligados ao contacto' },
    { icon: <Pin className="w-4 h-4 stroke-[2]" />, label: 'Fixar contacto', hint: 'Prioridade na lista' },
    { icon: <Search className="w-4 h-4 stroke-[2]" />, label: 'Busca no chat', hint: 'Texto por conversa' },
    { icon: <ShieldCheck className="w-4 h-4 stroke-[2]" />, label: 'Auditoria', hint: 'Limpar conversas inválidas' }
  ];

  const crmCount =
    crmStats.pinned +
    crmStats.leads +
    crmStats.clientes +
    crmStats.pendentes +
    crmStats.resolvidos;

  const kpiItems = [
    {
      label: 'Conversas',
      value: totalConversations,
      wash: 'radial-gradient(circle at 85% 15%, color-mix(in srgb, #f59e0b 20%, transparent), transparent 55%)'
    },
    {
      label: 'Não lidas',
      value: totalUnread,
      wash: 'radial-gradient(circle at 85% 15%, color-mix(in srgb, #8b5cf6 18%, transparent), transparent 55%)'
    },
    {
      label: 'Canais',
      value: totalChannels,
      wash: 'radial-gradient(circle at 85% 15%, color-mix(in srgb, #0ea5e9 18%, transparent), transparent 55%)'
    },
    {
      label: 'No CRM',
      value: crmCount,
      wash: 'radial-gradient(circle at 85% 15%, color-mix(in srgb, #10b981 16%, transparent), transparent 55%)'
    }
  ];

  if (introHidden) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center min-h-0 px-4 py-8"
        style={{ background: 'var(--surface-0)' }}
      >
        <div
          className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 rounded-2xl px-5 py-4 max-w-lg w-full"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 12px 40px -24px rgba(0,0,0,0.35)'
          }}
        >
          <p className="text-[13px] leading-snug flex-1" style={{ color: 'var(--text-2)' }}>
            Introdução do pipeline está <strong style={{ color: 'var(--text-1)' }}>oculta</strong>. À esquerda, escolha
            uma conversa ou use o modo Quadro.
          </p>
          <button
            type="button"
            onClick={() => setIntroHidden(false)}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: 'color-mix(in srgb, var(--brand-500) 16%, var(--surface-0))',
              color: 'var(--brand-600)',
              border: '1px solid color-mix(in srgb, var(--brand-500) 35%, transparent)'
            }}
          >
            <Eye className="w-4 h-4 shrink-0" aria-hidden />
            Mostrar introdução
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-stretch justify-center relative overflow-y-auto overflow-x-hidden px-4 sm:px-8 py-8 sm:py-10 min-h-0">
      {/* Fundo atmosférico */}
      <div
        className="pointer-events-none absolute inset-0 opacity-100"
        style={{
          background:
            'radial-gradient(ellipse 85% 55% at 15% 10%, color-mix(in srgb, var(--brand-500) 14%, transparent), transparent 52%), radial-gradient(ellipse 70% 50% at 90% 80%, color-mix(in srgb, #8b5cf6 10%, transparent), transparent 50%), var(--surface-0)'
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--brand-500)_35%,transparent)] to-transparent" aria-hidden />

      <div className="relative w-full max-w-[920px] mx-auto flex flex-col">
        <div className="flex justify-end w-full mb-2 sm:mb-3">
          <button
            type="button"
            onClick={() => setIntroHidden(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition-opacity hover:opacity-85"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--text-2)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 4px 16px -8px rgba(0,0,0,0.35)'
            }}
            title="Esconder painel de introdução (a preferência fica guardada neste navegador)"
            aria-label="Ocultar introdução do pipeline"
          >
            <EyeOff className="w-4 h-4 shrink-0" aria-hidden />
            Ocultar introdução
          </button>
        </div>
        {/* Hero + CTA visual */}
        <div className="mb-8 sm:mb-10 grid lg:grid-cols-[1fr_minmax(220px,280px)] gap-8 lg:gap-10 items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl shrink-0"
                style={{
                  background: 'linear-gradient(145deg, color-mix(in srgb, var(--brand-500) 22%, var(--surface-1)), var(--surface-1))',
                  border: '1px solid color-mix(in srgb, var(--brand-500) 40%, transparent)',
                  boxShadow: '0 20px 50px -24px color-mix(in srgb, var(--brand-500) 55%, transparent)'
                }}
              >
                <Workflow className="w-7 h-7" strokeWidth={1.65} style={{ color: 'var(--brand-500)' }} />
              </div>
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{
                  background: 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-1))',
                  color: 'var(--brand-600)',
                  border: '1px solid color-mix(in srgb, var(--brand-500) 28%, transparent)'
                }}
              >
                CRM ZapMass
              </span>
            </div>

            <h1 className="text-[clamp(1.35rem,3.5vw,1.85rem)] font-extrabold tracking-tight leading-tight mb-3" style={{ color: 'var(--text-1)' }}>
              Pipeline conversacional
            </h1>
            <p className="text-[14px] sm:text-[15px] leading-relaxed max-w-xl mb-4" style={{ color: 'var(--text-2)' }}>
              Centralize mensagens, notas internas e etapas de venda por contacto — num painel pensado para equipas que
              vivem no WhatsApp.
            </p>
            <div
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12px] max-w-xl"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-2)'
              }}
            >
              <ArrowRight className="w-4 h-4 shrink-0 text-amber-500" aria-hidden />
              <span>
                <strong style={{ color: 'var(--text-1)' }}>À esquerda</strong>, escolha uma conversa ou arraste cartões no
                modo <strong style={{ color: 'var(--text-1)' }}>Quadro</strong>.
              </span>
            </div>
          </div>

          {/* Cartão de resumo — “cockpit” */}
          <div
            className="rounded-2xl p-5 lg:p-6 relative overflow-hidden"
            style={{
              background:
                'linear-gradient(165deg, color-mix(in srgb, var(--surface-1) 94%, var(--surface-2)) 0%, var(--surface-1) 100%)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 24px 60px -28px rgba(0,0,0,0.35), inset 0 1px 0 color-mix(in srgb, #fff 5%, transparent)'
            }}
          >
            <span
              className="pointer-events-none absolute -right-8 -top-8 w-40 h-40 rounded-full opacity-50"
              style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-500) 25%, transparent), transparent 70%)' }}
              aria-hidden
            />
            <p className="text-[11px] font-bold uppercase tracking-wider mb-4 relative" style={{ color: 'var(--text-3)' }}>
              Resumo ao vivo
            </p>
            <div className="grid grid-cols-2 gap-3 relative">
              {kpiItems.map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl px-3.5 py-3 relative overflow-hidden"
                  style={{
                    background: `linear-gradient(155deg, var(--surface-0), var(--surface-0))`,
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-0 opacity-90"
                    style={{ background: s.wash }}
                    aria-hidden
                  />
                  <div className="relative z-[1]">
                    <div className="text-[22px] font-bold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                      {s.value.toLocaleString('pt-BR')}
                    </div>
                    <div className="text-[10px] font-semibold mt-2 uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      {s.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chips CRM quando há dados */}
        {crmCount > 0 && (
          <div className="mb-8 flex flex-wrap items-center gap-2">
            {crmStats.leads > 0 && (
              <span
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1"
                style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.leads} lead{crmStats.leads === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.clientes > 0 && (
              <span
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1"
                style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.clientes} cliente{crmStats.clientes === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.pendentes > 0 && (
              <span
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1"
                style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.pendentes} pendente{crmStats.pendentes === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.resolvidos > 0 && (
              <span
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1"
                style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.resolvidos} resolvido{crmStats.resolvidos === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.comReminder > 0 && (
              <span
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
                style={{
                  background: 'color-mix(in srgb, var(--brand-500) 10%, var(--surface-1))',
                  color: 'var(--text-2)',
                  border: '1px solid color-mix(in srgb, var(--brand-500) 32%, transparent)'
                }}
              >
                <Bell className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-500)' }} />
                {crmStats.comReminder} lembrete{crmStats.comReminder === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {/* Funcionalidades — grelha bento */}
        <div className="w-full">
          <p className="text-[12px] font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
            <span
              className="h-8 w-8 rounded-lg flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand-500) 18%, transparent), transparent)',
                border: '1px solid color-mix(in srgb, var(--brand-500) 25%, transparent)'
              }}
            >
              <Zap className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
            </span>
            O que consegue fazer aqui
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {features.map((f) => (
              <div
                key={f.label}
                className="flex items-start gap-3 rounded-xl px-3.5 py-3.5 transition-all duration-200 hover:brightness-[1.03]"
                style={{
                  background:
                    'linear-gradient(180deg, var(--surface-1) 0%, color-mix(in srgb, var(--surface-1) 96%, var(--surface-2)) 100%)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: '0 10px 28px -18px rgba(0,0,0,0.28), inset 0 1px 0 color-mix(in srgb, #fff 4%, transparent)'
                }}
              >
                <div
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-0))',
                    color: 'var(--brand-500)',
                    border: '1px solid color-mix(in srgb, var(--brand-500) 22%, transparent)'
                  }}
                >
                  {f.icon}
                </div>
                <div className="min-w-0 space-y-1 pt-0.5">
                  <p className="text-[12.5px] font-bold leading-tight truncate" style={{ color: 'var(--text-1)' }}>
                    {f.label}
                  </p>
                  <p className="text-[10.5px] leading-snug line-clamp-2" style={{ color: 'var(--text-3)' }}>
                    {f.hint}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p
          className="mt-10 max-w-2xl text-[11px] leading-relaxed border-t pt-6"
          style={{ color: 'var(--text-3)', borderColor: 'var(--border-subtle)' }}
        >
          Metadados de CRM ficam neste navegador. Para envio WhatsApp continuam aplicáveis as políticas da Meta e do seu
          plano ZapMass.
        </p>
      </div>
    </div>
  );
};
