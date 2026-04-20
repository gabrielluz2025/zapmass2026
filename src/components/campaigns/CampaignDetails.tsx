import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  Gauge,
  MessageSquare,
  Pause,
  Play,
  Reply,
  Search,
  Smartphone,
  Sparkles,
  Terminal,
  Timer,
  TrendingUp,
  User,
  Users,
  XCircle,
  Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Campaign,
  CampaignStatus,
  ChatMessage,
  ConnectionStatus,
  Contact,
  Conversation,
  SystemLog,
  WhatsAppConnection
} from '../../types';
import { useZapMass } from '../../context/ZapMassContext';
import { Badge, Button, Card, Input, Modal, Tabs } from '../ui';

interface CampaignDetailsProps {
  campaign: Campaign;
  connections: WhatsAppConnection[];
  systemLogs: SystemLog[];
  onBack: () => void;
  onTogglePause: (id: string) => void;
}

type ReportStatus = 'PENDING' | 'FAILED' | 'SENT' | 'DELIVERED' | 'READ' | 'REPLIED';
type ReportFilter = 'ALL' | 'SENT_GROUP' | 'FAILED' | 'PENDING' | 'REPLIED';
type LogFilter = 'ALL' | 'FAILED' | 'SENT';

interface ReportRow {
  id: string;
  phone: string;
  contactName: string;
  status: ReportStatus;
  sentTime: string;
  sentTimestampMs: number;
  errorMessage?: string;
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
  conversationId?: string;
  connectionId?: string;
  sentMessage?: string;
  profilePicUrl?: string;
}

const STATUS_META: Record<ReportStatus, { label: string; color: string; variant: 'success' | 'danger' | 'neutral' | 'info' | 'warning'; icon: React.ReactNode }> = {
  PENDING:   { label: 'Aguardando', color: 'var(--text-3)', variant: 'neutral', icon: <Clock className="w-3 h-3" /> },
  FAILED:    { label: 'Falha',      color: '#ef4444',       variant: 'danger',  icon: <XCircle className="w-3 h-3" /> },
  SENT:      { label: 'Enviada',    color: '#94a3b8',       variant: 'neutral', icon: <Check className="w-3 h-3" /> },
  DELIVERED: { label: 'Entregue',   color: '#3b82f6',       variant: 'info',    icon: <CheckCheck className="w-3 h-3" /> },
  READ:      { label: 'Lida',       color: '#8b5cf6',       variant: 'info',    icon: <CheckCheck className="w-3 h-3" /> },
  REPLIED:   { label: 'Respondeu',  color: '#10b981',       variant: 'success', icon: <Reply className="w-3 h-3" /> }
};

// Normaliza telefone para comparacao (somente digitos)
const cleanPhone = (raw: string): string => (raw || '').replace(/\D/g, '');

// Encontra o contato (nome) pelo telefone
const findContactName = (phone: string, contacts: Contact[]): string => {
  const target = cleanPhone(phone);
  if (!target) return '';
  for (const c of contacts) {
    if (cleanPhone(c.phone) === target) return c.name;
  }
  return '';
};

// Encontra a conversa correspondente a este envio de campanha. Como uma campanha
// pode usar varios chips, varremos todas as conversas relevantes do connectionId
// permitido pela campanha e procuramos a mensagem com fromCampaign+campaignId.
const findCampaignMessage = (
  phone: string,
  campaignId: string,
  allowedConnectionIds: string[],
  conversations: Conversation[]
): { conv: Conversation; msg: ChatMessage; reply: ChatMessage | null } | null => {
  const target = cleanPhone(phone);
  if (!target) return null;

  // WhatsApp as vezes separa a conversa em @c.us e @lid. Aqui juntamos
  // TODAS as conversas do mesmo numero (dentro das conexoes permitidas) e
  // procuramos: (a) a mensagem com fromCampaign+campaignId em qualquer uma
  // delas e (b) a resposta mais antiga >= ao envio em qualquer uma delas.
  const matches = conversations.filter((conv) => {
    if (allowedConnectionIds.length > 0 && !allowedConnectionIds.includes(conv.connectionId)) return false;
    return cleanPhone(conv.contactPhone) === target;
  });
  if (matches.length === 0) return null;

  let campaignMsg: ChatMessage | null = null;
  let campaignConv: Conversation | null = null;
  for (const conv of matches) {
    const msg = (conv.messages || []).find(
      (m) => m.sender === 'me' && m.fromCampaign && m.campaignId === campaignId
    );
    if (msg) {
      campaignMsg = msg;
      campaignConv = conv;
      break;
    }
  }
  if (!campaignMsg || !campaignConv) return null;

  const sendTs = campaignMsg.timestampMs ?? 0;
  let reply: ChatMessage | null = null;
  for (const conv of matches) {
    const candidate = (conv.messages || [])
      .filter((m) => m.sender === 'them' && (m.timestampMs ?? 0) >= sendTs)
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))[0];
    if (candidate && (!reply || (candidate.timestampMs ?? 0) < (reply.timestampMs ?? Infinity))) {
      reply = candidate;
    }
  }

  return { conv: campaignConv, msg: campaignMsg, reply };
};

const formatDateTimeBR = (raw?: string): { date: string; time: string; relative: string } => {
  if (!raw) return { date: '—', time: '', relative: '' };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { date: raw, time: '', relative: '' };
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  let relative = '';
  if (mins < 1) relative = 'agora';
  else if (mins < 60) relative = `ha ${mins} min`;
  else if (mins < 1440) relative = `ha ${Math.floor(mins / 60)}h`;
  else relative = `ha ${Math.floor(mins / 1440)}d`;
  return { date, time, relative };
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const minutes = m % 60;
  return minutes ? `${h}h ${minutes}m` : `${h}h`;
};

