import React from 'react';
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
  ShieldCheck
} from 'lucide-react';

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
 * Empty state do painel de chat — mostra o que o "CRM conversacional" faz
 * quando nenhuma conversa esta selecionada.
 */
export const ChatEmptyShowcase: React.FC<Props> = ({
  totalConversations,
  totalUnread,
  totalChannels,
  crmStats
}) => {
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

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden px-5 py-10">
      {/* Fundo discreto */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -20%, color-mix(in srgb, var(--brand-500) 22%, transparent), transparent)'
        }}
        aria-hidden
      />

      <div className="relative w-full max-w-[440px] text-center flex flex-col items-center">
        {/* Hero */}
        <div className="mb-6 flex flex-col items-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              background: 'color-mix(in srgb, var(--brand-500) 14%, var(--surface-1))',
              border: '1px solid color-mix(in srgb, var(--brand-500) 35%, transparent)',
              boxShadow: '0 12px 40px -16px color-mix(in srgb, var(--brand-500) 45%, transparent)'
            }}
          >
            <Workflow className="w-8 h-8" strokeWidth={1.75} style={{ color: 'var(--brand-500)' }} />
          </div>
          <span
            className="mb-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            CRM ZapMass
          </span>

          <h1 className="text-[22px] font-bold tracking-tight leading-snug mb-2" style={{ color: 'var(--text-1)' }}>
            Pipeline conversacional
          </h1>
          <p className="text-[13px] leading-relaxed max-w-sm mx-auto" style={{ color: 'var(--text-2)' }}>
            Centralize mensagens, notas e etapas de venda por contato — em um só lugar.
          </p>
          <p className="mt-2 text-[12px] leading-snug max-w-sm" style={{ color: 'var(--text-3)' }}>
            À esquerda, escolha uma conversa para abrir a conversa completa.
          </p>
        </div>

        {/* KPIs — mesmo tom, menos “arco-íris” */}
        <div
          className="mb-8 w-full grid grid-cols-4 gap-px overflow-hidden rounded-xl"
          style={{ background: 'var(--border-subtle)' }}
        >
          {[
            { label: 'Conversas', value: totalConversations },
            { label: 'Não lidas', value: totalUnread },
            { label: 'Canais', value: totalChannels },
            { label: 'No CRM', value: crmCount }
          ].map((s) => (
            <div key={s.label} className="px-3 py-3" style={{ background: 'var(--surface-1)' }}>
              <div
                className="text-xl font-semibold tabular-nums leading-none"
                style={{ color: 'var(--text-1)' }}
              >
                {s.value.toLocaleString('pt-BR')}
              </div>
              <div className="text-[10px] font-medium mt-2 uppercase tracking-wider leading-tight" style={{ color: 'var(--text-3)' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Funil de status CRM */}
        {crmCount > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-center gap-1.5">
            {crmStats.leads > 0 && (
              <span
                className="text-[11px] font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.leads} lead{crmStats.leads === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.clientes > 0 && (
              <span
                className="text-[11px] font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.clientes} cliente{crmStats.clientes === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.pendentes > 0 && (
              <span
                className="text-[11px] font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.pendentes} pendente{crmStats.pendentes === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.resolvidos > 0 && (
              <span
                className="text-[11px] font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
              >
                {crmStats.resolvidos} resolvido{crmStats.resolvidos === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.comReminder > 0 && (
              <span
                className="text-[11px] font-medium px-2.5 py-1 rounded-md inline-flex items-center gap-1"
                style={{
                  background: 'color-mix(in srgb, var(--brand-500) 8%, var(--surface-2))',
                  color: 'var(--text-2)',
                  border: '1px solid color-mix(in srgb, var(--brand-500) 35%, transparent)'
                }}
              >
                <Bell className="w-3 h-3 shrink-0" style={{ color: 'var(--brand-500)' }} />
                {crmStats.comReminder} lembrete{crmStats.comReminder === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {/* Recursos — grelha alinhada, ícone único */}
        <div className="w-full text-left">
          <p className="text-[11px] font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <Zap className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-500)' }} />
            Funcionalidades
          </p>
          <div className="grid grid-cols-2 gap-2">
            {features.map((f) => (
              <div
                key={f.label}
                className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{
                    background: 'color-mix(in srgb, var(--brand-500) 10%, transparent)',
                    color: 'var(--brand-500)'
                  }}
                >
                  {f.icon}
                </div>
                <div className="min-w-0 space-y-0.5 pt-0.5">
                  <p className="text-[12px] font-semibold leading-tight truncate" style={{ color: 'var(--text-1)' }}>
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

        <p className="mt-6 max-w-sm text-[11px] leading-relaxed mx-auto border-t pt-5" style={{ color: 'var(--text-3)', borderColor: 'var(--border-subtle)' }}>
          Metadados de CRM ficam neste navegador. Para envio WhatsApp continuam aplicáveis as políticas da Meta e do seu plano ZapMass.
        </p>
      </div>
    </div>
  );
};
