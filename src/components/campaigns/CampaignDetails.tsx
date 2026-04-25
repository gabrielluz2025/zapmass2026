import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  MessageSquare,
  Pause,
  Play,
  Reply,
  Search,
  Share2,
  Smartphone,
  Terminal,
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
import { PerformanceFunnel } from '../PerformanceFunnel';
import { CampaignScoreCard } from './CampaignScoreCard';
import { CampaignDetailInsights } from './CampaignDetailInsights';
import { CampaignMessagePreview } from './CampaignMessagePreview';
import { CampaignChipsPodium } from './CampaignChipsPodium';

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

const cleanPhone = (raw: string): string => (raw || '').replace(/\D/g, '');

const findContactName = (phone: string, contacts: Contact[]): string => {
  const target = cleanPhone(phone);
  if (!target) return '';
  for (const c of contacts) {
    if (cleanPhone(c.phone) === target) return c.name;
  }
  return '';
};

const findCampaignMessage = (
  phone: string,
  campaignId: string,
  allowedConnectionIds: string[],
  conversations: Conversation[]
): { conv: Conversation; msg: ChatMessage; reply: ChatMessage | null } | null => {
  const target = cleanPhone(phone);
  if (!target) return null;

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

const buildRowsFromConversations = (
  campaign: Campaign,
  contacts: Contact[],
  conversations: Conversation[]
): ReportRow[] => {
  const allowed = campaign.selectedConnectionIds || [];
  const scoped =
    allowed.length > 0
      ? conversations.filter((conv) => allowed.includes(conv.connectionId))
      : conversations;
  const byPhone = new Map<string, ReportRow>();

  for (const conv of scoped) {
    const msgs = (conv.messages || []).filter(
      (m) => m.sender === 'me' && m.fromCampaign && m.campaignId === campaign.id
    );
    if (msgs.length === 0) continue;
    const ordered = msgs.slice().sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
    const sent = ordered[0];
    const sentTs = sent.timestampMs ?? 0;
    const reply = (conv.messages || [])
      .filter((m) => m.sender === 'them' && (m.timestampMs ?? 0) >= sentTs)
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))[0];

    let status: ReportStatus = 'SENT';
    if (reply) status = 'REPLIED';
    else if (sent.status === 'read') status = 'READ';
    else if (sent.status === 'delivered') status = 'DELIVERED';

    const phone = cleanPhone(conv.contactPhone || '');
    if (!phone) continue;
    const existing = byPhone.get(phone);
    // Se já existe para o mesmo telefone, preferimos o mais recente.
    const existingTs = existing?.sentTimestampMs ?? 0;
    if (existing && existingTs > sentTs) continue;

    byPhone.set(phone, {
      id: `conv-${conv.id}-${sent.id}`,
      phone,
      contactName: findContactName(phone, contacts) || conv.contactName || `+${phone}`,
      status,
      sentTime: sent.timestamp || '',
      sentTimestampMs: sentTs,
      replyText: reply?.text,
      replyTime: reply?.timestamp,
      replyTimestampMs: reply?.timestampMs,
      conversationId: conv.id,
      connectionId: conv.connectionId,
      sentMessage: sent.text,
      profilePicUrl: conv.profilePicUrl
    });
  }

  return Array.from(byPhone.values()).sort((a, b) => b.sentTimestampMs - a.sentTimestampMs);
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
  else if (mins < 60) relative = `há ${mins} min`;
  else if (mins < 1440) relative = `há ${Math.floor(mins / 60)}h`;
  else relative = `há ${Math.floor(mins / 1440)}d`;
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

// Etapas da timeline por status
const timelineStepsFor = (status: ReportStatus) => {
  if (status === 'FAILED') return { sent: false, delivered: false, read: false, replied: false, failed: true };
  return {
    sent: ['SENT', 'DELIVERED', 'READ', 'REPLIED'].includes(status),
    delivered: ['DELIVERED', 'READ', 'REPLIED'].includes(status),
    read: ['READ', 'REPLIED'].includes(status),
    replied: status === 'REPLIED',
    failed: false
  };
};