export const CampaignDetails: React.FC<CampaignDetailsProps> = ({
  campaign,
  connections,
  systemLogs,
  onBack,
  onTogglePause
}) => {
  const { conversations, contacts } = useZapMass();
  const reportSectionRef = useRef<HTMLDivElement>(null);
  const [detailFilter, setDetailFilter] = useState<ReportFilter>('ALL');
  const [detailSearch, setDetailSearch] = useState('');
  const [showLogModal, setShowLogModal] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>('ALL');
  const [now, setNow] = useState(Date.now());
  const [openRow, setOpenRow] = useState<ReportRow | null>(null);
  const [showPerf, setShowPerf] = useState(false);

  const isRunning = campaign.status === CampaignStatus.RUNNING;
  const isPaused = campaign.status === CampaignStatus.PAUSED;
  const isDone = campaign.status === CampaignStatus.COMPLETED;

  // Tick para ETA / "ha N segundos" enquanto a campanha esta ativa
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [isRunning]);

  const progress =
    campaign.totalContacts > 0 ? Math.round((campaign.processedCount / campaign.totalContacts) * 100) : 0;
  const successRate =
    campaign.processedCount > 0 ? Math.round((campaign.successCount / campaign.processedCount) * 100) : 0;
  const failureRate =
    campaign.processedCount > 0 ? Math.round((campaign.failedCount / campaign.processedCount) * 100) : 0;

  const statusVariant: 'success' | 'warning' | 'info' | 'neutral' = isRunning
    ? 'success'
    : isPaused
    ? 'warning'
    : isDone
    ? 'info'
    : 'neutral';
  const accent = isRunning
    ? 'var(--brand-500)'
    : isPaused
    ? '#f59e0b'
    : isDone
    ? '#3b82f6'
    : 'var(--text-3)';

  const startedAt = useMemo(() => {
    const d = new Date(campaign.createdAt);
    return isNaN(d.getTime()) ? null : d;
  }, [campaign.createdAt]);

  const elapsedSec = startedAt ? Math.max(0, (now - startedAt.getTime()) / 1000) : 0;
  const throughputPerMin =
    elapsedSec > 0 ? +(campaign.processedCount / (elapsedSec / 60)).toFixed(1) : 0;
  const remaining = Math.max(0, campaign.totalContacts - campaign.processedCount);
  const etaSec = throughputPerMin > 0 ? (remaining / throughputPerMin) * 60 : 0;
  const startedFmt = formatDateTimeBR(campaign.createdAt);

  // Gera relatorio detalhado combinando logs (tentativas) + conversations (status real e respostas).
  // Status calculado em ordem de prioridade: REPLIED > READ > DELIVERED > SENT > FAILED > PENDING.
  const detailedReport = useMemo<ReportRow[]>(() => {
    const allowedConns = campaign.selectedConnectionIds || [];

    // 1) Indexa por telefone os eventos relevantes deste campaignId
    const byPhone = new Map<string, ReportRow>();
    systemLogs.forEach((log, idx) => {
      if (!log.payload || typeof log.payload !== 'object') return;
      const p = log.payload as { campaignId?: string; to?: string; message?: string; error?: string; connectionId?: string };
      if (p.campaignId !== campaign.id || !p.to) return;

      const isError = log.event.includes('error') || log.event.includes('warn');
      const isSent = p.message === 'Mensagem enviada';
      if (!isError && !isSent) return;

      const phone = cleanPhone(p.to);
      const existing = byPhone.get(phone);
      const ts = new Date(log.timestamp).getTime();

      // Prefere o evento de SUCESSO (mais recente) sobre falhas anteriores
      if (existing && existing.status !== 'FAILED' && isError) return;

      byPhone.set(phone, {
        id: existing?.id || `${log.timestamp}-${idx}`,
        phone,
        contactName: '',
        status: isError ? 'FAILED' : 'SENT',
        sentTime: new Date(log.timestamp).toLocaleTimeString('pt-BR'),
        sentTimestampMs: ts,
        errorMessage: isError ? (p.error || p.message || 'Erro desconhecido') : undefined,
        connectionId: p.connectionId
      });
    });

    // 2) Enriquecer com nome do contato + status real (delivered/read/replied) e texto da resposta
    const rows: ReportRow[] = [];
    byPhone.forEach((row) => {
      const contactName = findContactName(row.phone, contacts);
      const found = findCampaignMessage(row.phone, campaign.id, allowedConns, conversations);

      let status: ReportStatus = row.status;
      let replyText: string | undefined;
      let replyTime: string | undefined;
      let replyTimestampMs: number | undefined;
      let conversationId: string | undefined;
      let connectionId: string | undefined = row.connectionId;
      let sentMessage: string | undefined;
      let profilePicUrl: string | undefined;
      let sentTime = row.sentTime;
      let sentTimestampMs = row.sentTimestampMs;

      if (found) {
        const { conv, msg, reply } = found;
        conversationId = conv.id;
        connectionId = conv.connectionId;
        sentMessage = msg.text;
        profilePicUrl = conv.profilePicUrl;
        if (msg.timestampMs) {
          sentTimestampMs = msg.timestampMs;
          sentTime = new Date(msg.timestampMs).toLocaleTimeString('pt-BR');
        }
        if (reply) {
          status = 'REPLIED';
          replyText = reply.text;
          replyTimestampMs = reply.timestampMs;
          replyTime = reply.timestampMs
            ? new Date(reply.timestampMs).toLocaleTimeString('pt-BR')
            : reply.timestamp;
        } else if (msg.status === 'read') {
          status = 'READ';
        } else if (msg.status === 'delivered') {
          status = 'DELIVERED';
        } else if (msg.status === 'sent' && row.status !== 'FAILED') {
          status = 'SENT';
        }
      }

      rows.push({
        ...row,
        contactName: contactName || `+${row.phone}`,
        status,
        sentTime,
        sentTimestampMs,
        replyText,
        replyTime,
        replyTimestampMs,
        conversationId,
        connectionId,
        sentMessage,
        profilePicUrl
      });
    });

    return rows.sort((a, b) => b.sentTimestampMs - a.sentTimestampMs);
  }, [systemLogs, campaign.id, campaign.selectedConnectionIds, contacts, conversations]);

  const filteredReport = useMemo(() => {
    const term = detailSearch.trim().toLowerCase();
    return detailedReport.filter((item) => {
      const matchesSearch =
        !term ||
        item.phone.includes(term) ||
        item.contactName.toLowerCase().includes(term) ||
        (item.replyText || '').toLowerCase().includes(term);

      let matchesFilter = true;
      if (detailFilter !== 'ALL') {
        if (detailFilter === 'SENT_GROUP') {
          matchesFilter = ['SENT', 'DELIVERED', 'READ', 'REPLIED'].includes(item.status);
        } else {
          matchesFilter = item.status === detailFilter;
        }
      }
      return matchesSearch && matchesFilter;
    });
  }, [detailedReport, detailFilter, detailSearch]);

  // Resumo agregado para o relatorio de desempenho (modal)
  const performance = useMemo(() => {
    const total = detailedReport.length;
    const counts: Record<ReportStatus, number> = {
      PENDING: 0, FAILED: 0, SENT: 0, DELIVERED: 0, READ: 0, REPLIED: 0
    };
    let sumResponseMs = 0;
    let countResponses = 0;
    const perChip = new Map<string, { sent: number; replied: number }>();
    const perHour = new Map<number, number>();

    for (const r of detailedReport) {
      counts[r.status]++;
      if (r.connectionId) {
        const cur = perChip.get(r.connectionId) || { sent: 0, replied: 0 };
        cur.sent++;
        if (r.status === 'REPLIED') cur.replied++;
        perChip.set(r.connectionId, cur);
      }
      if (r.status === 'REPLIED' && r.replyTimestampMs && r.sentTimestampMs) {
        sumResponseMs += r.replyTimestampMs - r.sentTimestampMs;
        countResponses++;
      }
      if (r.sentTimestampMs) {
        const h = new Date(r.sentTimestampMs).getHours();
        perHour.set(h, (perHour.get(h) || 0) + 1);
      }
    }

    const delivered = counts.DELIVERED + counts.READ + counts.REPLIED;
    const read = counts.READ + counts.REPLIED;
    const replied = counts.REPLIED;
    const successPct = total > 0 ? Math.round(((total - counts.FAILED) / total) * 100) : 0;
    const deliveryPct = total > 0 ? Math.round((delivered / total) * 100) : 0;
    const readPct = total > 0 ? Math.round((read / total) * 100) : 0;
    const replyPct = total > 0 ? Math.round((replied / total) * 100) : 0;
    const avgResponseSec = countResponses > 0 ? Math.round(sumResponseMs / countResponses / 1000) : 0;

    const chipBreakdown = Array.from(perChip.entries())
      .map(([id, data]) => {
        const conn = connections.find((c) => c.id === id);
        return {
          id,
          name: conn?.name || id.slice(0, 8),
          sent: data.sent,
          replied: data.replied,
          replyRate: data.sent > 0 ? Math.round((data.replied / data.sent) * 100) : 0
        };
      })
      .sort((a, b) => b.sent - a.sent);

    const hourBreakdown = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: perHour.get(h) || 0
    }));
    const peakHour = hourBreakdown.reduce((max, cur) => (cur.count > max.count ? cur : max), hourBreakdown[0]);

    return {
      total, counts, delivered, read, replied,
      successPct, deliveryPct, readPct, replyPct,
      avgResponseSec, chipBreakdown, hourBreakdown, peakHour
    };
  }, [detailedReport, connections]);

  const campaignLogs = useMemo(() => {
    return systemLogs.filter((log) => {
      if (!log.payload || typeof log.payload !== 'object') return false;
      const payload = log.payload as { campaignId?: string };
      return payload.campaignId === campaign.id;
    });
  }, [systemLogs, campaign.id]);

  const filteredCampaignLogs = useMemo(() => {
    if (logFilter === 'ALL') return campaignLogs;
    return campaignLogs.filter((log) => {
      if (logFilter === 'FAILED') return log.event.includes('campaign:error');
      if (logFilter === 'SENT') return log.event.includes('campaign:info');
      return true;
    });
  }, [campaignLogs, logFilter]);

  const liveLogs = useMemo(() => {
    return campaignLogs.slice(-12).reverse();
  }, [campaignLogs]);

  const handleFilterClick = (filter: ReportFilter) => {
    setDetailFilter(filter);
    reportSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const exportReportCsv = () => {
    if (filteredReport.length === 0) {
      toast.error('Nenhum registro para exportar.');
      return;
    }
    const header = 'nome;telefone;status;enviado_em;respondido_em;resposta;erro\n';
    const body = filteredReport
      .map((r) => {
        const status = STATUS_META[r.status].label;
        const safe = (s: string | undefined) => (s || '').replace(/[;\n\r]+/g, ' ');
        return `${safe(r.contactName)};${r.phone};${status};${r.sentTime};${r.replyTime || ''};${safe(r.replyText)};${safe(r.errorMessage)}`;
      })
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-${campaign.name.replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`CSV gerado com ${filteredReport.length} linhas.`);
  };

  const copyPhone = (phone: string) => {
    navigator.clipboard.writeText(phone).then(
      () => toast.success(`${phone} copiado.`),
      () => toast.error('Nao foi possivel copiar.')
    );
  };

  const onlineChips = campaign.selectedConnectionIds.filter((id) => {
    const c = connections.find((x) => x.id === id);
    return c?.status === ConnectionStatus.CONNECTED;
  }).length;

  return (
    <div className="space-y-5 pb-20">
      {/* ============================ HERO ============================ */}
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, var(--surface-0) 0%, var(--surface-1) 100%)',
          border: '1px solid var(--border)'
        }}
      >
        {/* Glow lateral colorido conforme status */}
        <div
          className="absolute top-0 left-0 w-1.5 h-full"
          style={{ background: accent, boxShadow: `0 0 24px ${accent}80` }}
        />
        <div
          className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-[0.08] pointer-events-none"
          style={{ background: `radial-gradient(circle, ${accent} 0%, transparent 60%)` }}
        />

        <div className="relative p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <Button variant="secondary" size="icon" onClick={onBack} title="Voltar">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <h2 className="text-[20px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
                  {campaign.name}
                </h2>
                <Badge variant={statusVariant} dot={isRunning}>
                  {isRunning ? 'Em execucao' : isPaused ? 'Pausada' : isDone ? 'Concluida' : 'Pendente'}
                </Badge>
              </div>
              <div
                className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[12.5px]"
                style={{ color: 'var(--text-3)' }}
              >
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {startedFmt.date} as {startedFmt.time}
                  <span className="text-[11px] opacity-70">({startedFmt.relative})</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  {campaign.contactListName || 'Lista direta'}
                </span>
                <span className="flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />
                  {onlineChips}/{campaign.selectedConnectionIds.length} chip
                  {campaign.selectedConnectionIds.length > 1 ? 's' : ''} online
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  {campaign.totalContacts.toLocaleString('pt-BR')} contatos
                </span>
              </div>
            </div>
          </div>

          {!isDone && (
            <div className="flex items-center gap-2">
              <Button
                variant={isRunning ? 'secondary' : 'primary'}
                leftIcon={isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                onClick={() => onTogglePause(campaign.id)}
              >
                {isRunning ? 'Pausar disparo' : 'Retomar disparo'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ============================ KPI STRIP ============================ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <button
          onClick={() => handleFilterClick('SENT_GROUP')}
          className="text-left rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <KpiCard
            label="Entregues"
            value={campaign.successCount.toLocaleString('pt-BR')}
            icon={<CheckCircle2 className="w-4 h-4" />}
            helper={`${successRate}% dos processados`}
            color="#10b981"
            barPercent={successRate}
            interactive
          />
        </button>
        <button
          onClick={() => handleFilterClick('REPLIED')}
          className="text-left rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <KpiCard
            label="Responderam"
            value={performance.replied.toLocaleString('pt-BR')}
            icon={<Reply className="w-4 h-4" />}
            helper={
              performance.replied > 0
                ? `${performance.replyPct}% — clique para ver`
                : 'Sem respostas ainda'
            }
            color="#10b981"
            barPercent={performance.replyPct}
            interactive
          />
        </button>
        <button
          onClick={() => handleFilterClick('FAILED')}
          className="text-left rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          <KpiCard
            label="Falhas"
            value={campaign.failedCount.toLocaleString('pt-BR')}
            icon={<XCircle className="w-4 h-4" />}
            helper={
              campaign.failedCount > 0 ? `${failureRate}% — clique para ver` : 'Nenhuma falha registrada'
            }
            color="#ef4444"
            barPercent={failureRate}
            interactive
          />
        </button>
        <KpiCard
          label="Pendentes"
          value={remaining.toLocaleString('pt-BR')}
          icon={<Clock className="w-4 h-4" />}
          helper={
            isRunning
              ? `ETA ${formatDuration(etaSec)}`
              : remaining > 0
              ? 'Aguardando retomar'
              : 'Tudo processado'
          }
          color="#f59e0b"
          barPercent={campaign.totalContacts > 0 ? (remaining / campaign.totalContacts) * 100 : 0}
        />
        <KpiCard
          label="Taxa de sucesso"
          value={`${successRate}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          helper={
            successRate >= 90
              ? 'Excelente performance'
              : successRate >= 70
              ? 'Performance ok'
              : 'Acompanhar canais'
          }
          color={successRate >= 90 ? '#10b981' : successRate >= 70 ? '#3b82f6' : '#f59e0b'}
          barPercent={successRate}
        />
      </div>

      {/* ============================ PROGRESSO + CHIPS ============================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center brand-soft">
                <Gauge className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="ui-title text-[14px]">Progresso do disparo</h3>
                <p className="ui-subtitle text-[12px]">
                  {isRunning ? 'Atualizado em tempo real' : isPaused ? 'Pausada — pronta para retomar' : 'Relatorio final'}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[28px] font-bold tabular-nums leading-none" style={{ color: accent }}>
                {progress}%
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                {campaign.processedCount.toLocaleString('pt-BR')} de{' '}
                {campaign.totalContacts.toLocaleString('pt-BR')}
              </div>
            </div>
          </div>

          {/* Barra de progresso com gradiente segmentado (sucesso/falha) */}
          <div
            className="h-3 rounded-full overflow-hidden mb-4 flex"
            style={{ background: 'var(--surface-2)' }}
          >
            <div
              className="h-full transition-all duration-700 relative"
              style={{
                width: `${(campaign.successCount / Math.max(1, campaign.totalContacts)) * 100}%`,
                background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
              }}
            >
              {isRunning && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
            </div>
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${(campaign.failedCount / Math.max(1, campaign.totalContacts)) * 100}%`,
                background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
              }}
            />
          </div>

          {/* Estatisticas inline */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniStat
              icon={<Timer className="w-3.5 h-3.5" />}
              label="Iniciado"
              value={startedFmt.time || '—'}
              hint={startedFmt.date}
            />
            <MiniStat
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Tempo decorrido"
              value={formatDuration(elapsedSec)}
              hint={isDone ? 'Finalizado' : isRunning ? 'rodando' : isPaused ? 'pausado' : ''}
            />
            <MiniStat
              icon={<Zap className="w-3.5 h-3.5" />}
              label="Throughput"
              value={throughputPerMin > 0 ? `${throughputPerMin}/min` : '—'}
              hint={isRunning ? 'media real' : 'media final'}
            />
            <MiniStat
              icon={<Sparkles className="w-3.5 h-3.5" />}
              label={isRunning ? 'Tempo estimado' : 'Restantes'}
              value={isRunning && etaSec > 0 ? formatDuration(etaSec) : remaining.toLocaleString('pt-BR')}
              hint={isRunning ? 'previsto' : remaining > 0 ? 'aguardando' : 'concluido'}
            />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(59,130,246,0.12)' }}
              >
                <Smartphone className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h3 className="ui-title text-[14px]">Chips em uso</h3>
                <p className="ui-subtitle text-[12px]">
                  {onlineChips} online de {campaign.selectedConnectionIds.length}
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {campaign.selectedConnectionIds.map((connId) => {
              const conn = connections.find((c) => c.id === connId);
              if (!conn) return null;
              const isOnline = conn.status === ConnectionStatus.CONNECTED;
              const sentToday = conn.messagesSentToday || 0;
              return (
                <div
                  key={conn.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl transition-colors"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative flex-shrink-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full block"
                        style={{
                          background: isOnline ? '#10b981' : 'var(--danger)',
                          boxShadow: isOnline ? '0 0 8px rgba(16,185,129,0.6)' : 'none'
                        }}
                      />
                      {isOnline && (
                        <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-50" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p
                        className="text-[12.5px] font-semibold truncate leading-tight"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {conn.name}
                      </p>
                      <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                        {sentToday.toLocaleString('pt-BR')} envios hoje
                      </p>
                    </div>
                  </div>
                  <Badge variant={isOnline ? 'success' : 'danger'}>{isOnline ? 'Online' : 'Offline'}</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ============================ LOGS AO VIVO ============================ */}
      <Card className="p-0 overflow-hidden">
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5"
          style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#10b981' }} />
            </div>
            <Terminal className="w-3.5 h-3.5 ml-2" style={{ color: 'var(--text-3)' }} />
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
              zapmass • logs ao vivo
            </span>
            {liveLogs.length > 0 && (
              <Badge variant="neutral">
                {liveLogs.length} evento{liveLogs.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <button
            onClick={() => setShowLogModal(true)}
            className="text-[11px] font-mono"
            style={{ color: 'var(--brand-500)' }}
          >
            ver todos →
          </button>
        </div>
        <div
          className="p-4 max-h-56 overflow-y-auto font-mono text-[11.5px] space-y-1.5"
          style={{ background: 'var(--surface-0)' }}
        >
          {liveLogs.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {isRunning
                  ? '$ aguardando primeiro evento do disparo...'
                  : isDone
                  ? '$ disparo concluido — sem novos eventos'
                  : '$ nenhum evento registrado'}
              </p>
            </div>
          ) : (
            liveLogs.map((log, idx) => {
              const payload = (log.payload || {}) as { message?: string; to?: string; error?: string };
              const isErr = log.event.includes('error');
              const isWarn = log.event.includes('warn');
              const tone = isErr ? '#ef4444' : isWarn ? '#f59e0b' : '#10b981';
              const symbol = isErr ? '✖' : isWarn ? '⚠' : '✓';
              return (
                <div key={`${log.timestamp}-${idx}`} className="flex gap-3 items-start">
                  <span className="min-w-[64px]" style={{ color: 'var(--text-3)' }}>
                    {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                  </span>
                  <span style={{ color: tone, minWidth: 14 }}>{symbol}</span>
                  <span className="flex-1" style={{ color: 'var(--text-2)' }}>
                    {payload.message || payload.error || log.event}
                    {payload.to && (
                      <span className="ml-1.5" style={{ color: 'var(--text-3)' }}>
                        → {payload.to}
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* ============================ RELATORIO DETALHADO ============================ */}
      <div ref={reportSectionRef} className="scroll-mt-6">
        <Card>
          <div className="flex flex-col lg:flex-row gap-3 justify-between lg:items-center mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center brand-soft">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="ui-title text-[14px]">Relatorio de envios</h3>
                <p className="ui-subtitle text-[12px]">
                  {filteredReport.length} de {detailedReport.length} contato
                  {detailedReport.length === 1 ? '' : 's'} • status atualizado em tempo real
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-col sm:flex-row sm:items-center">
              <div className="md:w-56">
                <Input
                  placeholder="Buscar nome, numero ou resposta..."
                  value={detailSearch}
                  onChange={(e) => setDetailSearch(e.target.value)}
                  leftIcon={<Search className="w-4 h-4" />}
                  size="sm"
                />
              </div>
              <Tabs
                value={detailFilter}
                onChange={(v) => setDetailFilter(v as ReportFilter)}
                items={[
                  { id: 'ALL', label: 'Todos' },
                  { id: 'SENT_GROUP', label: 'Entregues' },
                  { id: 'REPLIED', label: 'Responderam' },
                  { id: 'FAILED', label: 'Falhas' }
                ]}
              />
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<BarChart3 className="w-3.5 h-3.5" />}
                onClick={() => setShowPerf(true)}
              >
                Desempenho
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<Download className="w-3.5 h-3.5" />} onClick={exportReportCsv}>
                CSV
              </Button>
            </div>
          </div>

          <div
            className="overflow-x-auto max-h-[520px] overflow-y-auto rounded-xl"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <table className="w-full text-[13px] text-left">
              <thead
                className="sticky top-0 z-10"
                style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}
              >
                <tr>
                  {['Contato', 'Status', 'Enviado em', 'Resposta / Detalhe', ''].map((h, i) => (
                    <th
                      key={i}
                      className="px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredReport.length > 0 ? (
                  filteredReport.map((item) => {
                    const meta = STATUS_META[item.status];
                    const initials = (item.contactName || '+')
                      .replace(/^\+/, '')
                      .split(/\s+/)
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();
                    const replySnippet = item.replyText
                      ? item.replyText.length > 80
                        ? `${item.replyText.slice(0, 80)}…`
                        : item.replyText
                      : '';
                    return (
                      <tr
                        key={item.id}
                        className="transition-colors hover:bg-[var(--surface-1)] cursor-pointer"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        onClick={() => setOpenRow(item)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {item.profilePicUrl ? (
                              <img
                                src={item.profilePicUrl}
                                alt=""
                                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                                style={{ border: '1px solid var(--border-subtle)' }}
                              />
                            ) : (
                              <div
                                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                              >
                                {initials || <User className="w-4 h-4" />}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div
                                className="text-[13px] font-semibold truncate leading-tight"
                                style={{ color: 'var(--text-1)' }}
                              >
                                {item.contactName}
                              </div>
                              <div
                                className="text-[11.5px] font-mono truncate"
                                style={{ color: 'var(--text-3)' }}
                              >
                                +{item.phone}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={meta.variant} dot>
                            <span className="inline-flex items-center gap-1">
                              {meta.icon}
                              {meta.label}
                            </span>
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[12.5px] font-mono" style={{ color: 'var(--text-2)' }}>
                            {item.sentTime}
                          </div>
                          {item.replyTime && (
                            <div
                              className="text-[10.5px] font-mono mt-0.5 inline-flex items-center gap-1"
                              style={{ color: '#10b981' }}
                            >
                              <Reply className="w-2.5 h-2.5" />
                              respondeu {item.replyTime}
                            </div>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 text-[12.5px] max-w-[320px]"
                          title={item.replyText || item.errorMessage || ''}
                        >
                          {item.status === 'FAILED' ? (
                            <span style={{ color: 'var(--danger)' }} className="truncate inline-block max-w-full">
                              {item.errorMessage || 'Erro desconhecido'}
                            </span>
                          ) : item.replyText ? (
                            <div
                              className="px-2.5 py-1.5 rounded-lg inline-block max-w-full"
                              style={{
                                background: 'rgba(16,185,129,0.08)',
                                border: '1px solid rgba(16,185,129,0.2)',
                                color: 'var(--text-1)'
                              }}
                            >
                              <span className="truncate block">"{replySnippet}"</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-3)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyPhone(item.phone);
                            }}
                            className="p-1.5 rounded-md transition-colors hover:bg-[var(--surface-2)]"
                            title="Copiar numero"
                          >
                            <Copy className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center" style={{ color: 'var(--text-3)' }}>
                      <div className="flex flex-col items-center gap-2">
                        <FileSpreadsheet className="w-8 h-8 opacity-40" />
                        <p className="text-[13px] font-semibold">Nenhum registro encontrado</p>
                        <p className="text-[11.5px]">
                          {detailedReport.length === 0
                            ? 'Os envios aparecerao aqui assim que forem processados.'
                            : 'Ajuste os filtros para visualizar mais resultados.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ============================ MODAL LOGS ============================ */}
      <Modal
        isOpen={showLogModal}
        onClose={() => setShowLogModal(false)}
        title="Logs do disparo"
        subtitle="Eventos em tempo real desta campanha"
        icon={<Terminal className="w-5 h-5" />}
        size="md"
      >
        <div className="mb-3">
          <Tabs
            value={logFilter}
            onChange={(v) => setLogFilter(v as LogFilter)}
            items={[
              { id: 'ALL', label: 'Todos' },
              { id: 'FAILED', label: 'Falhas' },
              { id: 'SENT', label: 'Sucessos' }
            ]}
          />
        </div>
        <div
          className="max-h-80 overflow-y-auto divide-y rounded-lg"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          {filteredCampaignLogs.length === 0 ? (
            <div className="p-6 text-[13px] text-center" style={{ color: 'var(--text-3)' }}>
              Nenhum log para esta campanha.
            </div>
          ) : (
            filteredCampaignLogs.map((log, idx) => {
              const payload = (log.payload || {}) as { message?: string; to?: string; error?: string };
              return (
                <div key={`${log.timestamp}-${idx}`} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {log.event}
                    </span>
                    <span className="text-[10.5px] font-mono" style={{ color: 'var(--text-3)' }}>
                      {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                  {log.payload && (
                    <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {payload.message || payload.error || ''}
                      {payload.to ? ` → ${payload.to}` : ''}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Modal>

      {/* ============================ MODAL DETALHE DO CONTATO ============================ */}
      <Modal
        isOpen={!!openRow}
        onClose={() => setOpenRow(null)}
        title={openRow ? openRow.contactName : 'Contato'}
        subtitle={openRow ? `+${openRow.phone}` : undefined}
        icon={<MessageSquare className="w-5 h-5" />}
        size="md"
      >
        {openRow && (
          <div className="space-y-4">
            {/* Status atual + timeline */}
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {openRow.profilePicUrl ? (
                    <img
                      src={openRow.profilePicUrl}
                      alt=""
                      className="w-11 h-11 rounded-full object-cover"
                      style={{ border: '1px solid var(--border-subtle)' }}
                    />
                  ) : (
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center font-bold"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                    >
                      <User className="w-5 h-5" />
                    </div>
                  )}
                  <div>
                    <div className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {openRow.contactName}
                    </div>
                    <div className="text-[11.5px] font-mono" style={{ color: 'var(--text-3)' }}>
                      +{openRow.phone}
                    </div>
                  </div>
                </div>
                <Badge variant={STATUS_META[openRow.status].variant} dot>
                  <span className="inline-flex items-center gap-1">
                    {STATUS_META[openRow.status].icon}
                    {STATUS_META[openRow.status].label}
                  </span>
                </Badge>
              </div>

              {/* Timeline */}
              <div className="space-y-2 text-[12.5px]">
                <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                  <Check className="w-3.5 h-3.5" style={{ color: '#94a3b8' }} />
                  <span>Enviada as</span>
                  <span className="font-mono" style={{ color: 'var(--text-1)' }}>{openRow.sentTime}</span>
                </div>
                {(openRow.status === 'DELIVERED' || openRow.status === 'READ' || openRow.status === 'REPLIED') && (
                  <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                    <CheckCheck className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                    <span>Entregue no dispositivo</span>
                  </div>
                )}
                {(openRow.status === 'READ' || openRow.status === 'REPLIED') && (
                  <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                    <CheckCheck className="w-3.5 h-3.5" style={{ color: '#8b5cf6' }} />
                    <span>Lida pelo contato</span>
                  </div>
                )}
                {openRow.status === 'REPLIED' && openRow.replyTime && (
                  <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                    <Reply className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                    <span>Respondeu as</span>
                    <span className="font-mono" style={{ color: '#10b981' }}>{openRow.replyTime}</span>
                    {openRow.replyTimestampMs && openRow.sentTimestampMs && (
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        (em {formatDuration(Math.round((openRow.replyTimestampMs - openRow.sentTimestampMs) / 1000))})
                      </span>
                    )}
                  </div>
                )}
                {openRow.status === 'FAILED' && (
                  <div className="flex items-start gap-2" style={{ color: 'var(--danger)' }}>
                    <XCircle className="w-3.5 h-3.5 mt-0.5" />
                    <span>{openRow.errorMessage || 'Falha no envio.'}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Conversa estilo whatsapp */}
            {(openRow.sentMessage || openRow.replyText) && (
              <div
                className="rounded-xl p-4 space-y-2"
                style={{
                  background: 'var(--surface-0)',
                  border: '1px solid var(--border-subtle)',
                  maxHeight: 320,
                  overflowY: 'auto'
                }}
              >
                {openRow.sentMessage && (
                  <div className="flex justify-end">
                    <div
                      className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-sm text-[13px] whitespace-pre-wrap"
                      style={{
                        background: 'linear-gradient(135deg, #059669, #10b981)',
                        color: 'white'
                      }}
                    >
                      {openRow.sentMessage}
                      <div className="text-[10px] mt-1 opacity-70 text-right font-mono">{openRow.sentTime}</div>
                    </div>
                  </div>
                )}
                {openRow.replyText && (
                  <div className="flex justify-start">
                    <div
                      className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-[13px] whitespace-pre-wrap"
                      style={{
                        background: 'var(--surface-2)',
                        color: 'var(--text-1)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      {openRow.replyText}
                      <div
                        className="text-[10px] mt-1 text-right font-mono"
                        style={{ color: 'var(--text-3)' }}
                      >
                        {openRow.replyTime}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" leftIcon={<Copy className="w-3.5 h-3.5" />} onClick={() => copyPhone(openRow.phone)}>
                Copiar numero
              </Button>
              {openRow.replyText && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Copy className="w-3.5 h-3.5" />}
                  onClick={() => {
                    navigator.clipboard.writeText(openRow.replyText || '').then(
                      () => toast.success('Resposta copiada.'),
                      () => toast.error('Falha ao copiar.')
                    );
                  }}
                >
                  Copiar resposta
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ============================ MODAL RELATORIO DE DESEMPENHO ============================ */}
      <Modal
        isOpen={showPerf}
        onClose={() => setShowPerf(false)}
        title="Relatorio de desempenho"
        subtitle={campaign.name}
        icon={<BarChart3 className="w-5 h-5" />}
        size="lg"
      >
        <div className="space-y-4">
          {/* Header metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <PerfStat label="Total" value={performance.total} helper="contatos processados" color="#3b82f6" />
            <PerfStat label="Entregues" value={performance.delivered} helper={`${performance.deliveryPct}% do total`} color="#10b981" />
            <PerfStat label="Lidas" value={performance.read} helper={`${performance.readPct}% do total`} color="#8b5cf6" />
            <PerfStat label="Respostas" value={performance.replied} helper={`${performance.replyPct}% do total`} color="#10b981" />
          </div>

          {/* Funnel */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <h4 className="ui-title text-[13px] mb-3">Funil de desempenho</h4>
            <div className="space-y-2">
              {[
                { label: 'Enviadas', value: performance.total, color: '#3b82f6' },
                { label: 'Entregues', value: performance.delivered, color: '#0ea5e9' },
                { label: 'Lidas', value: performance.read, color: '#8b5cf6' },
                { label: 'Responderam', value: performance.replied, color: '#10b981' }
              ].map((row) => {
                const pct = performance.total > 0 ? (row.value / performance.total) * 100 : 0;
                return (
                  <div key={row.label}>
                    <div className="flex justify-between text-[12px] mb-1">
                      <span style={{ color: 'var(--text-2)' }}>{row.label}</span>
                      <span className="font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
                        {row.value.toLocaleString('pt-BR')} <span style={{ color: 'var(--text-3)' }}>({Math.round(pct)}%)</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, ${row.color}, ${row.color}cc)`
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Resposta tempo + distribuicao hora */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <h4 className="ui-title text-[13px] mb-2">Tempo medio de resposta</h4>
              {performance.replied > 0 ? (
                <>
                  <div className="text-[28px] font-bold" style={{ color: 'var(--text-1)' }}>
                    {formatDuration(performance.avgResponseSec)}
                  </div>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    entre envio e primeira resposta
                  </p>
                </>
              ) : (
                <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                  Ainda sem respostas para calcular.
                </p>
              )}
            </div>
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <h4 className="ui-title text-[13px] mb-2">Taxa de resposta</h4>
              <div className="flex items-end gap-2">
                <div className="text-[28px] font-bold" style={{ color: 'var(--text-1)' }}>
                  {performance.replyPct}%
                </div>
                <div className="text-[11.5px] mb-1.5" style={{ color: 'var(--text-3)' }}>
                  {performance.replied} de {performance.total}
                </div>
              </div>
              <div className="h-2 rounded-full overflow-hidden mt-2" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${performance.replyPct}%`,
                    background: 'linear-gradient(90deg, #10b981, #059669)'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Distribuicao por hora */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="ui-title text-[13px]">Distribuicao por hora</h4>
              {performance.peakHour && performance.peakHour.count > 0 && (
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Pico: {String(performance.peakHour.hour).padStart(2, '0')}h ({performance.peakHour.count} envios)
                </span>
              )}
            </div>
            <div className="flex items-end gap-0.5 h-20">
              {performance.hourBreakdown.map((h) => {
                const maxCount = Math.max(1, ...performance.hourBreakdown.map((x) => x.count));
                const barHeight = h.count > 0 ? (h.count / maxCount) * 100 : 0;
                return (
                  <div key={h.hour} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${h.hour}h: ${h.count}`}>
                    <div
                      className="w-full rounded-t transition-all"
                      style={{
                        height: `${barHeight}%`,
                        background: h.count > 0 ? 'linear-gradient(180deg, #3b82f6, #1d4ed8)' : 'transparent',
                        minHeight: h.count > 0 ? 2 : 0
                      }}
                    />
                    {h.hour % 3 === 0 && (
                      <span className="text-[9px] font-mono" style={{ color: 'var(--text-3)' }}>
                        {String(h.hour).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Breakdown por chip */}
          {performance.chipBreakdown.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <h4 className="ui-title text-[13px] mb-3">Desempenho por chip</h4>
              <div className="space-y-2">
                {performance.chipBreakdown.map((chip) => (
                  <div key={chip.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {chip.name}
                      </div>
                      <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                        {chip.sent} envios • {chip.replied} respostas ({chip.replyRate}%)
                      </div>
                    </div>
                    <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${chip.replyRate}%`,
                          background: 'linear-gradient(90deg, #10b981, #059669)'
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="w-3.5 h-3.5" />}
              onClick={exportReportCsv}
            >
              Exportar CSV
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// =====================================================================
// SUBCOMPONENTES locais — KPI premium, mini stat e perf stat
// =====================================================================

interface PerfStatProps {
  label: string;
  value: number;
  helper?: string;
  color: string;
}

const PerfStat: React.FC<PerfStatProps> = ({ label, value, helper, color }) => (
  <div
    className="rounded-xl p-3 relative overflow-hidden"
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: color }} />
    <div className="text-[10.5px] uppercase tracking-wider font-bold mb-0.5" style={{ color: 'var(--text-3)' }}>
      {label}
    </div>
    <div className="text-[22px] font-bold" style={{ color: 'var(--text-1)' }}>
      {value.toLocaleString('pt-BR')}
    </div>
    {helper && (
      <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
        {helper}
      </div>
    )}
  </div>
);

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  helper?: React.ReactNode;
  icon?: React.ReactNode;
  color: string;
  barPercent?: number;
  interactive?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, helper, icon, color, barPercent = 0, interactive }) => {
  const safePct = Math.max(0, Math.min(100, barPercent || 0));
  return (
    <div
      className={`relative rounded-xl p-4 h-full overflow-hidden ${interactive ? 'cursor-pointer' : ''}`}
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <div
        className="absolute top-0 left-0 w-full h-0.5"
        style={{ background: color, opacity: 0.7 }}
      />
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <span className="ui-eyebrow">{label}</span>
        {icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${color}1a`, color }}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="text-[26px] font-bold tracking-tight leading-none tabular-nums" style={{ color: 'var(--text-1)' }}>
        {value}
      </div>
      {helper && (
        <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-3)' }}>
          {helper}
        </div>
      )}
      {/* Mini barra inferior representando proporcao */}
      <div
        className="mt-3 h-1 rounded-full overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${safePct}%`, background: color }}
        />
      </div>
    </div>
  );
};

interface MiniStatProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}

const MiniStat: React.FC<MiniStatProps> = ({ icon, label, value, hint }) => (
  <div
    className="rounded-xl p-3"
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <div className="flex items-center gap-1.5 mb-1" style={{ color: 'var(--text-3)' }}>
      {icon}
      <span className="text-[10.5px] font-semibold uppercase tracking-wider">{label}</span>
    </div>
    <div className="text-[15px] font-bold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
      {value}
    </div>
    {hint && (
      <div className="text-[10.5px] mt-1" style={{ color: 'var(--text-3)' }}>
        {hint}
      </div>
    )}
  </div>
);
