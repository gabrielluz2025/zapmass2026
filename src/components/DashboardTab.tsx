import React, { useEffect, useMemo, useState } from 'react';
import {
  Send,
  CheckCheck,
  Reply,
  Gift,
  Cake,
  Calendar,
  User,
  Smartphone,
  ChevronDown,
  AlertTriangle,
  Activity,
  TrendingUp,
  Clock,
  Zap,
  BarChart3,
  Cpu,
  MemoryStick,
  ShieldCheck,
  MessageCircle,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ConnectionStatus } from '../types';
import { useZapMass } from '../context/ZapMassContext';
import { Card, Button, Badge, Modal, Textarea, Select } from './ui';
// Contato de aniversariante ja enriquecido com dias restantes e idade
interface UpcomingBirthday {
  id: string;
  name: string;
  phone: string;
  birthday: string;
  birthdayLabel: string;
  daysRemaining: number;
  age: number | null;
  profilePicUrl?: string;
}

const useCountUp = (target: number, duration = 1100) => {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) {
      setVal(0);
      return;
    }
    let startTs: number | null = null;
    let raf: number;
    const step = (ts: number) => {
      if (!startTs) startTs = ts;
      const p = Math.min((ts - startTs) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(ease * target));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
};

const DEFAULT_BIRTHDAY_TEMPLATE = `Ola {nome}! 🎉🎂\n\nParabens pelo seu dia! Que esse novo ciclo seja repleto de alegrias, saude e conquistas.\n\nVoce e especial para nos!`;

const BIRTHDAY_RANGE_DAYS = 30;

const parseBirthdayDate = (raw: string): Date | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  // ISO: 1990-03-15
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  // BR: 15/03/1990 ou 15/03
  const br = /^(\d{2})\/(\d{2})(?:\/(\d{4}))?/.exec(trimmed);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]) - 1;
    const year = br[3] ? Number(br[3]) : 1970;
    return new Date(year, month, day);
  }
  const tryDate = new Date(trimmed);
  if (!isNaN(tryDate.getTime())) return tryDate;
  return null;
};

// Calcula limite seguro de canais baseado na RAM total da maquina.
// Heuristica calibrada em cima do comportamento real do Chromium+WhatsApp Web em Windows.
const getChannelCapacity = (ramTotalGb: number | undefined) => {
  const gb = ramTotalGb ?? 0;
  let safe = 0;
  let critical = 0;
  if (gb <= 0) {
    safe = 3;
    critical = 5;
  } else if (gb <= 4) {
    safe = 2;
    critical = 3;
  } else if (gb <= 8) {
    safe = 5;
    critical = 7;
  } else if (gb <= 16) {
    safe = 10;
    critical = 14;
  } else if (gb <= 32) {
    safe = 20;
    critical = 26;
  } else if (gb <= 64) {
    safe = 40;
    critical = 52;
  } else {
    safe = Math.floor(gb * 0.6);
    critical = Math.floor(gb * 0.8);
  }
  return { safe, critical };
};

/**
 * Mini-card KPI usado no hero do dashboard. Compacto, grande, colorido.
 */
const HeroStat: React.FC<{ label: string; value: string; color: string; icon?: React.ReactNode }> = ({
  label,
  value,
  color,
  icon
}) => (
  <div
    className="relative overflow-hidden px-3.5 py-2.5 rounded-xl backdrop-blur-sm"
    style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <div
      className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-20 pointer-events-none"
      style={{ background: `radial-gradient(circle, ${color}, transparent 70%)` }}
      aria-hidden
    />
    <div className="relative flex items-center gap-1.5 mb-0.5">
      {icon && <span style={{ color }}>{icon}</span>}
      <p className="text-[9.5px] font-bold uppercase tracking-widest truncate" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
    </div>
    <p className="relative text-[19px] font-extrabold leading-tight tabular-nums truncate" style={{ color }}>
      {value}
    </p>
  </div>
);

/**
 * Stat card visual com gradiente, glow e barra de progresso opcional.
 * Substitui o StatCard padrao apenas no dashboard (mais impacto visual).
 */
const DashboardStat: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
  gradient: [string, string];
  helper?: React.ReactNode;
  progress?: number;
}> = ({ label, value, icon, gradient, helper, progress }) => (
  <div
    className="relative overflow-hidden rounded-2xl px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 animate-fade-in-up"
    style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border)',
      boxShadow: '0 4px 16px -8px rgba(0,0,0,0.08)'
    }}
  >
    <div
      className="absolute -top-12 -right-12 w-36 h-36 rounded-full opacity-[0.10] pointer-events-none"
      style={{ background: `radial-gradient(circle, ${gradient[0]}, transparent 60%)` }}
      aria-hidden
    />
    <div className="relative flex items-center gap-3 mb-3">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white"
        style={{
          background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
          boxShadow: `0 6px 18px -6px ${gradient[0]}`
        }}
      >
        {icon}
      </div>
      <p className="text-[10.5px] font-bold uppercase tracking-widest truncate" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
    </div>
    <p className="relative text-[30px] font-extrabold leading-none tabular-nums tracking-tight" style={{ color: 'var(--text-1)' }}>
      {value}
    </p>
    {helper && (
      <p className="relative text-[11.5px] mt-2 leading-snug" style={{ color: 'var(--text-3)' }}>
        {helper}
      </p>
    )}
    {progress != null && (
      <div
        className="relative h-1 rounded-full mt-3 overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${Math.max(2, Math.min(100, progress))}%`,
            background: `linear-gradient(90deg, ${gradient[0]}, ${gradient[1]})`,
            boxShadow: `0 0 12px ${gradient[0]}55`
          }}
        />
      </div>
    )}
  </div>
);

