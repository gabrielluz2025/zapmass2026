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
    { icon: <StickyNote className="w-4 h-4" />, label: 'Anotações privadas', hint: 'Histórico por cliente', color: '#10b981' },
    { icon: <Tag className="w-4 h-4" />, label: 'Tags coloridas', hint: 'VIP, lead, quente, etc', color: '#8b5cf6' },
    { icon: <Bell className="w-4 h-4" />, label: 'Lembretes', hint: '1h, 1 dia ou 1 semana', color: '#f59e0b' },
    { icon: <LayoutGrid className="w-4 h-4" />, label: 'Quadro Kanban', hint: 'Arraste cards no pipeline', color: '#3b82f6' },
    { icon: <ImageIcon className="w-4 h-4" />, label: 'Galeria de mídias', hint: 'Fotos, vídeos e docs', color: '#06b6d4' },
    { icon: <Pin className="w-4 h-4" />, label: 'Fixar contato', hint: 'Favoritos no topo', color: '#ec4899' },
    { icon: <Search className="w-4 h-4" />, label: 'Busca no chat', hint: 'Encontre qualquer palavra', color: '#6366f1' },
    { icon: <ShieldCheck className="w-4 h-4" />, label: 'Auditoria', hint: 'Remover conversas fantasmas', color: '#84cc16' }
  ];

  const crmCount =
    crmStats.pinned +
    crmStats.leads +
    crmStats.clientes +
    crmStats.pendentes +
    crmStats.resolvidos;

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center relative overflow-hidden px-6 py-8">
      {/* Orbs animados */}
      <div
        className="absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl opacity-40 animate-pulse"
        style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.45), transparent 70%)' }}
        aria-hidden
      />
      <div
        className="absolute -bottom-32 -right-24 w-80 h-80 rounded-full blur-3xl opacity-30 animate-pulse"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.4), transparent 70%)',
          animationDelay: '1s'
        }}
        aria-hidden
      />

      <div className="relative max-w-lg w-full">
        {/* Icone hero */}
        <div className="relative inline-block mb-5">
          <div
            className="absolute inset-0 rounded-3xl blur-xl opacity-60"
            style={{ background: 'linear-gradient(135deg, #10b981, #3b82f6)' }}
            aria-hidden
          />
          <div
            className="relative w-24 h-24 rounded-3xl flex items-center justify-center mx-auto"
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)',
              boxShadow: '0 20px 60px -20px rgba(16,185,129,0.5)'
            }}
          >
            <Workflow className="w-11 h-11 text-white" />
          </div>
          <span
            className="absolute -top-1 -right-1 px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest uppercase"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(239,68,68,0.4)'
            }}
          >
            CRM
          </span>
        </div>

        <h1
          className="text-[26px] font-black mb-2 tracking-tight"
          style={{
            background: 'linear-gradient(135deg, var(--text-1), var(--brand-600))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}
        >
          Pipeline conversacional
        </h1>
        <p className="text-[13.5px] leading-relaxed mb-5 max-w-md mx-auto" style={{ color: 'var(--text-2)' }}>
          Converse, anote, classifique e acompanhe cada cliente como um gerente de vendas.
          <span className="block mt-1" style={{ color: 'var(--text-3)' }}>
            Selecione uma conversa à esquerda para abrir a ficha completa.
          </span>
        </p>

        {/* KPIs ao vivo */}
        <div
          className="grid grid-cols-4 gap-2 mb-5 p-3 rounded-2xl"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          {[
            { label: 'Conversas', value: totalConversations, color: 'var(--brand-600)' },
            { label: 'Não lidas', value: totalUnread, color: '#f59e0b' },
            { label: 'Canais', value: totalChannels, color: '#3b82f6' },
            { label: 'No CRM', value: crmCount, color: '#8b5cf6' }
          ].map((s) => (
            <div key={s.label}>
              <div className="text-[22px] font-black tabular-nums" style={{ color: s.color }}>
                {s.value.toLocaleString('pt-BR')}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-3)' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Funil de status CRM */}
        {crmCount > 0 && (
          <div className="mb-5 flex items-center gap-1.5 flex-wrap justify-center">
            {crmStats.leads > 0 && (
              <span
                className="text-[11px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}
              >
                ✨ {crmStats.leads} lead{crmStats.leads === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.clientes > 0 && (
              <span
                className="text-[11px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
              >
                💚 {crmStats.clientes} cliente{crmStats.clientes === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.pendentes > 0 && (
              <span
                className="text-[11px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
              >
                ⏳ {crmStats.pendentes} pendente{crmStats.pendentes === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.resolvidos > 0 && (
              <span
                className="text-[11px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}
              >
                ✅ {crmStats.resolvidos}
              </span>
            )}
            {crmStats.comReminder > 0 && (
              <span
                className="text-[11px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <Bell className="w-3 h-3" />
                {crmStats.comReminder} lembrete{crmStats.comReminder === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {/* Features */}
        <p className="text-[10.5px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          <Zap className="w-3 h-3 inline -mt-0.5 mr-1" />
          Tudo isso aqui dentro
        </p>
        <div className="grid grid-cols-2 gap-2">
          {features.map((f) => (
            <div
              key={f.label}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all hover:-translate-y-0.5"
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${f.color}1f`, color: f.color }}
              >
                {f.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                  {f.label}
                </p>
                <p className="text-[10.5px] truncate" style={{ color: 'var(--text-3)' }}>
                  {f.hint}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-2 mt-5">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--brand-500)' }} />
          <p className="text-[10.5px] font-medium" style={{ color: 'var(--text-3)' }}>
            Criptografia fim-a-fim • dados CRM salvos localmente no seu navegador
          </p>
        </div>
      </div>
    </div>
  );
};
