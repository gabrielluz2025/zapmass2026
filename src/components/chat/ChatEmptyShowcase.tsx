import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
  MessageCircle,
  Zap,
  TrendingUp,
  Star,
  Users,
  ArrowLeft
} from 'lucide-react';

const INTRO_HIDDEN_KEY = 'zapmass-chat-pipeline-intro-hidden';

function readIntroHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(INTRO_HIDDEN_KEY) === '1'; } catch { return false; }
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

interface BotMessage {
  id: string;
  type: 'text' | 'feature-row' | 'stats' | 'cta';
  text?: string;
  delay: number;
}

const botMessages: BotMessage[] = [
  { id: 'm0', type: 'text', text: 'Olá! Bem-vindo ao Bate-papo ZapMass 👋', delay: 0 },
  { id: 'm1', type: 'text', text: 'Sou o seu hub de conversas WhatsApp com CRM embutido. Veja o que consigo fazer por você:', delay: 600 },
  { id: 'm2', type: 'feature-row', delay: 1300 },
  { id: 'm3', type: 'stats', delay: 2000 },
  { id: 'm4', type: 'cta', text: '← Selecione uma conversa ao lado para começar', delay: 2700 }
];

const features = [
  { icon: <StickyNote className="w-4 h-4" />, label: 'Anotações', color: '#F59E0B', bg: 'rgba(245,158,11,0.14)' },
  { icon: <Tag className="w-4 h-4" />, label: 'Tags', color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)' },
  { icon: <Bell className="w-4 h-4" />, label: 'Lembretes', color: '#EF4444', bg: 'rgba(239,68,68,0.14)' },
  { icon: <LayoutGrid className="w-4 h-4" />, label: 'Kanban', color: '#3B82F6', bg: 'rgba(59,130,246,0.14)' },
  { icon: <ImageIcon className="w-4 h-4" />, label: 'Galeria', color: '#10B981', bg: 'rgba(16,185,129,0.14)' },
  { icon: <Pin className="w-4 h-4" />, label: 'Fixar', color: '#F97316', bg: 'rgba(249,115,22,0.14)' },
  { icon: <Search className="w-4 h-4" />, label: 'Busca', color: '#06B6D4', bg: 'rgba(6,182,212,0.14)' },
  { icon: <ShieldCheck className="w-4 h-4" />, label: 'Auditoria', color: '#6366F1', bg: 'rgba(99,102,241,0.14)' }
];