export const DashboardTab: React.FC = () => {
  const { connections, sendMessage, campaigns, contacts, conversations, socket, startCampaign, systemMetrics, funnelStats, clearFunnelStats } = useZapMass();

  const [confirmClearFunnel, setConfirmClearFunnel] = useState(false);

  const [selectedContact, setSelectedContact] = useState<UpcomingBirthday | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingConnectionId, setSendingConnectionId] = useState<string>('');
  const [showChannelSelector, setShowChannelSelector] = useState(false);

  const [bulkBirthdayOpen, setBulkBirthdayOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState<'compose' | 'preview'>('compose');
  const [bulkTemplate, setBulkTemplate] = useState<string>(DEFAULT_BIRTHDAY_TEMPLATE);
  const [bulkConnectionId, setBulkConnectionId] = useState<string>('');
  const [bulkDaysRange, setBulkDaysRange] = useState<number>(7);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkPreviewIndex, setBulkPreviewIndex] = useState(0);


  useEffect(() => {
    if (selectedContact && connections.length > 0) {
      const firstOnline = connections.find((c) => c.status === ConnectionStatus.CONNECTED);
      setSendingConnectionId(firstOnline ? firstOnline.id : connections[0]?.id || '');
    }
  }, [selectedContact, connections]);

  useEffect(() => {
    if (bulkBirthdayOpen && !bulkConnectionId) {
      const firstOnline = connections.find((c) => c.status === ConnectionStatus.CONNECTED);
      if (firstOnline) setBulkConnectionId(firstOnline.id);
    }
  }, [bulkBirthdayOpen, connections, bulkConnectionId]);

  const onlineCount = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
  const offlineConnections = connections.filter((c) => c.status !== ConnectionStatus.CONNECTED);

  // --- ANIVERSARIANTES (derivado de contacts) ---
  const upcomingBirthdays = useMemo<UpcomingBirthday[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: UpcomingBirthday[] = [];

    for (const c of contacts) {
      if (!c.birthday) continue;
      const parsed = parseBirthdayDate(c.birthday);
      if (!parsed) continue;
      const birthMonth = parsed.getMonth();
      const birthDay = parsed.getDate();
      const birthYear = parsed.getFullYear();

      // Proxima ocorrencia do aniversario
      let next = new Date(today.getFullYear(), birthMonth, birthDay);
      if (next < today) {
        next = new Date(today.getFullYear() + 1, birthMonth, birthDay);
      }
      const diffMs = next.getTime() - today.getTime();
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (days > BIRTHDAY_RANGE_DAYS) continue;

      const ageNow = birthYear > 1900 && birthYear < today.getFullYear()
        ? next.getFullYear() - birthYear
        : null;

      const cleanPhone = (c.phone || '').replace(/\D/g, '');
      if (cleanPhone.length < 10) continue;

      result.push({
        id: c.id,
        name: c.name,
        phone: cleanPhone,
        birthday: c.birthday,
        birthdayLabel: new Date(today.getFullYear(), birthMonth, birthDay).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit'
        }),
        daysRemaining: days,
        age: ageNow
      });
    }

    return result.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [contacts]);

  const todaysBirthdays = upcomingBirthdays.filter((b) => b.daysRemaining === 0);
  const weekBirthdays = upcomingBirthdays.filter((b) => b.daysRemaining <= 7);

  const bulkCandidates = useMemo(
    () => upcomingBirthdays.filter((b) => b.daysRemaining <= bulkDaysRange),
    [upcomingBirthdays, bulkDaysRange]
  );

  const allBulkSelected =
    bulkCandidates.length > 0 && bulkCandidates.every((b) => bulkSelectedIds.has(b.id));

  const toggleBulkSelect = (id: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBulkSelectAll = () => {
    setBulkSelectedIds((prev) => {
      if (bulkCandidates.every((b) => prev.has(b.id))) {
        return new Set(Array.from(prev).filter((id) => !bulkCandidates.some((b) => b.id === id)));
      }
      const next = new Set(prev);
      bulkCandidates.forEach((b) => next.add(b.id));
      return next;
    });
  };

  const openBulkBirthday = () => {
    setBulkBirthdayOpen(true);
    setBulkStep('compose');
    setBulkPreviewIndex(0);
    setBulkTemplate(DEFAULT_BIRTHDAY_TEMPLATE);
    setBulkDaysRange(7);
    setBulkSelectedIds(new Set(upcomingBirthdays.filter((b) => b.daysRemaining <= 7).map((b) => b.id)));
  };

  // Substitui variaveis {nome}, {idade}, etc. igual ao backend
  const renderTemplate = (tpl: string, b: UpcomingBirthday): string => {
    const vars: Record<string, string> = {
      nome: (b.name || '').split(' ')[0] || b.name || '',
      nome_completo: b.name || '',
      telefone: b.phone,
      aniversario: b.birthdayLabel,
      idade: b.age != null ? String(b.age) : ''
    };
    return tpl.replace(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g, (match, key) => {
      const v = vars[String(key).toLowerCase()];
      return v !== undefined ? v : match;
    });
  };

  const bulkSelectedList = useMemo(
    () => bulkCandidates.filter((b) => bulkSelectedIds.has(b.id)),
    [bulkCandidates, bulkSelectedIds]
  );

  const goToPreview = () => {
    if (!bulkConnectionId) {
      toast.error('Selecione um canal online para disparar.');
      return;
    }
    if (bulkSelectedIds.size === 0) {
      toast.error('Selecione pelo menos um aniversariante.');
      return;
    }
    if (!bulkTemplate.trim()) {
      toast.error('Escreva a mensagem que sera enviada.');
      return;
    }
    setBulkPreviewIndex(0);
    setBulkStep('preview');
  };

  const handleBulkBirthdaySubmit = async () => {
    if (!bulkConnectionId || bulkSelectedList.length === 0 || !bulkTemplate.trim()) return;

    const recipients = bulkSelectedList.map((b) => ({
      phone: b.phone,
      vars: {
        nome: (b.name || '').split(' ')[0] || b.name || '',
        nome_completo: b.name || '',
        telefone: b.phone,
        aniversario: b.birthdayLabel,
        idade: b.age != null ? String(b.age) : ''
      }
    }));

    const numbers = recipients.map((r) => r.phone);
    setBulkSubmitting(true);
    try {
      await startCampaign(
        bulkConnectionId,
        numbers,
        bulkTemplate.trim(),
        [bulkConnectionId],
        { id: undefined, name: `Aniversariantes (${bulkSelectedList.length})` },
        `Parabens automatico - ${new Date().toLocaleDateString('pt-BR')}`,
        { delaySeconds: 10, recipients }
      );
      toast.success(`Disparo de parabens iniciado para ${bulkSelectedList.length} contatos.`);
      setBulkBirthdayOpen(false);
      setBulkSelectedIds(new Set());
      setBulkStep('compose');
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao iniciar disparo de aniversariantes.');
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleOpenChat = (contact: UpcomingBirthday) => {
    setSelectedContact(contact);
    const firstName = (contact.name || '').split(' ')[0] || 'amigo(a)';
    const ageLine = contact.age ? `\n\nParabens pelos seus ${contact.age} anos!` : '';
    const whenLabel = contact.daysRemaining === 0 ? 'hoje' : `em ${contact.daysRemaining} dia${contact.daysRemaining > 1 ? 's' : ''}`;
    setMessageText(
      `Ola ${firstName}! 🎉🎂\n\nSeu aniversario e ${whenLabel} (${contact.birthdayLabel}) e quero te desejar muita saude, alegria e conquistas!${ageLine}\n\nFeliz aniversario!`
    );
  };

  const handleSendMessage = () => {
    if (!selectedContact || !sendingConnectionId || !messageText.trim()) return;
    const phone = selectedContact.phone?.replace(/\D/g, '');
    if (!phone) {
      toast.error('Contato sem numero de telefone.');
      return;
    }
    const conversationId = `${sendingConnectionId}:${phone}@c.us`;
    sendMessage(conversationId, messageText.trim());
    toast.success(`Mensagem enviada para ${selectedContact.name}.`);
    setSelectedContact(null);
    setShowChannelSelector(false);
    setMessageText('');
  };


  const currentChannel = connections.find((c) => c.id === sendingConnectionId);

  // --- METRICAS REAIS (acumulador persistente do servidor) ---
  // funnelStats sobrevive a reinicios do servidor e a delecao de campanhas.
  // Pode ser zerado pelo usuario via botao "Limpar" abaixo do funil.
  const metrics = useMemo(() => ({
    totalSent: funnelStats.totalSent,
    totalDelivered: funnelStats.totalDelivered,
    totalRead: funnelStats.totalRead,
    totalReplied: funnelStats.totalReplied
  }), [funnelStats]);

  const deliveryRate = metrics.totalSent > 0 ? Math.round((metrics.totalDelivered / metrics.totalSent) * 100) : 0;
  const readRate = metrics.totalSent > 0 ? Math.round((metrics.totalRead / metrics.totalSent) * 100) : 0;
  const replyRate = metrics.totalSent > 0 ? Math.round((metrics.totalReplied / metrics.totalSent) * 100) : 0;

  const funnelStages = useMemo(
    () => [
      {
        label: 'Enviadas',
        value: metrics.totalSent,
        pctOfSent: metrics.totalSent > 0 ? 100 : 0,
        color: 'var(--brand-500)',
        colorSoft: 'rgba(16, 185, 129, 0.14)'
      },
      {
        label: 'Entregues',
        value: metrics.totalDelivered,
        pctOfSent: deliveryRate,
        color: '#3b82f6',
        colorSoft: 'rgba(59, 130, 246, 0.14)'
      },
      {
        label: 'Lidas',
        value: metrics.totalRead,
        pctOfSent: readRate,
        color: '#8b5cf6',
        colorSoft: 'rgba(139, 92, 246, 0.14)'
      },
      {
        label: 'Respostas',
        value: metrics.totalReplied,
        pctOfSent: replyRate,
        color: '#f59e0b',
        colorSoft: 'rgba(245, 158, 11, 0.14)'
      }
    ],
    [deliveryRate, metrics.totalDelivered, metrics.totalRead, metrics.totalReplied, metrics.totalSent, readRate, replyRate]
  );

  const funnelEmpty =
    metrics.totalSent === 0 &&
    metrics.totalDelivered === 0 &&
    metrics.totalRead === 0 &&
    metrics.totalReplied === 0;

  const topSenders = useMemo(
    () => [...connections].sort((a, b) => b.messagesSentToday - a.messagesSentToday).slice(0, 5),
    [connections]
  );

  const animSent = useCountUp(metrics.totalSent);
  const animDelivered = useCountUp(metrics.totalDelivered);
  const animRead = useCountUp(metrics.totalRead);
  const animReplied = useCountUp(metrics.totalReplied);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-5 pb-10">
      {/* HERO HEADER - animated gradient + live KPIs */}
      <div
        className="relative overflow-hidden rounded-3xl px-5 py-5 sm:px-7 sm:py-6 animate-fade-in-up"
        style={{
          background: 'linear-gradient(135deg, var(--surface-0) 0%, var(--surface-1) 100%)',
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px -30px rgba(16,185,129,0.2)'
        }}
      >
        {/* Orbs animados */}
        <div
          className="absolute -top-24 -right-12 w-80 h-80 rounded-full animate-blob pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(16,185,129,0.22), transparent 60%)',
            filter: 'blur(28px)'
          }}
          aria-hidden
        />
        <div
          className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full animate-blob-slow pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.14), transparent 60%)',
            filter: 'blur(32px)'
          }}
          aria-hidden
        />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 relative animate-glow-pulse"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 12px 32px -8px rgba(16,185,129,0.55)'
              }}
            >
              <BarChart3 className="w-7 h-7 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-2 mb-1.5">
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-widest"
                  style={{
                    background: 'rgba(16,185,129,0.12)',
                    color: 'var(--brand-600)',
                    border: '1px solid rgba(16,185,129,0.28)'
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Motor ativo
                </span>
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  <Clock className="w-3 h-3" />
                  {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <h1
                className="text-[24px] sm:text-[30px] font-extrabold leading-tight tracking-tight"
                style={{ color: 'var(--text-1)' }}
              >
                {greeting},{' '}
                <span
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 45%, #3b82f6 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                  }}
                >
                  Administrador
                </span>
              </h1>
              <p className="mt-1 text-[13px] capitalize" style={{ color: 'var(--text-2)' }}>
                {now.toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}
              </p>
            </div>
          </div>

          {/* KPIs ao vivo no hero */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 shrink-0 w-full lg:w-auto">
            <HeroStat
              label="Canais"
              value={`${onlineCount}/${connections.length || 0}`}
              color="#10b981"
              icon={<Cpu className="w-3 h-3" />}
            />
            <HeroStat
              label="Enviadas"
              value={metrics.totalSent.toLocaleString('pt-BR')}
              color="#3b82f6"
              icon={<Send className="w-3 h-3" />}
            />
            <HeroStat
              label="Entrega"
              value={`${deliveryRate}%`}
              color="#8b5cf6"
              icon={<TrendingUp className="w-3 h-3" />}
            />
          </div>
        </div>
      </div>

      {/* STAT CARDS - com glow, progress e animação */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <DashboardStat
          label="Enviadas"
          value={animSent.toLocaleString('pt-BR')}
          icon={<Send className="w-4 h-4" />}
          gradient={['#10b981', '#059669']}
          helper={metrics.totalSent > 0 ? `${campaigns.length} campanha${campaigns.length > 1 ? 's' : ''} registrada${campaigns.length > 1 ? 's' : ''}` : 'Aguardando a primeira campanha'}
          progress={metrics.totalSent > 0 ? 100 : 0}
        />
        <DashboardStat
          label="Entregues"
          value={animDelivered.toLocaleString('pt-BR')}
          icon={<CheckCheck className="w-4 h-4" />}
          gradient={['#3b82f6', '#1d4ed8']}
          helper={metrics.totalSent > 0 ? `${deliveryRate}% dos envios chegaram` : 'Ainda sem envios'}
          progress={deliveryRate}
        />
        <DashboardStat
          label="Lidas"
          value={animRead.toLocaleString('pt-BR')}
          icon={<CheckCheck className="w-4 h-4" />}
          gradient={['#8b5cf6', '#6d28d9']}
          helper={metrics.totalSent > 0 ? `${readRate}% taxa de leitura` : 'Aguardando leituras'}
          progress={readRate}
        />
        <DashboardStat
          label="Respostas"
          value={animReplied.toLocaleString('pt-BR')}
          icon={<Reply className="w-4 h-4" />}
          gradient={['#f59e0b', '#d97706']}
          helper={metrics.totalSent > 0 ? `${replyRate}% engajamento` : 'Aguardando engajamento'}
          progress={replyRate}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center brand-soft">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="ui-title text-[15px]">Funil de Desempenho</h3>
                <p className="ui-subtitle text-[12px]">
                  Acumulado histórico — persiste após reinícios e exclusão de campanhas
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success" dot>
                Tempo real
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClearFunnel(true)}
                disabled={
                  metrics.totalSent === 0 &&
                  metrics.totalDelivered === 0 &&
                  metrics.totalRead === 0 &&
                  metrics.totalReplied === 0
                }
                title="Zerar contadores do funil"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Limpar
              </Button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
            <div className="flex-1 min-w-0">
              {funnelEmpty ? (
                <div
                  className="rounded-2xl px-4 py-12 text-center relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%)',
                    border: '1px dashed var(--border)'
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-[0.08] pointer-events-none"
                    style={{
                      background: 'radial-gradient(400px 140px at 50% 0%, rgba(16,185,129,0.6), transparent 70%)'
                    }}
                    aria-hidden
                  />
                  <div
                    className="relative mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                    style={{
                      background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(59,130,246,0.14))',
                      border: '1px solid rgba(16,185,129,0.22)'
                    }}
                  >
                    <TrendingUp className="w-7 h-7" style={{ color: 'var(--brand-600)' }} />
                  </div>
                  <p className="relative text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                    Nenhum evento acumulado ainda
                  </p>
                  <p className="relative text-[12px] mt-1.5 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    Assim que houver envios, o funil mostra a conversão entre etapas <strong style={{ color: 'var(--text-2)' }}>em tempo real</strong>.
                  </p>
                </div>
              ) : (
                <div className="relative mx-auto w-full max-w-[min(100%,460px)]">
                  <div
                    className="absolute left-1/2 top-3 bottom-3 w-px -translate-x-1/2 opacity-[0.14] pointer-events-none hidden sm:block"
                    style={{ background: 'linear-gradient(180deg, transparent, var(--text-3), transparent)' }}
                    aria-hidden
                  />
                  {(() => {
                    const stageWidths = funnelStages.map((s) => {
                      if (metrics.totalSent <= 0) return 0;
                      if (s.value > 0) return Math.max(s.pctOfSent, 8);
                      return Math.max(s.pctOfSent, 3);
                    });
                    const bottomOutlet = Math.max(stageWidths[3] * 0.62, stageWidths[3] > 0 ? 5 : 2.5);

                    return funnelStages.map((stage, idx) => {
                      const nextStage = funnelStages[idx + 1];
                      const wTop = stageWidths[idx];
                      const wBot =
                        idx < 3
                          ? stageWidths[idx + 1]
                          : Math.min(bottomOutlet, wTop > 0 ? wTop : bottomOutlet);

                      let conversionLine: string | null = null;
                      if (nextStage) {
                        if (stage.value > 0) {
                          const pct = Math.min(
                            100,
                            Math.round((nextStage.value / stage.value) * 100)
                          );
                          if (pct === 0) {
                            conversionLine = `Ninguém avançou para ${nextStage.label}`;
                          } else if (pct === 100) {
                            conversionLine = `Todos seguem para ${nextStage.label}`;
                          } else {
                            conversionLine = `${pct}% avançam para ${nextStage.label}`;
                          }
                        } else if (idx > 0) {
                          conversionLine = 'Sem volume nesta etapa ainda';
                        } else {
                          conversionLine = '—';
                        }
                      }

                      const tooltip = `${stage.label}: ${stage.value.toLocaleString('pt-BR')} (${stage.pctOfSent}% dos envios)`;
                      const safeTop = Math.min(100, Math.max(wTop, 0.5));
                      const safeBot = Math.min(100, Math.max(wBot, 0.25));
                      const clip = `polygon(${50 - safeTop / 2}% 0%, ${50 + safeTop / 2}% 0%, ${
                        50 + safeBot / 2
                      }% 100%, ${50 - safeBot / 2}% 100%)`;

                      return (
                        <div key={stage.label} className="relative">
                          <div
                            className="group relative h-[3.35rem] sm:h-[3.55rem] -mt-[1px] first:mt-0 transition-transform duration-200 hover:z-10 hover:scale-[1.01] focus-visible:z-10 focus-visible:outline-none"
                            title={tooltip}
                            tabIndex={0}
                            role="group"
                            aria-label={tooltip}
                          >
                            <div
                              className="absolute inset-0 overflow-hidden"
                              style={{
                                clipPath: clip,
                                WebkitClipPath: clip,
                                background:
                                  stage.color === 'var(--brand-500)'
                                    ? `linear-gradient(165deg, rgba(16,185,129,0.92) 0%, rgba(5,150,105,0.55) 100%)`
                                    : `linear-gradient(165deg, ${stage.color}e6 0%, ${stage.color}99 100%)`,
                                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 14px 28px -18px rgba(0,0,0,0.65)'
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center px-3 sm:px-5 pointer-events-none">
                              <div className="flex w-full max-w-[min(92%,22rem)] items-center justify-between gap-2 sm:gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0 ring-2 ring-black/25"
                                    style={{ background: 'rgba(255,255,255,0.92)' }}
                                  />
                                  <span className="text-[11.5px] sm:text-[13px] font-bold truncate text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]">
                                    {stage.label}
                                  </span>
                                </div>
                                <div className="flex items-baseline gap-1.5 sm:gap-2 shrink-0">
                                  <span className="text-[19px] sm:text-[22px] font-extrabold tabular-nums leading-none text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
                                    {stage.value.toLocaleString('pt-BR')}
                                  </span>
                                  <span className="text-[11px] sm:text-[12px] font-bold tabular-nums min-w-[2.35rem] text-right text-white/90">
                                    {stage.pctOfSent}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                          {idx < funnelStages.length - 1 && (
                            <div
                              className="flex items-center justify-center gap-2 py-1.5 min-h-[1.75rem]"
                              style={{ color: 'var(--text-3)' }}
                            >
                              <div className="h-px w-5 sm:w-8 opacity-60" style={{ background: 'var(--border-1)' }} />
                              <span className="text-[11px] sm:text-[11.5px] font-medium text-center leading-snug px-1 max-w-[16rem]">
                                {conversionLine ?? '—'}
                              </span>
                              <div className="h-px w-5 sm:w-8 opacity-60" style={{ background: 'var(--border-1)' }} />
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            {!funnelEmpty && (
              <div
                className="lg:w-[248px] shrink-0 rounded-2xl p-3.5 space-y-3.5"
                style={{
                  border: '1px solid rgba(255,255,255,0.06)',
                  background: 'linear-gradient(165deg, var(--surface-2) 0%, var(--surface-1) 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
                }}
              >
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                  Resumo
                </p>
                <ul className="space-y-3 text-[12.5px]">
                  {[
                    { label: 'Entrega', v: deliveryRate, color: '#3b82f6' },
                    { label: 'Leitura', v: readRate, color: '#8b5cf6' },
                    { label: 'Resposta', v: replyRate, color: '#f59e0b' }
                  ].map((row) => (
                    <li key={row.label}>
                      <div className="flex justify-between gap-2 mb-1">
                        <span style={{ color: 'var(--text-3)' }}>{row.label}</span>
                        <span className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                          {row.v}%
                        </span>
                      </div>
                      <div
                        className="h-1.5 rounded-full overflow-hidden"
                        style={{ background: 'var(--surface-2)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${Math.min(100, row.v)}%`, background: row.color, opacity: 0.85 }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-[10.5px] leading-snug pt-0.5 border-t border-white/[0.06]" style={{ color: 'var(--text-3)' }}>
                  Percentuais referem-se ao total de envios acumulado no servidor.
                </p>
              </div>
            )}
          </div>

          <div
            className="mt-6 p-4 rounded-2xl flex items-start gap-3.5 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(16,185,129,0.08) 100%)',
              border: '1px solid rgba(245, 158, 11, 0.22)',
              boxShadow: '0 12px 40px -24px rgba(245, 158, 11, 0.45)'
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.12]"
              style={{
                background: 'radial-gradient(600px 120px at 20% 0%, rgba(245,158,11,0.5), transparent 60%)'
              }}
            />
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 relative"
              style={{ background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.35)' }}
            >
              <Zap className="w-5 h-5" style={{ color: '#fbbf24' }} />
            </div>
            <div className="relative min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                Insight operacional
              </p>
              <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                Melhor janela para disparos: <strong className="text-[var(--text-1)]">10h às 11h30</strong>. Taxa de
                resposta atual: <strong style={{ color: replyRate > 0 ? 'var(--brand-600)' : '#f59e0b' }}>{replyRate}%</strong>
                {replyRate === 0 ? (
                  <>
                    . <span className="text-[var(--text-3)]">Sem respostas registradas ainda — priorize horário e texto do convite.</span>
                  </>
                ) : (
                  '.'
                )}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(236,72,153,0.12)' }}>
                <Cake className="w-4 h-4 text-pink-500" />
              </div>
              <div>
                <h3 className="ui-title text-[15px]">Aniversariantes</h3>
                <p className="ui-subtitle text-[12px]">
                  {todaysBirthdays.length > 0
                    ? `${todaysBirthdays.length} hoje - ${weekBirthdays.length} nesta semana`
                    : `Proximos ${BIRTHDAY_RANGE_DAYS} dias`}
                </p>
              </div>
            </div>
            <Badge variant="neutral">{upcomingBirthdays.length}</Badge>
          </div>

          {upcomingBirthdays.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Sparkles className="w-3.5 h-3.5" />}
              className="w-full mb-3"
              onClick={openBulkBirthday}
            >
              Felicitar todos ({weekBirthdays.length})
            </Button>
          )}

          <div className="flex-1 overflow-y-auto max-h-[320px] space-y-1.5">
            {upcomingBirthdays.length === 0 ? (
              <div className="py-8 text-center">
                <Cake className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-3)' }} />
                <p className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>
                  Nenhum aniversariante proximo
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                  Adicione a data de nascimento em Contatos.
                </p>
              </div>
            ) : (
              upcomingBirthdays.map((contact) => (
                <div
                  key={contact.id}
                  className="p-2.5 rounded-lg transition-colors flex items-center justify-between group hover:bg-[var(--surface-2)]"
                  style={{ background: 'var(--surface-1)' }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {contact.profilePicUrl ? (
                      <img
                        src={contact.profilePicUrl}
                        alt={contact.name}
                        className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/10 text-pink-500">
                        {contact.daysRemaining === 0 ? <Cake className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>
                        {contact.name}
                        {contact.age != null && (
                          <span className="ml-1.5 text-[10.5px] font-normal" style={{ color: 'var(--text-3)' }}>
                            - {contact.age} anos
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        <Calendar className="w-3 h-3" />
                        <span>{contact.birthdayLabel}</span>
                        {contact.daysRemaining === 0 ? (
                          <span className="ml-1 px-1.5 py-0.5 rounded font-bold bg-pink-100 dark:bg-pink-500/15 text-pink-600">
                            Hoje
                          </span>
                        ) : contact.daysRemaining === 1 ? (
                          <span className="ml-1 px-1.5 py-0.5 rounded font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-600">
                            Amanha
                          </span>
                        ) : (
                          <span className="ml-1" style={{ color: 'var(--text-3)' }}>
                            em {contact.daysRemaining} dias
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleOpenChat(contact)} title="Enviar parabens agora">
                    <MessageCircle className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="ui-title text-[15px]">Canais em destaque</h3>
              <p className="ui-subtitle text-[12px]">Top envios de hoje</p>
            </div>
            <Badge variant="neutral">Hoje</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {topSenders.length === 0 ? (
              <div className="col-span-full py-10 text-center">
                <div
                  className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                  style={{
                    background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(59,130,246,0.12))',
                    border: '1px solid rgba(16,185,129,0.2)'
                  }}
                >
                  <Smartphone className="w-7 h-7" style={{ color: 'var(--brand-600)' }} />
                </div>
                <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                  Nenhum canal ativo ainda
                </p>
                <p className="text-[12px] mt-1 max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
                  Conecte seu primeiro WhatsApp na aba <strong style={{ color: 'var(--text-2)' }}>Canais</strong> para começar a enviar campanhas.
                </p>
              </div>
            ) : (
              topSenders.map((conn) => (
                <div
                  key={conn.id}
                  className="p-3.5 rounded-xl flex items-center justify-between"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>
                        {conn.name}
                      </p>
                      {conn.status === ConnectionStatus.CONNECTED ? (
                        <Badge variant="success" dot />
                      ) : (
                        <Badge variant="danger" dot />
                      )}
                    </div>
                    <p className="text-[11.5px] font-mono" style={{ color: 'var(--text-3)' }}>
                      {conn.phoneNumber || 'Sem numero'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <p className="text-[20px] font-bold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                      {conn.messagesSentToday}
                    </p>
                    <p className="text-[9.5px] uppercase font-semibold tracking-widest mt-1" style={{ color: 'var(--text-3)' }}>
                      envios
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          {(() => {
            const cap = getChannelCapacity(systemMetrics?.ramTotalGb);
            const total = connections.length;
            const percent = cap.safe > 0 ? Math.min(100, Math.round((total / cap.safe) * 100)) : 0;
            const level: 'ok' | 'warn' | 'critical' =
              total >= cap.critical ? 'critical' : total > cap.safe ? 'warn' : 'ok';
            const color =
              level === 'critical' ? '#ef4444' : level === 'warn' ? '#f59e0b' : '#10b981';
            const bg =
              level === 'critical'
                ? 'rgba(239,68,68,0.12)'
                : level === 'warn'
                ? 'rgba(245,158,11,0.12)'
                : 'rgba(16,185,129,0.12)';
            const icon =
              level === 'critical' ? (
                <AlertTriangle className="w-4 h-4" style={{ color }} />
              ) : level === 'warn' ? (
                <AlertTriangle className="w-4 h-4" style={{ color }} />
              ) : (
                <ShieldCheck className="w-4 h-4" style={{ color }} />
              );
            const headline =
              level === 'critical'
                ? 'Capacidade no limite'
                : level === 'warn'
                ? 'Proximo do limite seguro'
                : 'Capacidade saudavel';
            const subtitle =
              systemMetrics?.ramTotalGb != null
                ? `Servidor com ${systemMetrics.ramTotalGb} GB - limite recomendado ${cap.safe} canais`
                : 'Analisando capacidade do servidor...';

            return (
              <div className="mb-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: bg }}>
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="ui-title text-[15px]">{headline}</h3>
                    <p className="ui-subtitle text-[12px] truncate">{subtitle}</p>
                  </div>
                </div>

                <div className="flex items-baseline justify-between mb-1.5">
                  <div>
                    <span className="text-[24px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                      {total}
                    </span>
                    <span className="text-[13px] ml-1" style={{ color: 'var(--text-3)' }}>
                      / {cap.safe} canais
                    </span>
                  </div>
                  <span className="text-[11.5px] font-semibold tabular-nums" style={{ color }}>
                    {percent}%
                  </span>
                </div>
                <div
                  className="w-full h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${percent}%`, background: color }}
                  />
                </div>

                {systemMetrics?.ramUsedGb != null && systemMetrics?.ramTotalGb != null && (
                  <div className="mt-3 flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    <MemoryStick className="w-3.5 h-3.5" />
                    <span>
                      RAM: <strong style={{ color: 'var(--text-2)' }}>{systemMetrics.ramUsedGb} GB</strong> de {systemMetrics.ramTotalGb} GB ({systemMetrics.ram}%)
                    </span>
                  </div>
                )}

                {level !== 'ok' && (
                  <div
                    className="mt-3 p-2.5 rounded-lg text-[11.5px] leading-relaxed"
                    style={{ background: bg, border: `1px solid ${color}33`, color: 'var(--text-2)' }}
                  >
                    {level === 'critical' ? (
                      <>
                        <strong style={{ color }}>Atencao:</strong> voce esta acima do limite critico ({cap.critical}). Os canais podem ficar instaveis, cair com frequencia ou travar o servidor. Considere remover canais ociosos ou migrar para uma maquina com mais RAM.
                      </>
                    ) : (
                      <>
                        <strong style={{ color }}>Aviso:</strong> voce ultrapassou o limite seguro de {cap.safe} canais para esta maquina. Acima de {cap.critical} o sistema pode ficar instavel.
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <div
            className="pt-3 flex items-center justify-between mb-2"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
              Canais offline
            </span>
            <span className="text-[18px] font-bold tabular-nums" style={{ color: offlineConnections.length > 0 ? '#ef4444' : 'var(--text-3)' }}>
              {offlineConnections.length}
            </span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {offlineConnections.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                Tudo online no momento.
              </p>
            ) : (
              offlineConnections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between text-[11.5px] p-2 rounded-md"
                  style={{ background: 'var(--surface-1)' }}
                >
                  <span className="truncate font-medium" style={{ color: 'var(--text-1)' }}>
                    {conn.name}
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>{conn.lastActivity || '-'}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Modal
        isOpen={!!selectedContact}
        onClose={() => {
          setSelectedContact(null);
          setShowChannelSelector(false);
        }}
        title={selectedContact?.name}
        subtitle={
          selectedContact
            ? `+${selectedContact.phone} - ${selectedContact.birthdayLabel}${
                selectedContact.daysRemaining === 0 ? ' (hoje)' : ''
              }`
            : undefined
        }
        icon={<Cake className="w-4 h-4 text-pink-500" />}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelectedContact(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              leftIcon={<Send className="w-4 h-4" />}
              disabled={!sendingConnectionId || !messageText}
              onClick={handleSendMessage}
            >
              Enviar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="ui-eyebrow mb-1.5 block">Enviando por</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowChannelSelector((v) => !v)}
                className="w-full flex items-center justify-between p-3 rounded-lg transition-all"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 brand-soft">
                    {currentChannel?.profilePicUrl ? (
                      <img src={currentChannel.profilePicUrl} alt="" className="w-8 h-8 rounded-md" />
                    ) : (
                      <Smartphone className="w-4 h-4" />
                    )}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                      {currentChannel?.name || 'Selecione um canal'}
                    </p>
                    <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                      {currentChannel?.phoneNumber || '-'}
                    </p>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              </button>
              {showChannelSelector && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto"
                  style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
                >
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => {
                        setSendingConnectionId(conn.id);
                        setShowChannelSelector(false);
                      }}
                      disabled={conn.status !== ConnectionStatus.CONNECTED}
                      className="w-full flex items-center justify-between p-3 hover:bg-[var(--surface-1)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="text-left min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {conn.name}
                        </p>
                        <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                          {conn.phoneNumber || '-'}
                        </p>
                      </div>
                      {conn.status !== ConnectionStatus.CONNECTED && <Badge variant="danger">Offline</Badge>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="ui-eyebrow mb-1.5 block">Mensagem</label>
            <Textarea
              rows={6}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bulkBirthdayOpen}
        onClose={() => {
          if (bulkSubmitting) return;
          setBulkBirthdayOpen(false);
          setBulkStep('compose');
        }}
        title={bulkStep === 'compose' ? 'Felicitar aniversariantes' : 'Revise antes de disparar'}
        subtitle={
          bulkStep === 'compose'
            ? 'Monte uma mensagem unica e dispare para todos de uma vez'
            : `Confira exatamente o que cada pessoa vai receber (${bulkSelectedList.length} mensagens)`
        }
        icon={<Sparkles className="w-4 h-4 text-pink-500" />}
        size="lg"
        footer={
          bulkStep === 'compose' ? (
            <>
              <Button variant="ghost" onClick={() => setBulkBirthdayOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                leftIcon={<Sparkles className="w-4 h-4" />}
                disabled={bulkSelectedIds.size === 0 || !bulkConnectionId || !bulkTemplate.trim()}
                onClick={goToPreview}
              >
                Pre-visualizar ({bulkSelectedIds.size})
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setBulkStep('compose')} disabled={bulkSubmitting}>
                Voltar e editar
              </Button>
              <Button
                variant="primary"
                leftIcon={<Send className="w-4 h-4" />}
                disabled={bulkSubmitting}
                onClick={handleBulkBirthdaySubmit}
              >
                {bulkSubmitting ? 'Disparando...' : `Confirmar e disparar para ${bulkSelectedList.length}`}
              </Button>
            </>
          )
        }
      >
        {bulkStep === 'compose' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="ui-eyebrow mb-1.5 block">Canal de envio</label>
              <Select value={bulkConnectionId} onChange={(e) => setBulkConnectionId(e.target.value)}>
                <option value="">Selecione um canal...</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.status !== ConnectionStatus.CONNECTED}>
                    {c.name} {c.status !== ConnectionStatus.CONNECTED ? '(offline)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="ui-eyebrow mb-1.5 block">Periodo dos aniversariantes</label>
              <Select value={bulkDaysRange} onChange={(e) => setBulkDaysRange(Number(e.target.value))}>
                <option value={0}>Apenas hoje</option>
                <option value={1}>Ate amanha</option>
                <option value={3}>Proximos 3 dias</option>
                <option value={7}>Proximos 7 dias</option>
                <option value={15}>Proximos 15 dias</option>
                <option value={30}>Proximos 30 dias</option>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="ui-eyebrow">Mensagem (use variaveis entre chaves)</label>
              <Badge variant="info">{'{nome} {idade} {aniversario}'}</Badge>
            </div>
            <Textarea
              rows={6}
              value={bulkTemplate}
              onChange={(e) => setBulkTemplate(e.target.value)}
              placeholder={DEFAULT_BIRTHDAY_TEMPLATE}
            />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
              Exemplos: <code>{'{nome}'}</code> = primeiro nome, <code>{'{nome_completo}'}</code>, <code>{'{idade}'}</code>, <code>{'{aniversario}'}</code>.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="ui-eyebrow">
                Aniversariantes selecionados ({bulkSelectedIds.size} de {bulkCandidates.length})
              </label>
              <button
                type="button"
                onClick={toggleBulkSelectAll}
                className="text-[11.5px] font-semibold hover:underline"
                style={{ color: 'var(--brand-600)' }}
              >
                {allBulkSelected ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>

            <div
              className="rounded-xl max-h-[260px] overflow-y-auto divide-y"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderColor: 'var(--border-subtle)' }}
            >
              {bulkCandidates.length === 0 ? (
                <div className="py-8 text-center text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                  Nenhum aniversariante no periodo selecionado.
                </div>
              ) : (
                bulkCandidates.map((b) => {
                  const checked = bulkSelectedIds.has(b.id);
                  return (
                    <label
                      key={b.id}
                      className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBulkSelect(b.id)}
                        className="w-4 h-4 accent-pink-500"
                      />
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/10 text-pink-500">
                        {b.daysRemaining === 0 ? <Cake className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {b.name}
                          {b.age != null && (
                            <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>
                              - {b.age} anos
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                          +{b.phone}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {b.birthdayLabel}
                        </p>
                        <p className="text-[10.5px]" style={{ color: b.daysRemaining === 0 ? '#ec4899' : 'var(--text-3)' }}>
                          {b.daysRemaining === 0 ? 'Hoje' : b.daysRemaining === 1 ? 'Amanha' : `em ${b.daysRemaining} dias`}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div
            className="p-3 rounded-xl flex items-start gap-2.5"
            style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.18)' }}
          >
            <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-pink-500" />
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              No proximo passo voce vera <strong>exatamente como cada mensagem ficara</strong>, com o nome de cada pessoa ja preenchido, antes de confirmar o envio.
            </p>
          </div>
        </div>
        ) : (
          <div className="space-y-4">
            {bulkSelectedList.length === 0 ? (
              <div className="py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                Nenhum aniversariante selecionado.
              </div>
            ) : (
              <>
                {/* Navegador entre mensagens */}
                <div
                  className="flex items-center justify-between p-2 rounded-lg"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bulkPreviewIndex === 0}
                    onClick={() => setBulkPreviewIndex((i) => Math.max(0, i - 1))}
                  >
                    ← Anterior
                  </Button>
                  <div className="text-center">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      Mensagem {bulkPreviewIndex + 1} de {bulkSelectedList.length}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Para {bulkSelectedList[bulkPreviewIndex]?.name}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bulkPreviewIndex >= bulkSelectedList.length - 1}
                    onClick={() => setBulkPreviewIndex((i) => Math.min(bulkSelectedList.length - 1, i + 1))}
                  >
                    Proxima →
                  </Button>
                </div>

                {/* Preview da mensagem em estilo WhatsApp */}
                {bulkSelectedList[bulkPreviewIndex] && (() => {
                  const b = bulkSelectedList[bulkPreviewIndex];
                  const rendered = renderTemplate(bulkTemplate, b);
                  return (
                    <div
                      className="rounded-xl p-4"
                      style={{
                        background: 'linear-gradient(135deg, rgba(236,72,153,0.06), rgba(139,92,246,0.06))',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div className="flex items-center gap-3 pb-3 mb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/15 text-pink-500">
                          <User className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                            {b.name}
                          </p>
                          <p className="text-[11.5px] font-mono" style={{ color: 'var(--text-3)' }}>
                            +{b.phone}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                            {b.birthdayLabel}
                          </p>
                          <p
                            className="text-[10.5px] font-bold"
                            style={{ color: b.daysRemaining === 0 ? '#ec4899' : 'var(--text-3)' }}
                          >
                            {b.daysRemaining === 0
                              ? '🎂 Hoje'
                              : b.daysRemaining === 1
                              ? 'Amanha'
                              : `em ${b.daysRemaining} dias`}
                          </p>
                        </div>
                      </div>

                      <div
                        className="rounded-lg p-3 text-[13.5px] whitespace-pre-wrap leading-relaxed"
                        style={{
                          background: 'var(--surface-0)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-1)',
                          maxHeight: '260px',
                          overflowY: 'auto'
                        }}
                      >
                        {rendered || <span style={{ color: 'var(--text-3)' }}>(mensagem vazia)</span>}
                      </div>
                    </div>
                  );
                })()}

                {/* Resumo + miniatura das demais */}
                <div>
                  <p className="ui-eyebrow mb-2">Resumo das {bulkSelectedList.length} mensagens</p>
                  <div
                    className="rounded-xl max-h-[180px] overflow-y-auto divide-y"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    {bulkSelectedList.map((b, idx) => {
                      const preview = renderTemplate(bulkTemplate, b).replace(/\s+/g, ' ').slice(0, 80);
                      const active = idx === bulkPreviewIndex;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBulkPreviewIndex(idx)}
                          className="w-full flex items-center gap-3 p-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                          style={{
                            background: active ? 'rgba(236,72,153,0.08)' : 'transparent'
                          }}
                        >
                          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/10 text-pink-500 text-[11px] font-bold">
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                              {b.name}
                            </p>
                            <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                              {preview}
                              {preview.length >= 80 ? '...' : ''}
                            </p>
                          </div>
                          {active && <Badge variant="info">atual</Badge>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  className="p-3 rounded-xl flex items-start gap-2.5"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                  <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                    Ao confirmar, uma campanha real sera criada e as mensagens serao enviadas com intervalo anti-ban de 10 segundos. Esta acao <strong>nao pode ser desfeita</strong>.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Confirmacao para zerar contadores do funil */}
      <Modal
        isOpen={confirmClearFunnel}
        onClose={() => setConfirmClearFunnel(false)}
        title="Zerar funil de desempenho?"
        icon={<RotateCcw className="w-5 h-5" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="ghost" onClick={() => setConfirmClearFunnel(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearFunnelStats();
                setConfirmClearFunnel(false);
              }}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Zerar agora
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[13.5px]" style={{ color: 'var(--text-1)' }}>
            Os contadores de <strong>Enviadas</strong>, <strong>Entregues</strong>, <strong>Lidas</strong> e <strong>Respostas</strong> voltarao para zero.
          </p>
          <div
            className="p-3 rounded-xl flex items-start gap-2.5"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              Esta acao nao pode ser desfeita. Suas campanhas, conversas e contatos <strong>nao</strong> sao apagados — apenas os totais do painel.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div
              className="p-2.5 rounded-lg text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Enviadas</p>
              <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                {metrics.totalSent.toLocaleString('pt-BR')}
              </p>
            </div>
            <div
              className="p-2.5 rounded-lg text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Respostas</p>
              <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                {metrics.totalReplied.toLocaleString('pt-BR')}
              </p>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