const RowTimeline: React.FC<{ status: ReportStatus }> = ({ status }) => {
  const s = timelineStepsFor(status);
  const step = (active: boolean, color: string, title: string) => (
    <span
      className="inline-flex items-center gap-0.5"
      title={title}
      style={{ color: active ? color : 'var(--text-3)', opacity: active ? 1 : 0.35 }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full block"
        style={{
          background: active ? color : 'var(--surface-2)',
          boxShadow: active ? `0 0 6px ${color}` : 'none'
        }}
      />
    </span>
  );
  const line = (active: boolean, color: string) => (
    <span
      className="h-0.5 w-3 block rounded-full"
      style={{ background: active ? color : 'var(--surface-2)', opacity: active ? 1 : 0.4 }}
    />
  );
  if (s.failed) {
    return (
      <span className="inline-flex items-center gap-1" title="Falha">
        <XCircle className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="timeline do envio">
      {step(s.sent, '#94a3b8', 'Enviada')}
      {line(s.delivered, '#3b82f6')}
      {step(s.delivered, '#3b82f6', 'Entregue')}
      {line(s.read, '#8b5cf6')}
      {step(s.read, '#8b5cf6', 'Lida')}
      {line(s.replied, '#10b981')}
      {step(s.replied, '#10b981', 'Respondeu')}
    </span>
  );
};

// =============================================================
// MAIN
// =============================================================
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

  const isRunning = campaign.status === CampaignStatus.RUNNING;
  const isPaused = campaign.status === CampaignStatus.PAUSED;
  const isDone = campaign.status === CampaignStatus.COMPLETED;

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
  const accentHex = isRunning ? '#10b981' : isPaused ? '#f59e0b' : isDone ? '#3b82f6' : '#94a3b8';

  const startedAt = useMemo(() => {
    const d = new Date(campaign.createdAt);
    return isNaN(d.getTime()) ? null : d;
  }, [campaign.createdAt]);

  const elapsedSec = startedAt ? Math.max(0, (now - startedAt.getTime()) / 1000) : 0;
  const throughputPerMin =
    elapsedSec > 0 ? +(campaign.processedCount / (elapsedSec / 60)).toFixed(1) : 0;
  const remaining = Math.max(0, campaign.totalContacts - campaign.processedCount);
  // Pendente "real-time": fila viva no backend (queueSize por chip selecionado).
  // Em cenários com retry/reconexão, esse valor tende a refletir melhor o que ainda falta sair.
  const pendingLive = useMemo(() => {
    const selected = new Set(campaign.selectedConnectionIds || []);
    if (selected.size === 0) return 0;
    return connections
      .filter((conn) => selected.has(conn.id))
      .reduce((acc, conn) => acc + Math.max(0, Number(conn.queueSize) || 0), 0);
  }, [campaign.selectedConnectionIds, connections]);
  const etaSec = throughputPerMin > 0 ? (remaining / throughputPerMin) * 60 : 0;
  const startedFmt = formatDateTimeBR(campaign.createdAt);

  // Detailed report (lógica preservada)
  const detailedReport = useMemo<ReportRow[]>(() => {
    const allowedConns = campaign.selectedConnectionIds || [];
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

    const rowsFromLogs = rows.sort((a, b) => b.sentTimestampMs - a.sentTimestampMs);
    const rowsFromConversations = buildRowsFromConversations(campaign, contacts, conversations);
    const mergedByPhone = new Map<string, ReportRow>();
    for (const row of rowsFromConversations) mergedByPhone.set(row.phone, row);
    for (const row of rowsFromLogs) {
      const existing = mergedByPhone.get(row.phone);
      if (!existing) {
        mergedByPhone.set(row.phone, row);
        continue;
      }
      // Log de falha tem prioridade para não mascarar erro.
      if (row.status === 'FAILED' && existing.status !== 'FAILED') {
        mergedByPhone.set(row.phone, { ...existing, ...row });
        continue;
      }
      // Caso contrário, mantemos o registro mais novo.
      if ((row.sentTimestampMs || 0) > (existing.sentTimestampMs || 0)) {
        mergedByPhone.set(row.phone, { ...existing, ...row });
      }
    }
    return Array.from(mergedByPhone.values()).sort((a, b) => b.sentTimestampMs - a.sentTimestampMs);
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

  const performance = useMemo(() => {
    const total = detailedReport.length;
    const counts: Record<ReportStatus, number> = {
      PENDING: 0, FAILED: 0, SENT: 0, DELIVERED: 0, READ: 0, REPLIED: 0
    };
    let sumResponseMs = 0;
    let countResponses = 0;
    const perChip = new Map<string, { sent: number; replied: number }>();
    const failedPerChip = new Map<string, number>();
    const perHour = new Map<number, number>();

    for (const r of detailedReport) {
      counts[r.status]++;
      if (r.connectionId) {
        const cur = perChip.get(r.connectionId) || { sent: 0, replied: 0 };
        cur.sent++;
        if (r.status === 'REPLIED') cur.replied++;
        perChip.set(r.connectionId, cur);
        if (r.status === 'FAILED') {
          failedPerChip.set(r.connectionId, (failedPerChip.get(r.connectionId) || 0) + 1);
        }
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
      avgResponseSec, chipBreakdown, hourBreakdown, peakHour, failedPerChip
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

  const liveLogs = useMemo(() => campaignLogs.slice(-12).reverse(), [campaignLogs]);

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
      () => toast.error('Não foi possível copiar.')
    );
  };

  const shareReport = () => {
    const lines = [
      `📊 Relatório: ${campaign.name}`,
      `Status: ${isRunning ? 'Em execução' : isPaused ? 'Pausada' : isDone ? 'Concluída' : 'Pendente'}`,
      `Total: ${campaign.totalContacts} contatos`,
      `Entregues: ${campaign.successCount} (${successRate}%)`,
      `Respostas: ${performance.replied} (${performance.replyPct}%)`,
      `Falhas: ${campaign.failedCount}`,
      startedAt ? `Iniciada em: ${startedFmt.date} ${startedFmt.time}` : ''
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines).then(
      () => toast.success('Resumo copiado para compartilhar.'),
      () => toast.error('Falha ao copiar.')
    );
  };

  const onlineChips = campaign.selectedConnectionIds.filter((id) => {
    const c = connections.find((x) => x.id === id);
    return c?.status === ConnectionStatus.CONNECTED;
  }).length;

  // Donut geometry (hero)
  const donutSize = 200;
  const donutStroke = 18;
  const donutR = (donutSize - donutStroke) / 2;
  const donutC = 2 * Math.PI * donutR;
  const successArc = (campaign.successCount / Math.max(1, campaign.totalContacts)) * donutC;
  const failArc = (campaign.failedCount / Math.max(1, campaign.totalContacts)) * donutC;

  return (
    <div className="space-y-5 pb-20">
      {/* ============================ HERO MISSION REPORT ============================ */}
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, var(--surface-0) 0%, var(--surface-1) 100%)',
          border: '1px solid var(--border)'
        }}
      >
        <div
          className="absolute top-0 left-0 w-1.5 h-full"
          style={{ background: accent, boxShadow: `0 0 28px ${accentHex}66` }}
        />
        <div
          className="absolute -top-28 -right-28 w-96 h-96 rounded-full opacity-[0.1] pointer-events-none"
          style={{ background: `radial-gradient(circle, ${accentHex} 0%, transparent 60%)` }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--text-2) 1px, transparent 1px), linear-gradient(to bottom, var(--text-2) 1px, transparent 1px)',
            backgroundSize: '28px 28px'
          }}
          aria-hidden
        />

        <div className="relative p-5 sm:p-6">
          {/* Top action bar */}
          <div className="flex items-center justify-between gap-2 mb-5">
            <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
              Voltar
            </Button>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {!isDone && (
                <Button
                  variant={isRunning ? 'secondary' : 'primary'}
                  size="sm"
                  leftIcon={isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  onClick={() => onTogglePause(campaign.id)}
                >
                  {isRunning ? 'Pausar' : 'Retomar'}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Share2 className="w-4 h-4" />}
                onClick={shareReport}
                title="Copiar resumo para compartilhar"
              >
                Compartilhar
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Download className="w-4 h-4" />}
                onClick={exportReportCsv}
              >
                CSV
              </Button>
            </div>
          </div>

          {/* Bento grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Title + metadata (span 7) */}
            <div className="lg:col-span-7 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span
                  className="text-[10px] font-extrabold uppercase tracking-[0.18em]"
                  style={{ color: 'var(--text-3)' }}
                >
                  Mission Report
                </span>
                <Badge variant={statusVariant} dot={isRunning}>
                  {isRunning ? 'Em execução' : isPaused ? 'Pausada' : isDone ? 'Concluída' : 'Pendente'}
                </Badge>
              </div>
              <h1
                className="font-black tracking-tight leading-[1.05] mb-3"
                style={{
                  color: 'var(--text-1)',
                  fontSize: 'clamp(26px, 3.2vw, 38px)'
                }}
              >
                {campaign.name}
              </h1>
              <div
                className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[12.5px]"
                style={{ color: 'var(--text-3)' }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span style={{ color: 'var(--text-2)' }}>{startedFmt.date}</span>
                  <span>às {startedFmt.time}</span>
                  <span className="text-[11px] opacity-70">({startedFmt.relative})</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  {campaign.contactListName || 'Lista direta'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  <span style={{ color: 'var(--text-2)' }}>{campaign.totalContacts.toLocaleString('pt-BR')}</span>
                  contatos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />
                  <span style={{ color: onlineChips > 0 ? '#10b981' : 'var(--text-2)' }}>
                    {onlineChips}/{campaign.selectedConnectionIds.length}
                  </span>
                  chip{campaign.selectedConnectionIds.length > 1 ? 's' : ''} online
                </span>
              </div>

              {/* Vital stats */}
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <VitalStat
                  label="Tempo"
                  value={formatDuration(elapsedSec)}
                  hint={isDone ? 'Total' : isRunning ? 'decorrido' : 'pausada'}
                />
                <VitalStat
                  label="Ritmo"
                  value={throughputPerMin > 0 ? `${throughputPerMin}/min` : '—'}
                  hint={isRunning ? 'média viva' : 'média final'}
                  accent="#3b82f6"
                />
                <VitalStat
                  label={isRunning ? 'ETA' : 'Restantes'}
                  value={isRunning && etaSec > 0 ? formatDuration(etaSec) : remaining.toLocaleString('pt-BR')}
                  hint={isRunning ? 'previsto' : remaining > 0 ? 'aguardando' : 'concluído'}
                  accent="#f59e0b"
                />
                <VitalStat
                  label="Taxa sucesso"
                  value={`${successRate}%`}
                  hint={successRate >= 90 ? 'excelente' : successRate >= 70 ? 'bom' : 'acompanhar'}
                  accent={successRate >= 90 ? '#10b981' : successRate >= 70 ? '#3b82f6' : '#f59e0b'}
                />
              </div>
            </div>

            {/* Progress donut (span 5) */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div className="relative" style={{ width: donutSize, height: donutSize }}>
                <svg width={donutSize} height={donutSize} viewBox={`0 0 ${donutSize} ${donutSize}`}>
                  <defs>
                    <linearGradient id="heroSuccess" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                    <linearGradient id="heroFail" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset="100%" stopColor="#dc2626" />
                    </linearGradient>
                  </defs>
                  <circle
                    cx={donutSize / 2}
                    cy={donutSize / 2}
                    r={donutR}
                    fill="none"
                    stroke="var(--surface-2)"
                    strokeWidth={donutStroke}
                  />
                  {/* Success arc */}
                  <circle
                    cx={donutSize / 2}
                    cy={donutSize / 2}
                    r={donutR}
                    fill="none"
                    stroke="url(#heroSuccess)"
                    strokeWidth={donutStroke}
                    strokeDasharray={`${successArc} ${donutC}`}
                    strokeDashoffset={0}
                    strokeLinecap="round"
                    transform={`rotate(-90 ${donutSize / 2} ${donutSize / 2})`}
                    style={{
                      transition: 'stroke-dasharray 1s ease-out',
                      filter: 'drop-shadow(0 0 8px rgba(16,185,129,0.5))'
                    }}
                  />
                  {/* Failed arc (continues after success) */}
                  {campaign.failedCount > 0 && (
                    <circle
                      cx={donutSize / 2}
                      cy={donutSize / 2}
                      r={donutR}
                      fill="none"
                      stroke="url(#heroFail)"
                      strokeWidth={donutStroke}
                      strokeDasharray={`${failArc} ${donutC}`}
                      strokeDashoffset={-successArc}
                      strokeLinecap="round"
                      transform={`rotate(-90 ${donutSize / 2} ${donutSize / 2})`}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className="text-[11px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: 'var(--text-3)' }}
                  >
                    Progresso
                  </span>
                  <span
                    className="text-[54px] font-black tabular-nums leading-none"
                    style={{
                      background: `linear-gradient(135deg, ${accentHex}, ${accentHex}aa)`,
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text'
                    }}
                  >
                    {progress}%
                  </span>
                  <span className="text-[11px] mt-0.5 tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {campaign.processedCount.toLocaleString('pt-BR')} /{' '}
                    {campaign.totalContacts.toLocaleString('pt-BR')}
                  </span>
                  {isRunning && (
                    <div className="mt-1 flex items-center gap-1">
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ background: '#10b981' }}
                      />
                      <span
                        className="text-[9.5px] font-bold uppercase tracking-widest"
                        style={{ color: '#10b981' }}
                      >
                        AO VIVO
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================ KPI PILLS (clickable filters) ============================ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <KpiPill
          label="Entregues"
          value={campaign.successCount.toLocaleString('pt-BR')}
          helper={`${successRate}% do total`}
          color="#10b981"
          onClick={() => handleFilterClick('SENT_GROUP')}
        />
        <KpiPill
          label="Responderam"
          value={performance.replied.toLocaleString('pt-BR')}
          helper={performance.replied > 0 ? `${performance.replyPct}%` : 'sem respostas'}
          color="#8b5cf6"
          onClick={() => handleFilterClick('REPLIED')}
        />
        <KpiPill
          label="Falhas"
          value={campaign.failedCount.toLocaleString('pt-BR')}
          helper={campaign.failedCount > 0 ? `${failureRate}%` : 'nenhuma'}
          color="#ef4444"
          onClick={() => handleFilterClick('FAILED')}
        />
        <KpiPill
          label="Pendentes"
          value={pendingLive.toLocaleString('pt-BR')}
          helper={
            isRunning
              ? `fila ao vivo${etaSec > 0 ? ` · ETA ${formatDuration(etaSec)}` : ''}`
              : pendingLive > 0
              ? 'fila aguardando'
              : 'sem fila'
          }
          color="#f59e0b"
          onClick={() => handleFilterClick('PENDING')}
        />
      </div>

      {/* ============================ JORNADA DA MENSAGEM ============================ */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(59,130,246,0.12))',
              border: '1px solid rgba(16,185,129,0.25)'
            }}
          >
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
          </div>
          <div>
            <h3 className="ui-title text-[15px]">Jornada da mensagem</h3>
            <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              funil completo com taxas de conversão e benchmarks de mercado
            </p>
          </div>
        </div>
        <PerformanceFunnel
          sent={performance.total || campaign.successCount + campaign.failedCount}
          delivered={performance.delivered}
          read={performance.read}
          replied={performance.replied}
          height={340}
        />
      </div>

      {/* ============================ SCORE + MESSAGE PREVIEW ============================ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <CampaignScoreCard
            inputs={{
              delivered: performance.delivered,
              read: performance.read,
              replied: performance.replied,
              total: performance.total || campaign.totalContacts,
              throughputPerMin,
              failed: performance.counts.FAILED
            }}
          />
        </div>
        <div className="lg:col-span-2">
          <CampaignMessagePreview campaign={campaign} />
        </div>
      </div>

      {/* ============================ INSIGHTS ============================ */}
      <CampaignDetailInsights
        data={{
          total: performance.total,
          delivered: performance.delivered,
          read: performance.read,
          replied: performance.replied,
          failed: performance.counts.FAILED,
          avgResponseSec: performance.avgResponseSec,
          peakHour: performance.peakHour,
          chipBreakdown: performance.chipBreakdown,
          throughputPerMin,
          isRunning
        }}
      />

      {/* ============================ CHIPS PODIUM + LOGS ============================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CampaignChipsPodium
          selectedConnectionIds={campaign.selectedConnectionIds}
          connections={connections}
          chipBreakdown={performance.chipBreakdown}
          failedPerChip={performance.failedPerChip}
        />

        {/* Logs ao vivo */}
        <Card className="p-0 overflow-hidden flex flex-col">
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
            className="p-4 flex-1 min-h-[220px] max-h-[340px] overflow-y-auto font-mono text-[11.5px] space-y-1.5"
            style={{ background: 'var(--surface-0)' }}
          >
            {liveLogs.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  {isRunning
                    ? '$ aguardando primeiro evento do disparo...'
                    : isDone
                    ? '$ disparo concluído — sem novos eventos'
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
      </div>

      {/* ============================ RELATÓRIO DETALHADO ============================ */}
      <div ref={reportSectionRef} className="scroll-mt-6">
        <Card>
          <div className="flex flex-col lg:flex-row gap-3 justify-between lg:items-center mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center brand-soft">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="ui-title text-[14px]">Relatório de envios</h3>
                <p className="ui-subtitle text-[12px]">
                  {filteredReport.length} de {detailedReport.length} contato
                  {detailedReport.length === 1 ? '' : 's'} • status em tempo real
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-col sm:flex-row sm:items-center">
              <div className="md:w-56">
                <Input
                  placeholder="Buscar nome, número ou resposta..."
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
              <Button variant="secondary" size="sm" leftIcon={<Download className="w-3.5 h-3.5" />} onClick={exportReportCsv}>
                CSV
              </Button>
            </div>
          </div>

          <div
            className="overflow-x-auto max-h-[560px] overflow-y-auto rounded-xl"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <table className="w-full text-[13px] text-left">
              <thead
                className="sticky top-0 z-10"
                style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}
              >
                <tr>
                  {['Contato', 'Timeline', 'Status', 'Enviado / Respondeu', 'Resposta / Detalhe', ''].map((h, i) => (
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
                    const replyLatency =
                      item.replyTimestampMs && item.sentTimestampMs
                        ? Math.round((item.replyTimestampMs - item.sentTimestampMs) / 1000)
                        : null;
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
                          <RowTimeline status={item.status} />
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
                              {item.replyTime}
                              {replyLatency !== null && replyLatency > 0 && (
                                <span className="opacity-70">· em {formatDuration(replyLatency)}</span>
                              )}
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
                            title="Copiar número"
                          >
                            <Copy className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center" style={{ color: 'var(--text-3)' }}>
                      <div className="flex flex-col items-center gap-2">
                        <FileSpreadsheet className="w-8 h-8 opacity-40" />
                        <p className="text-[13px] font-semibold">Nenhum registro encontrado</p>
                        <p className="text-[11.5px]">
                          {detailedReport.length === 0
                            ? 'Os envios aparecerão aqui assim que forem processados.'
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

              <div className="space-y-2 text-[12.5px]">
                <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                  <Check className="w-3.5 h-3.5" style={{ color: '#94a3b8' }} />
                  <span>Enviada às</span>
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
                    <span>Respondeu às</span>
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
                Copiar número
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
    </div>
  );
};

// =====================================================================
// SUBCOMPONENTES LOCAIS
// =====================================================================
interface VitalStatProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: string;
}

const VitalStat: React.FC<VitalStatProps> = ({ label, value, hint, accent }) => (
  <div
    className="rounded-xl p-2.5 relative overflow-hidden"
    style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    {accent && (
      <div
        className="absolute top-0 left-0 w-full h-0.5"
        style={{ background: accent, opacity: 0.7 }}
      />
    )}
    <div
      className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] mb-0.5"
      style={{ color: 'var(--text-3)' }}
    >
      {label}
    </div>
    <div
      className="text-[15.5px] font-black tabular-nums leading-tight"
      style={{ color: 'var(--text-1)' }}
    >
      {value}
    </div>
    {hint && (
      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
        {hint}
      </div>
    )}
  </div>
);

interface KpiPillProps {
  label: string;
  value: React.ReactNode;
  helper?: React.ReactNode;
  color: string;
  onClick?: () => void;
}

const KpiPill: React.FC<KpiPillProps> = ({ label, value, helper, color, onClick }) => (
  <button
    onClick={onClick}
    className="text-left rounded-2xl p-4 transition-all hover:scale-[1.015] active:scale-[0.985] relative overflow-hidden group"
    style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <div
      className="absolute left-0 top-0 h-full w-1"
      style={{ background: color, opacity: 0.85 }}
    />
    <div
      className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
      style={{
        background: `radial-gradient(200px 80px at 100% 0%, ${color}22, transparent 70%)`
      }}
    />
    <div className="relative">
      <div
        className="text-[10px] font-extrabold uppercase tracking-[0.14em] mb-1"
        style={{ color: 'var(--text-3)' }}
      >
        {label}
      </div>
      <div
        className="text-[26px] font-black tabular-nums leading-none"
        style={{ color: 'var(--text-1)' }}
      >
        {value}
      </div>
      {helper && (
        <div
          className="text-[11px] font-semibold mt-1.5"
          style={{ color }}
        >
          {helper}
        </div>
      )}
    </div>
  </button>
);