function BotAvatar() {
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
      style={{ background: 'linear-gradient(135deg, var(--wa-green), var(--wa-green-strong))' }}
    >
      <Zap className="w-4 h-4 text-white" />
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-end gap-2">
      <BotAvatar />
      <div
        className="flex items-center gap-1 px-4 py-3 rounded-2xl rounded-bl-sm"
        style={{ background: 'var(--wa-bubble-in)', boxShadow: 'var(--wa-shadow-sm)' }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full animate-bounce"
            style={{
              background: 'var(--wa-text-3)',
              animationDelay: `${i * 0.18}s`,
              animationDuration: '1.1s'
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FeatureRow() {
  return (
    <div className="flex items-end gap-2">
      <BotAvatar />
      <div
        className="rounded-2xl rounded-bl-sm p-3"
        style={{ background: 'var(--wa-bubble-in)', boxShadow: 'var(--wa-shadow-sm)', maxWidth: '320px' }}
      >
        <p className="text-[11px] font-semibold mb-2.5" style={{ color: 'var(--wa-text-2)' }}>
          Recursos disponíveis:
        </p>
        <div className="grid grid-cols-4 gap-2">
          {features.map((f) => (
            <div key={f.label} className="flex flex-col items-center gap-1.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: f.bg }}
              >
                <span style={{ color: f.color }}>{f.icon}</span>
              </div>
              <span className="text-[9.5px] font-semibold text-center leading-tight" style={{ color: 'var(--wa-text-2)' }}>
                {f.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatsRow({ totalConversations, totalUnread, totalChannels, crmStats }: Props) {
  const crmCount = crmStats.leads + crmStats.clientes + crmStats.pendentes + crmStats.resolvidos;
  const items = [
    { icon: <MessageCircle className="w-4 h-4" />, value: totalConversations, label: 'Conversas', color: 'var(--wa-green)' },
    { icon: <Bell className="w-4 h-4" />, value: totalUnread, label: 'Não lidas', color: '#8B5CF6' },
    { icon: <Users className="w-4 h-4" />, value: totalChannels, label: 'Canais', color: '#3B82F6' },
    { icon: <Star className="w-4 h-4" />, value: crmCount, label: 'No CRM', color: '#F59E0B' }
  ];
  return (
    <div className="flex items-end gap-2">
      <BotAvatar />
      <div
        className="rounded-2xl rounded-bl-sm p-3"
        style={{ background: 'var(--wa-bubble-in)', boxShadow: 'var(--wa-shadow-sm)', maxWidth: '320px', width: '100%' }}
      >
        <p className="text-[11px] font-semibold mb-2.5" style={{ color: 'var(--wa-text-2)' }}>
          Resumo da sua conta:
        </p>
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: 'var(--wa-panel-2)', border: '1px solid var(--wa-divider)' }}
            >
              <span style={{ color: item.color }}>{item.icon}</span>
              <div>
                <p className="text-[15px] font-black leading-none tabular-nums" style={{ color: 'var(--wa-text)' }}>
                  {item.value}
                </p>
                <p className="text-[9.5px] font-medium mt-0.5" style={{ color: 'var(--wa-text-3)' }}>
                  {item.label}
                </p>
              </div>
            </div>
          ))}
        </div>
        {crmStats.comReminder > 0 && (
          <div
            className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: 'rgba(0,168,132,0.12)', border: '1px solid rgba(0,168,132,0.22)' }}
          >
            <Bell className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--wa-green)' }} />
            <p className="text-[11px] font-semibold" style={{ color: 'var(--wa-text-2)' }}>
              <strong style={{ color: 'var(--wa-green)' }}>{crmStats.comReminder}</strong>{' '}
              lembrete{crmStats.comReminder === 1 ? '' : 's'} pendente{crmStats.comReminder === 1 ? '' : 's'}
            </p>
          </div>
        )}
        {(crmStats.leads > 0 || crmStats.clientes > 0 || crmStats.pendentes > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {crmStats.leads > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(59,130,246,0.13)', color: '#3B82F6' }}>
                {crmStats.leads} leads
              </span>
            )}
            {crmStats.clientes > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(16,185,129,0.13)', color: '#10B981' }}>
                {crmStats.clientes} clientes
              </span>
            )}
            {crmStats.pendentes > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(245,158,11,0.13)', color: '#F59E0B' }}>
                {crmStats.pendentes} pendentes
              </span>
            )}
            {crmStats.resolvidos > 0 && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(107,114,128,0.13)', color: '#6B7280' }}>
                {crmStats.resolvidos} resolvidos
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CtaBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2">
      <BotAvatar />
      <div
        className="flex items-center gap-2.5 rounded-2xl rounded-bl-sm px-4 py-3"
        style={{
          background: 'linear-gradient(135deg, var(--wa-green), var(--wa-green-strong))',
          boxShadow: '0 8px 24px -8px rgba(0,168,132,0.55)'
        }}
      >
        <ArrowLeft className="w-4 h-4 text-white shrink-0 animate-bounce" style={{ animationDuration: '1.5s' }} />
        <p className="text-[13px] font-bold text-white">
          {text}
        </p>
      </div>
    </div>
  );
}

function PinnedStats({ totalConversations, totalUnread, totalChannels }: { totalConversations: number; totalUnread: number; totalChannels: number }) {
  return (
    <div
      className="flex items-center gap-1 px-3 py-2 border-b"
      style={{ background: 'var(--wa-header)', borderColor: 'var(--wa-divider)' }}
    >
      <div
        className="w-1 h-8 rounded-full mr-1 shrink-0"
        style={{ background: 'var(--wa-green)' }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--wa-green)' }}>
          ZapMass · Resumo fixado
        </p>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--wa-text-2)' }}>
            <strong style={{ color: 'var(--wa-text)' }}>{totalConversations}</strong> conversas
          </span>
          {totalUnread > 0 && (
            <span className="text-[11px] font-semibold" style={{ color: '#8B5CF6' }}>
              {totalUnread} não lidas
            </span>
          )}
          <span className="text-[11px] font-semibold" style={{ color: 'var(--wa-text-2)' }}>
            <strong style={{ color: 'var(--wa-text)' }}>{totalChannels}</strong> canal{totalChannels !== 1 ? 'is' : ''}
          </span>
        </div>
      </div>
      <TrendingUp className="w-4 h-4 shrink-0" style={{ color: 'var(--wa-green)' }} />
    </div>
  );
}

export const ChatEmptyShowcase: React.FC<Props> = (props) => {
  const { totalConversations, totalUnread, totalChannels } = props;
  const [introHidden, setIntroHiddenState] = useState(readIntroHidden);
  const [visibleMessages, setVisibleMessages] = useState<string[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number[]>([]);

  const setIntroHidden = useCallback((hidden: boolean) => {
    setIntroHiddenState(hidden);
    try {
      if (hidden) window.localStorage.setItem(INTRO_HIDDEN_KEY, '1');
      else window.localStorage.removeItem(INTRO_HIDDEN_KEY);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (introHidden) return;
    // Limpa timers anteriores
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];
    setVisibleMessages([]);
    setShowTyping(false);

    botMessages.forEach((msg, idx) => {
      // Mostra indicador de digitação antes de cada mensagem (exceto a primeira)
      if (idx > 0) {
        const t1 = window.setTimeout(() => {
          setShowTyping(true);
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, msg.delay - 350);
        timerRef.current.push(t1);
      }
      const t2 = window.setTimeout(() => {
        setShowTyping(false);
        setVisibleMessages((prev) => [...prev, msg.id]);
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, msg.delay);
      timerRef.current.push(t2);
    });

    return () => { timerRef.current.forEach(clearTimeout); };
  }, [introHidden]);

  if (introHidden) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center min-h-0 px-4 py-8"
        style={{ background: 'var(--wa-bg)' }}
      >
        <div
          className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl px-5 py-4 max-w-sm w-full"
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
            <p className="text-[13px]" style={{ color: 'var(--wa-text-2)' }}>
              Selecione uma conversa ao lado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIntroHidden(false)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition-all hover:brightness-110"
            style={{ background: 'rgba(0,168,132,0.14)', color: 'var(--wa-green)', border: '1px solid rgba(0,168,132,0.28)' }}
          >
            <Eye className="w-3.5 h-3.5" aria-hidden />
            Ver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
      style={{ background: 'var(--wa-bg)' }}
    >
      {/* Header fixo do "chat" */}
      <div
        className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ background: 'var(--wa-header)', borderBottom: '1px solid var(--wa-divider)' }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--wa-green), var(--wa-green-strong))' }}
        >
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold" style={{ color: 'var(--wa-text)' }}>
            ZapMass
          </p>
          <p className="text-[11px]" style={{ color: 'var(--wa-green)' }}>
            online
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIntroHidden(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-all hover:brightness-110"
          style={{ background: 'rgba(0,168,132,0.12)', color: 'var(--wa-green)', border: '1px solid rgba(0,168,132,0.25)' }}
          aria-label="Ocultar painel"
        >
          <EyeOff className="w-3.5 h-3.5" aria-hidden />
          Ocultar
        </button>
      </div>

      {/* Stats fixados (como mensagem pinada do WA) */}
      <PinnedStats
        totalConversations={totalConversations}
        totalUnread={totalUnread}
        totalChannels={totalChannels}
      />

      {/* Área de mensagens — rola */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4 min-h-0">
        {botMessages.map((msg) => {
          if (!visibleMessages.includes(msg.id)) return null;
          return (
            <div
              key={msg.id}
              className="animate-fade-in-up"
              style={{ animationDuration: '0.3s' }}
            >
              {msg.type === 'text' && (
                <div className="flex items-end gap-2">
                  <BotAvatar />
                  <div
                    className="rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[300px]"
                    style={{ background: 'var(--wa-bubble-in)', boxShadow: 'var(--wa-shadow-sm)' }}
                  >
                    <p className="text-[13px] leading-relaxed" style={{ color: 'var(--wa-text)' }}>
                      {msg.text}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[9.5px]" style={{ color: 'var(--wa-text-3)' }}>
                        {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <CheckCheck className="w-3 h-3" style={{ color: 'var(--wa-tick-blue)' }} />
                    </div>
                  </div>
                </div>
              )}
              {msg.type === 'feature-row' && <FeatureRow />}
              {msg.type === 'stats' && <StatsRow {...props} />}
              {msg.type === 'cta' && <CtaBubble text={msg.text!} />}
            </div>
          );
        })}

        {showTyping && <TypingBubble />}
        <div ref={bottomRef} />
      </div>

      {/* "Input" decorativo na base (não funcional — apenas visual) */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-3"
        style={{ background: 'var(--wa-header)', borderTop: '1px solid var(--wa-divider)' }}
      >
        <div
          className="flex-1 flex items-center rounded-full px-4 py-2.5"
          style={{ background: 'var(--wa-panel)', border: '1px solid var(--wa-divider)' }}
        >
          <p className="text-[13px]" style={{ color: 'var(--wa-text-3)' }}>
            Selecione uma conversa à esquerda para começar…
          </p>
        </div>
      </div>
    </div>
  );
};
