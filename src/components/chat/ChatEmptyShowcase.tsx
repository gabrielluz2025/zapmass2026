import React, { useCallback, useState } from 'react';
import {
  MessageCircle,
  StickyNote,
  Tag,
  Bell,
  LayoutGrid,
  Image as ImageIcon,
  Pin,
  Search,
  ShieldCheck,
  EyeOff,
  Eye,
  CheckCheck,
  Check,
  Smile,
  Paperclip,
  Mic,
  Phone,
  Video,
  MoreVertical,
  ArrowRight,
  Zap,
  Users,
  TrendingUp,
  Star,
  Hash
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

const mockMessages = [
  { from: 'them', text: 'Olá! Vi o produto no Instagram 😊', time: '09:41', status: null },
  { from: 'me', text: 'Olá! Que bom! Como posso te ajudar?', time: '09:42', status: 'read' },
  { from: 'them', text: 'Qual o preço e prazo de entrega?', time: '09:43', status: null },
  { from: 'me', text: 'Entrego em 3 dias úteis! 🚀 Te mando o catálogo agora.', time: '09:44', status: 'delivered' }
];

function WaPreview() {
  return (
    <div
      className="rounded-2xl overflow-hidden select-none shrink-0 w-full max-w-[280px]"
      style={{
        background: 'var(--wa-bg)',
        border: '1px solid var(--wa-divider)',
        boxShadow: '0 32px 64px -24px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)'
      }}
      aria-hidden
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-3 py-2.5"
        style={{ background: 'var(--wa-header)' }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-[13px] font-bold"
          style={{ background: 'linear-gradient(135deg, #00a884, #008069)' }}
        >
          MJ
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--wa-text)' }}>
            Maria João
          </p>
          <p className="text-[10px]" style={{ color: 'var(--wa-green)' }}>
            online
          </p>
        </div>
        <div className="flex items-center gap-3" style={{ color: 'var(--wa-icon)' }}>
          <Video className="w-4 h-4" />
          <Phone className="w-4 h-4" />
          <MoreVertical className="w-4 h-4" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-1.5 px-3 py-3" style={{ background: 'var(--wa-bg)' }}>
        {mockMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className="rounded-lg px-3 py-1.5 max-w-[85%] relative"
              style={{
                background: msg.from === 'me' ? 'var(--wa-bubble-out)' : 'var(--wa-bubble-in)',
                boxShadow: 'var(--wa-shadow-sm)',
                borderRadius: msg.from === 'me' ? '8px 0 8px 8px' : '0 8px 8px 8px'
              }}
            >
              <p className="text-[11px] leading-snug" style={{ color: 'var(--wa-text)' }}>
                {msg.text}
              </p>
              <div className={`flex items-center gap-1 mt-0.5 ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                <span className="text-[9px]" style={{ color: 'var(--wa-text-3)' }}>
                  {msg.time}
                </span>
                {msg.status === 'read' && <CheckCheck className="w-3 h-3" style={{ color: 'var(--wa-tick-blue)' }} />}
                {msg.status === 'delivered' && <CheckCheck className="w-3 h-3" style={{ color: 'var(--wa-text-3)' }} />}
                {msg.status === 'sent' && <Check className="w-3 h-3" style={{ color: 'var(--wa-text-3)' }} />}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        <div className="flex justify-start">
          <div
            className="rounded-lg px-3 py-2 flex items-center gap-1"
            style={{
              background: 'var(--wa-bubble-in)',
              boxShadow: 'var(--wa-shadow-sm)',
              borderRadius: '0 8px 8px 8px'
            }}
          >
            {[0, 1, 2].map((dot) => (
              <div
                key={dot}
                className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{
                  background: 'var(--wa-text-3)',
                  animationDelay: `${dot * 0.18}s`,
                  animationDuration: '1.1s'
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: 'var(--wa-header)' }}
      >
        <div
          className="flex-1 flex items-center gap-2 rounded-full px-3 py-1.5"
          style={{ background: 'var(--wa-panel)', border: '1px solid var(--wa-divider)' }}
        >
          <Smile className="w-4 h-4 shrink-0" style={{ color: 'var(--wa-icon)' }} />
          <span className="text-[11px] flex-1" style={{ color: 'var(--wa-text-3)' }}>
            Mensagem
          </span>
          <Paperclip className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--wa-icon)' }} />
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--wa-green)' }}
        >
          <Mic className="w-4 h-4 text-white" />
        </div>
      </div>
    </div>
  );
}

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
    { icon: <StickyNote className="w-[18px] h-[18px]" />, label: 'Anotações', hint: 'Histórico privado por cliente', color: '#F59E0B', bg: 'rgba(245,158,11,0.13)' },
    { icon: <Tag className="w-[18px] h-[18px]" />, label: 'Tags', hint: 'VIP, lead, urgente e mais', color: '#8B5CF6', bg: 'rgba(139,92,246,0.13)' },
    { icon: <Bell className="w-[18px] h-[18px]" />, label: 'Lembretes', hint: 'Follow-up automatizado', color: '#EF4444', bg: 'rgba(239,68,68,0.13)' },
    { icon: <LayoutGrid className="w-[18px] h-[18px]" />, label: 'Kanban', hint: 'Arraste entre etapas', color: '#3B82F6', bg: 'rgba(59,130,246,0.13)' },
    { icon: <ImageIcon className="w-[18px] h-[18px]" />, label: 'Galeria', hint: 'Imagens, docs e áudios', color: '#10B981', bg: 'rgba(16,185,129,0.13)' },
    { icon: <Pin className="w-[18px] h-[18px]" />, label: 'Fixar', hint: 'Prioridade na lista', color: '#F97316', bg: 'rgba(249,115,22,0.13)' },
    { icon: <Search className="w-[18px] h-[18px]" />, label: 'Busca', hint: 'Texto por conversa', color: '#06B6D4', bg: 'rgba(6,182,212,0.13)' },
    { icon: <ShieldCheck className="w-[18px] h-[18px]" />, label: 'Auditoria', hint: 'Limpar conversas inválidas', color: '#6366F1', bg: 'rgba(99,102,241,0.13)' }
  ];

  const crmCount =
    crmStats.pinned + crmStats.leads + crmStats.clientes + crmStats.pendentes + crmStats.resolvidos;

  const kpiItems = [
    { icon: <MessageCircle className="w-5 h-5" />, label: 'Conversas', value: totalConversations, color: '#00a884', bg: 'rgba(0,168,132,0.12)' },
    { icon: <Hash className="w-5 h-5" />, label: 'Não lidas', value: totalUnread, color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' },
    { icon: <Users className="w-5 h-5" />, label: 'Canais', value: totalChannels, color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
    { icon: <Star className="w-5 h-5" />, label: 'No CRM', value: crmCount, color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' }
  ];

  const crmStatusChips = [
    { label: 'Leads', value: crmStats.leads, color: '#3B82F6', bg: 'rgba(59,130,246,0.13)' },
    { label: 'Clientes', value: crmStats.clientes, color: '#10B981', bg: 'rgba(16,185,129,0.13)' },
    { label: 'Pendentes', value: crmStats.pendentes, color: '#F59E0B', bg: 'rgba(245,158,11,0.13)' },
    { label: 'Resolvidos', value: crmStats.resolvidos, color: '#6B7280', bg: 'rgba(107,114,128,0.13)' }
  ].filter((c) => c.value > 0);

  if (introHidden) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center min-h-0 px-4 py-8"
        style={{ background: 'var(--wa-bg)' }}
      >
        <div
          className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 rounded-2xl px-5 py-4 max-w-lg w-full"
          style={{
            background: 'var(--wa-panel)',
            border: '1px solid var(--wa-divider)',
            boxShadow: 'var(--wa-shadow-md)'
          }}
        >
          <div className="flex items-center gap-3 flex-1">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'rgba(0,168,132,0.15)' }}
            >
              <MessageCircle className="w-5 h-5" style={{ color: 'var(--wa-green)' }} />
            </div>
            <p className="text-[13px] leading-snug" style={{ color: 'var(--wa-text-2)' }}>
              Selecione uma conversa à esquerda ou use o modo{' '}
              <strong style={{ color: 'var(--wa-text)' }}>Quadro</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIntroHidden(false)}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-semibold transition-all hover:brightness-110"
            style={{
              background: 'rgba(0,168,132,0.14)',
              color: 'var(--wa-green)',
              border: '1px solid rgba(0,168,132,0.28)'
            }}
          >
            <Eye className="w-4 h-4 shrink-0" aria-hidden />
            Ver painel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col items-stretch relative overflow-y-auto overflow-x-hidden min-h-0"
      style={{ background: 'var(--wa-bg)' }}
    >
      {/* Faixas decorativas superiores */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] z-10" style={{ background: 'linear-gradient(90deg, var(--wa-green), var(--wa-green-strong), var(--wa-green))' }} aria-hidden />

      <div className="relative w-full max-w-[960px] mx-auto px-5 sm:px-8 py-8 flex flex-col gap-8">

        {/* Botão ocultar */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setIntroHidden(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.5px] font-semibold transition-all hover:brightness-110"
            style={{
              background: 'var(--wa-panel)',
              color: 'var(--wa-text-3)',
              border: '1px solid var(--wa-divider)',
              boxShadow: 'var(--wa-shadow-sm)'
            }}
            aria-label="Ocultar painel de boas-vindas"
          >
            <EyeOff className="w-3.5 h-3.5 shrink-0" aria-hidden />
            Ocultar
          </button>
        </div>

        {/* ── HERO ── */}
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 lg:gap-12 items-center">
          <div>
            {/* Badge */}
            <div className="flex items-center gap-2.5 mb-5">
              <div
                className="flex items-center justify-center w-12 h-12 rounded-2xl shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #00a884, #008069)',
                  boxShadow: '0 12px 32px -8px rgba(0,168,132,0.55)'
                }}
              >
                <MessageCircle className="w-6 h-6 text-white" strokeWidth={2} />
              </div>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                style={{
                  background: 'rgba(0,168,132,0.14)',
                  color: 'var(--wa-green)',
                  border: '1px solid rgba(0,168,132,0.30)'
                }}
              >
                <Zap className="w-3 h-3" />
                ZapMass CRM
              </span>
            </div>

            <h1
              className="text-[clamp(1.5rem,4vw,2.1rem)] font-black tracking-tight leading-tight mb-3"
              style={{ color: 'var(--wa-text)' }}
            >
              Bate-papo{' '}
              <span style={{ color: 'var(--wa-green)' }}>inteligente</span>
            </h1>
            <p
              className="text-[14px] sm:text-[15px] leading-relaxed max-w-lg mb-6"
              style={{ color: 'var(--wa-text-2)' }}
            >
              Gerencie todas as conversas WhatsApp em um só lugar. Com CRM embutido, tags, lembretes e
              Kanban — a ferramenta que a sua equipa precisa.
            </p>

            {/* CTA hint */}
            <div
              className="inline-flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[13px]"
              style={{
                background: 'var(--wa-panel)',
                border: '1px solid var(--wa-divider)',
                color: 'var(--wa-text-2)',
                boxShadow: 'var(--wa-shadow-sm)'
              }}
            >
              <ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'var(--wa-green)' }} />
              <span>
                <strong style={{ color: 'var(--wa-text)' }}>Escolha uma conversa</strong> à esquerda ou
                use o modo <strong style={{ color: 'var(--wa-text)' }}>Quadro</strong> para arrastar
                cartões.
              </span>
            </div>
          </div>

          {/* Preview WhatsApp */}
          <WaPreview />
        </div>

        {/* ── KPI CARDS ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {kpiItems.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl px-4 py-4 flex items-center gap-3 relative overflow-hidden transition-transform duration-200 hover:-translate-y-0.5"
              style={{
                background: 'var(--wa-panel)',
                border: '1px solid var(--wa-divider)',
                boxShadow: 'var(--wa-shadow-sm)'
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-100"
                style={{ background: `radial-gradient(circle at 85% 15%, ${item.bg}, transparent 65%)` }}
                aria-hidden
              />
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 relative z-[1]"
                style={{ background: item.bg }}
              >
                <span style={{ color: item.color }}>{item.icon}</span>
              </div>
              <div className="relative z-[1]">
                <div
                  className="text-[22px] font-black leading-none tabular-nums"
                  style={{ color: 'var(--wa-text)' }}
                >
                  {item.value.toLocaleString('pt-BR')}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider mt-1" style={{ color: item.color }}>
                  {item.label}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── CRM STATUS CHIPS ── */}
        {crmStatusChips.length > 0 && (
          <div
            className="rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3"
            style={{
              background: 'var(--wa-panel)',
              border: '1px solid var(--wa-divider)',
              boxShadow: 'var(--wa-shadow-sm)'
            }}
          >
            <div className="flex items-center gap-2 mr-2">
              <TrendingUp className="w-4 h-4" style={{ color: 'var(--wa-green)' }} />
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--wa-text-2)' }}>
                CRM
              </span>
            </div>
            {crmStatusChips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
                style={{ background: chip.bg, color: chip.color, border: `1px solid ${chip.bg}` }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: chip.color }}
                />
                {chip.value} {chip.label}
              </span>
            ))}
            {crmStats.comReminder > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
                style={{
                  background: 'rgba(0,168,132,0.13)',
                  color: 'var(--wa-green)',
                  border: '1px solid rgba(0,168,132,0.25)'
                }}
              >
                <Bell className="w-3 h-3 shrink-0" />
                {crmStats.comReminder} lembrete{crmStats.comReminder === 1 ? '' : 's'}
              </span>
            )}
            {crmStats.pinned > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
                style={{
                  background: 'rgba(249,115,22,0.13)',
                  color: '#F97316',
                  border: '1px solid rgba(249,115,22,0.25)'
                }}
              >
                <Pin className="w-3 h-3 shrink-0" />
                {crmStats.pinned} fixado{crmStats.pinned === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {/* ── FEATURES GRID ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(0,168,132,0.15)', border: '1px solid rgba(0,168,132,0.28)' }}
            >
              <Zap className="w-3.5 h-3.5" style={{ color: 'var(--wa-green)' }} />
            </div>
            <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--wa-text-2)' }}>
              Recursos disponíveis
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {features.map((f) => (
              <div
                key={f.label}
                className="group flex flex-col gap-3 rounded-2xl p-4 cursor-default transition-all duration-200 hover:-translate-y-0.5 hover:brightness-105"
                style={{
                  background: 'var(--wa-panel)',
                  border: '1px solid var(--wa-divider)',
                  boxShadow: 'var(--wa-shadow-sm)'
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: f.bg }}
                >
                  <span style={{ color: f.color }}>{f.icon}</span>
                </div>
                <div>
                  <p className="text-[12.5px] font-bold leading-tight" style={{ color: 'var(--wa-text)' }}>
                    {f.label}
                  </p>
                  <p className="text-[11px] leading-snug mt-1" style={{ color: 'var(--wa-text-3)' }}>
                    {f.hint}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── FOOTER ── */}
        <p
          className="text-[11px] leading-relaxed border-t pt-5 pb-2"
          style={{ color: 'var(--wa-text-3)', borderColor: 'var(--wa-divider)' }}
        >
          Metadados de CRM ficam neste navegador. Para envio WhatsApp continuam aplicáveis as políticas da Meta e do seu
          plano ZapMass.
        </p>
      </div>
    </div>
  );
};
