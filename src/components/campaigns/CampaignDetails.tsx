import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  MessageSquare,
  Pause,
  Play,
  Printer,
  RefreshCw,
  Reply,
  Search,
  Share2,
  Smartphone,
  Terminal,
  TrendingUp,
  User,
  Users,
  X,
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
import { useZapMassCore, useZapMassConversations } from '../../context/ZapMassContext';
import { useAuth } from '../../context/AuthContext';
import {
  fetchCampaignInboundReplies,
  fetchCampaignLogs,
  fetchCampaignReport,
  type CampaignInboundReplyDto,
  type CampaignLogDto,
  type CampaignReportSnapshotDto
} from '../../services/campaignsApi';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getCampaignProgressMetrics, mergeCampaignMetricsWithReport } from '../../utils/campaignMetrics';
import {
  applyReplyHintsToReportRow,
  applyServerInboundReplyToRow,
  buildReplyHintsFromLogs,
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE,
  campaignLogPayloadMatchesCampaign,
  campaignReportReplyDetailLabel,
  countRepliedFromLogsAndReport,
  effectiveCampaignReportStatus,
  logPayloadPhoneKey,
  sumCampaignGeoStats
} from '../../utils/campaignReportFromLogs';
import { pickBetterCampaignReportRow } from '../../utils/campaignReportDedupe';
import { dedupeCampaignReportRowsByRecipient, recipientKeyForCampaignReport } from '../../utils/campaignReportDedupe';
import { buildPrimaryReportRowsFromLogs } from '../../utils/campaignReportBuilder';
import { enrichCampaignReportRow } from '../../utils/campaignReportRowEnrichment';
import { firstReplyAfterCampaignSend, hasCampaignSendLogForPhone } from '../../utils/campaignReplyScope';
import {
  campaignRunWindowStartMs,
  filterLogsForCampaignView
} from '../../utils/campaignReportScope';
import { buildLegacyEstimateReportRows } from '../../utils/campaignReportBackfill';
import { parseFirestoreDateToIso } from '../../utils/followUp';
import * as XLSX from 'xlsx';
import { Badge, Button, Card, Input, Modal, Tabs } from '../ui';
import { CampaignDispatchLogs } from './CampaignDispatchLogs';
import { PerformanceFunnel } from '../PerformanceFunnel';
import { CampaignScoreCard } from './CampaignScoreCard';
import {
  aggregateFunnelFromReportRows,
  clampCampaignFunnelMetrics,
  funnelPct
} from '../../utils/campaignFunnelMetrics';
import { CampaignDetailInsights } from './CampaignDetailInsights';
import { CampaignMessagePreview } from './CampaignMessagePreview';
import { CampaignChipsPodium } from './CampaignChipsPodium';
import { CampaignStageRepliesCell } from './CampaignStageRepliesCell';
import { ReplyFlowStageFunnels } from './ReplyFlowStageFunnels';
import { CampaignMultiStepDashboard } from './CampaignMultiStepDashboard';
import {
  buildReplyFlowStageFunnels,
  isReplyFlowCampaign,
  primaryFunnelFromReplyFlowStages
} from '../../utils/campaignReplyFlowStageMetrics';
import { buildStageRepliesByPhone, type StageReplyEntry } from '../../utils/campaignStageRepliesFromLogs';

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
  /** Fluxo por resposta: uma entrada por etapa respondida. */
  stageReplies?: StageReplyEntry[];
  conversationId?: string;
  connectionId?: string;
  sentMessage?: string;
  profilePicUrl?: string;
  /** Linha reconstruída a partir de contadores/lista (sem log por destinatário). */
  legacyEstimate?: boolean;
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
  const target = recipientKeyForCampaignReport(phone);
  if (!target) return '';
  for (const c of contacts) {
    if (recipientKeyForCampaignReport(c.phone) === target) return c.name;
  }
  return '';
};

const findCampaignMessage = (
  phone: string,
  campaignId: string,
  allowedConnectionIds: string[],
  conversations: Conversation[]
): { conv: Conversation; msg: ChatMessage; reply: ChatMessage | null } | null => {
  const target = recipientKeyForCampaignReport(phone);
  if (!target) return null;

  const matches = conversations.filter((conv) => {
    if (allowedConnectionIds.length > 0 && !allowedConnectionIds.includes(conv.connectionId)) return false;
    if (recipientKeyForCampaignReport(conv.contactPhone || '') === target) return true;
    const jidPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
    return recipientKeyForCampaignReport(jidPart.split('@')[0] || '') === target;
  });
  if (matches.length === 0) return null;

  const pickLatest = (list: ChatMessage[]) =>
    list.slice().sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0))[0] ?? null;

  let campaignMsg: ChatMessage | null = null;
  let campaignConv: Conversation | null = null;
  for (const conv of matches) {
    const list = (conv.messages || []).filter(
      (m) => m.sender === 'me' && m.fromCampaign && m.campaignId === campaignId
    );
    if (list.length === 0) continue;
    const msg = pickLatest(list);
    if (msg) {
      campaignMsg = msg;
      campaignConv = conv;
      break;
    }
  }

  if (!campaignMsg || !campaignConv) return null;

  const sendTs = campaignMsg.timestampMs ?? 0;
  const reply = firstReplyAfterCampaignSend(campaignConv.messages, sendTs);

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
    const ordered = msgs.slice().sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
    const sent = ordered[0];
    const sentTs = sent.timestampMs ?? 0;
    const reply = firstReplyAfterCampaignSend(conv.messages, sentTs);

    let status: ReportStatus = 'SENT';
    if (reply) status = 'REPLIED';
    else if (sent.status === 'read') status = 'READ';
    else if (sent.status === 'delivered') status = 'DELIVERED';

    const phone = recipientKeyForCampaignReport(conv.contactPhone || '');
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
  const conversations = useZapMassConversations();
  const { contacts, contactLists, campaignGeo, startCampaign } = useZapMassCore();
  const { user } = useAuth();
  // Para membros de equipa, user.uid != effectiveWorkspaceUid. Os logs sao
  // persistidos no path do workspace, entao precisamos usar o uid efetivo
  // — antes a query lia de users/{user.uid}/campaigns/.../logs e voltava
  // vazio, dando relatorio incompleto.
  const { effectiveWorkspaceUid } = useWorkspace();
  const dataUid = effectiveWorkspaceUid ?? user?.uid ?? null;
  const [persistedLogs, setPersistedLogs] = useState<SystemLog[]>([]);
  const [serverSnapshot, setServerSnapshot] = useState<CampaignReportSnapshotDto | null>(
    () => campaign.reportSnapshot ?? null
  );
  const [serverInboundReplies, setServerInboundReplies] = useState<
    Record<string, CampaignInboundReplyDto>
  >({});
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsLoadingMore, setLogsLoadingMore] = useState(false);
  const LOGS_PAGE = 200;

  const mapVpsLogs = (rows: CampaignLogDto[]): SystemLog[] =>
    rows.map((d) => {
      const lvl = String(d.level || 'info').toLowerCase();
      const event =
        lvl === 'error' ? 'campaign:error' : lvl === 'warn' ? 'campaign:warn' : 'campaign:info';
      return {
        timestamp: d.createdAt,
        event,
        payload: {
          message: d.message || '',
          campaignId: campaign.id,
          to: d.to,
          phoneDigits: d.phoneDigits,
          replyPreview: d.replyPreview,
          replyFlowStep: d.replyFlowStep,
          currentStep: d.currentStep,
          connectionId: d.connectionId,
          error: d.error
        }
      };
    });

  const reloadServerReport = useCallback(async () => {
    if (!campaign.id) return;
    const snap = await fetchCampaignReport(campaign.id);
    if (snap) setServerSnapshot(snap);
  }, [campaign.id]);

  const reloadPersistedLogs = useCallback(async () => {
    if (!dataUid) {
      setPersistedLogs([]);
      return;
    }
    const { logs, hasMore } = await fetchCampaignLogs(campaign.id, { limit: LOGS_PAGE, offset: 0 });
    setPersistedLogs(mapVpsLogs(logs));
    setLogsHasMore(hasMore);
  }, [dataUid, campaign.id]);

  useEffect(() => {
    if (!dataUid) {
      setPersistedLogs([]);
      setServerSnapshot(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      reloadPersistedLogs(),
      reloadServerReport().catch(() => null)
    ]).catch((err) => {
      if (cancelled) return;
      setPersistedLogs([]);
      toast.error('Nao foi possivel carregar logs persistidos da campanha.');
      if (import.meta.env.DEV) console.warn('[CampaignDetails] logs load error:', err);
    });
    return () => {
      cancelled = true;
    };
  }, [dataUid, reloadPersistedLogs, reloadServerReport]);

  useEffect(() => {
    if (campaign.status !== CampaignStatus.COMPLETED) return;
    reloadServerReport().catch(() => {});
  }, [campaign.status, campaign.id, reloadServerReport, persistedLogs.length]);

  /** Após concluir, logs de resposta/ACK podem chegar depois — recarrega do servidor. */
  useEffect(() => {
    if (campaign.status !== CampaignStatus.COMPLETED) return;
    const delays = [2500, 8000, 20000, 45000];
    const timers = delays.map((ms) =>
      setTimeout(() => {
        reloadPersistedLogs().catch(() => {});
        reloadServerReport().catch(() => {});
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [campaign.status, campaign.id, reloadPersistedLogs, reloadServerReport]);

  const loadMoreLogs = async () => {
    if (!dataUid || logsLoadingMore || !logsHasMore) return;
    setLogsLoadingMore(true);
    try {
      const offset = persistedLogs.length;
      const { logs, hasMore } = await fetchCampaignLogs(campaign.id, {
        limit: LOGS_PAGE,
        offset
      });
      setPersistedLogs((prev) => [...prev, ...mapVpsLogs(logs)]);
      setLogsHasMore(hasMore);
    } catch {
      toast.error('Falha ao carregar mais logs.');
    } finally {
      setLogsLoadingMore(false);
    }
  };

  const logsForReport = useMemo(() => {
    const cid = campaign.id;
    const belongsToCampaign = (l: SystemLog) => {
      if (!l.payload || typeof l.payload !== 'object') return false;
      return String((l.payload as { campaignId?: string }).campaignId || '') === cid;
    };
    const dedupeKey = (l: SystemLog) => {
      const p = (l.payload || {}) as { to?: string; phoneDigits?: string; message?: string };
      return `${(l.timestamp || '').slice(0, 23)}|${logPayloadPhoneKey(p)}|${p.message || ''}|${l.event}`;
    };
    const seen = new Set<string>();
    const out: SystemLog[] = [];
    const withCampaignPayload = (l: SystemLog): SystemLog => {
      const p = (l.payload && typeof l.payload === 'object' ? l.payload : {}) as Record<string, unknown>;
      return {
        ...l,
        payload: {
          ...p,
          campaignId: String(p.campaignId || cid),
          message: String(p.message || '')
        }
      };
    };
    for (const l of systemLogs) {
      if (!belongsToCampaign(l)) continue;
      const k = dedupeKey(l);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(withCampaignPayload(l));
    }
    for (const l of persistedLogs) {
      const k = dedupeKey(l);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(withCampaignPayload(l));
    }
    return out;
  }, [systemLogs, persistedLogs, campaign.id]);

  const campaignIsDone = campaign.status === CampaignStatus.COMPLETED;

  const scopedCampaignLogs = useMemo(
    () =>
      filterLogsForCampaignView(
        logsForReport,
        campaign.id,
        campaignIsDone ? 0 : campaignRunWindowStartMs(campaign)
      ),
    [logsForReport, campaign.id, campaign.createdAt, campaign.lastRunAt, campaignIsDone]
  );

  const serverReplyHints = useMemo(() => {
    const m = new Map<
      string,
      { phone: string; replyTimestampMs: number; replyText?: string; connectionId?: string }
    >();
    if (!serverSnapshot?.replyPhones) return m;
    for (const [rk, v] of Object.entries(serverSnapshot.replyPhones)) {
      m.set(rk, {
        phone: rk,
        replyTimestampMs: v.replyTimestampMs,
        replyText: v.replyText
      });
    }
    return m;
  }, [serverSnapshot]);

  const replyPhonesFromLogs = useMemo(() => {
    const fromLogs = buildReplyHintsFromLogs(scopedCampaignLogs, campaign.id);
    if (serverReplyHints.size === 0) return fromLogs;
    const merged = new Map(fromLogs);
    for (const [k, v] of serverReplyHints) {
      const prev = merged.get(k);
      if (!prev || v.replyTimestampMs >= prev.replyTimestampMs) merged.set(k, v);
    }
    return merged;
  }, [scopedCampaignLogs, campaign.id, serverReplyHints]);

  useEffect(() => {
    if (!campaign.id) {
      setServerInboundReplies({});
      return;
    }
    let cancelled = false;
    fetchCampaignInboundReplies(campaign.id)
      .then((replies) => {
        if (!cancelled) setServerInboundReplies(replies);
      })
      .catch(() => {
        if (!cancelled) setServerInboundReplies({});
      });
    return () => {
      cancelled = true;
    };
  }, [campaign.id, logsForReport.length, persistedLogs.length, conversations.length]);

  const reportSectionRef = useRef<HTMLDivElement>(null);
  const [detailFilter, setDetailFilter] = useState<ReportFilter>('ALL');
  const [detailSearch, setDetailSearch] = useState('');
  const [showLogModal, setShowLogModal] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>('ALL');
  const [now, setNow] = useState(Date.now());
  const [openRow, setOpenRow] = useState<ReportRow | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showRetryBanner, setShowRetryBanner] = useState(false);

  const isRunning = campaign.status === CampaignStatus.RUNNING;
  const isPaused = campaign.status === CampaignStatus.PAUSED;
  const isDone = campaign.status === CampaignStatus.COMPLETED;
  const isScheduled = campaign.status === CampaignStatus.SCHEDULED;
  // Fluxo por resposta aguardando: campanha ativa (ou presa em DRAFT com envios já feitos)
  // com pelo menos 1 mensagem enviada e ainda aguardando respostas para avançar às próximas etapas.
  const isWaitingForReplies =
    Boolean(campaign.replyFlow?.enabled) &&
    !isDone &&
    !isScheduled &&
    (isRunning || isPaused ||
      (campaign.status === CampaignStatus.DRAFT && (campaign.processedCount ?? 0) > 0));

  /** Campanha concluída ou aguardando respostas: sincroniza logs persistidos com ACK/respostas tardias. */
  useEffect(() => {
    if (!isDone && !isWaitingForReplies) return;
    const id = setInterval(() => {
      reloadPersistedLogs().catch(() => {});
      reloadServerReport().catch(() => {});
    }, 12_000);
    return () => clearInterval(id);
  }, [isDone, isWaitingForReplies, reloadPersistedLogs, reloadServerReport]);

  useEffect(() => {
    if (!isRunning) return;
    // Atualiza a cada 1s para contador vivo de ETA e tempo decorrido.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const m = useMemo(() => getCampaignProgressMetrics(campaign), [campaign]);

  const statusVariant: 'success' | 'warning' | 'info' | 'neutral' = isRunning
    ? 'success'
    : isPaused
    ? 'warning'
    : isScheduled
    ? 'info'
    : isDone
    ? 'info'
    : isWaitingForReplies
    ? 'warning'
    : 'neutral';
  const accent = isRunning
    ? 'var(--brand-500)'
    : isPaused
    ? '#f59e0b'
    : isScheduled
    ? '#6366f1'
    : isDone
    ? '#3b82f6'
    : isWaitingForReplies
    ? '#f59e0b'
    : 'var(--text-3)';
  const accentHex = isRunning
    ? '#10b981'
    : isPaused
    ? '#f59e0b'
    : isScheduled
    ? '#6366f1'
    : isDone
    ? '#3b82f6'
    : isWaitingForReplies
    ? '#f59e0b'
    : '#94a3b8';

  const startedAt = useMemo(() => {
    const d = new Date(campaign.createdAt);
    return isNaN(d.getTime()) ? null : d;
  }, [campaign.createdAt]);

  // Pendente "real-time": fila viva no backend (queueSize por chip selecionado).
  const pendingLive = useMemo(() => {
    const selected = new Set(campaign.selectedConnectionIds ?? []);
    if (selected.size === 0) return 0;
    return connections
      .filter((conn) => selected.has(conn.id))
      .reduce((acc, conn) => acc + Math.max(0, Number(conn.queueSize) || 0), 0);
  }, [campaign.selectedConnectionIds, connections]);

  const replyFlowStepCount =
    campaign.replyFlow?.enabled && (campaign.replyFlow.steps?.length ?? 0) > 0
      ? campaign.replyFlow.steps!.length
      : 0;

  const stageRepliesByPhone = useMemo(() => {
    if (replyFlowStepCount < 1) return new Map<string, StageReplyEntry[]>();
    return buildStageRepliesByPhone(campaign.id, replyFlowStepCount, scopedCampaignLogs);
  }, [campaign.id, replyFlowStepCount, scopedCampaignLogs]);

  const attachStageReplies = (row: ReportRow): ReportRow => {
    const rk = recipientKeyForCampaignReport(row.phone);
    const stageReplies = rk ? stageRepliesByPhone.get(rk) : undefined;
    if (!stageReplies?.length) return row;
    const last = stageReplies[stageReplies.length - 1];
    return {
      ...row,
      stageReplies,
      replyText: row.replyText || last.replyText,
      replyTime: row.replyTime || last.replyTime,
      replyTimestampMs: row.replyTimestampMs || last.replyTimestampMs
    };
  };

  // Detailed report — VPS: snapshot persistido; ao vivo: logs + conversas
  const detailedReport = useMemo<ReportRow[]>(() => {
    const allowedConns = campaign.selectedConnectionIds || [];
    const scopedLogs = scopedCampaignLogs;
    const replyHints = replyPhonesFromLogs;

    if (serverSnapshot?.rows?.length) {
      return dedupeCampaignReportRowsByRecipient(
        serverSnapshot.rows.map((r) => {
          const rk = recipientKeyForCampaignReport(r.phone);
          const hint = replyHints.get(rk);
          let row: ReportRow = {
            id: `snap-${rk}`,
            phone: r.phone,
            contactName:
              r.contactName ||
              findContactName(r.phone, contacts) ||
              `+${r.phone}`,
            status: effectiveCampaignReportStatus(
              { phone: r.phone, status: r.status },
              replyHints
            ) as ReportStatus,
            sentTime: r.sentTime,
            sentTimestampMs: r.sentTimestampMs,
            replyText: r.replyText || hint?.replyText,
            replyTime: r.replyTime,
            replyTimestampMs: r.replyTimestampMs || hint?.replyTimestampMs,
            connectionId: r.connectionId || hint?.connectionId,
            errorMessage: r.errorMessage
          };
          row = applyReplyHintsToReportRow(row, hint) as ReportRow;
          row = applyServerInboundReplyToRow(row, serverInboundReplies[rk]);
          const found = findCampaignMessage(r.phone, campaign.id, allowedConns, conversations);
          if (found) {
            row = {
              ...row,
              conversationId: found.conv.id,
              profilePicUrl: found.conv.profilePicUrl,
              sentMessage: found.msg.text || row.sentMessage
            };
          }
          return attachStageReplies(row);
        })
      );
    }

    const primary = buildPrimaryReportRowsFromLogs(
      scopedLogs,
      campaign.id,
      contacts,
      campaign,
      contactLists
    );

    if (primary.length === 0) {
      const legacy = buildLegacyEstimateReportRows({ campaign, contacts, contactLists });
      if (!legacy?.length) return [];
      return dedupeCampaignReportRowsByRecipient(
        legacy.map((r) => ({
          id: r.id,
          phone: r.phone,
          contactName: r.contactName,
          status: r.status,
          sentTime: r.sentTime,
          sentTimestampMs: r.sentTimestampMs,
          errorMessage: r.errorMessage,
          legacyEstimate: true
        }))
      );
    }

    const mergedByPhone = new Map<string, ReportRow>();
    for (const row of primary) {
      mergedByPhone.set(recipientKeyForCampaignReport(row.phone), row as ReportRow);
    }

    for (const convRow of buildRowsFromConversations(campaign, contacts, conversations)) {
      const rk = recipientKeyForCampaignReport(convRow.phone);
      const existing = mergedByPhone.get(rk);
      if (!existing) {
        mergedByPhone.set(rk, applyReplyHintsToReportRow(convRow, replyHints.get(rk)));
        continue;
      }
      mergedByPhone.set(rk, pickBetterCampaignReportRow(existing, convRow));
    }

    const enriched = Array.from(mergedByPhone.values()).map((row) => {
      const rk = recipientKeyForCampaignReport(row.phone);
      let out = enrichCampaignReportRow(row, {
        campaignId: campaign.id,
        replyHint: replyHints.get(rk),
        scopedLogs,
        conversations,
        allowedConnectionIds: allowedConns
      }) as ReportRow;
      out = applyReplyHintsToReportRow(out, replyHints.get(rk)) as ReportRow;
      out = applyServerInboundReplyToRow(out, serverInboundReplies[rk]);
      const found = findCampaignMessage(row.phone, campaign.id, allowedConns, conversations);
      if (found) {
        out = {
          ...out,
          conversationId: found.conv.id,
          profilePicUrl: found.conv.profilePicUrl,
          sentMessage: found.msg.text || out.sentMessage
        };
      }
      return attachStageReplies(out);
    });

    return dedupeCampaignReportRowsByRecipient(enriched).sort(
      (a, b) => b.sentTimestampMs - a.sentTimestampMs
    );
  }, [
    scopedCampaignLogs,
    campaign,
    contacts,
    contactLists,
    campaign.selectedConnectionIds,
    conversations,
    serverInboundReplies,
    serverSnapshot,
    replyPhonesFromLogs,
    stageRepliesByPhone
  ]);

  const filteredReport = useMemo(() => {
    const term = detailSearch.trim().toLowerCase();
    return detailedReport.filter((item) => {
      const matchesSearch =
        !term ||
        item.phone.includes(term) ||
        item.contactName.toLowerCase().includes(term) ||
        (item.replyText || '').toLowerCase().includes(term);

      const rowStatus = effectiveCampaignReportStatus(item, replyPhonesFromLogs) as ReportStatus;
      let matchesFilter = true;
      if (detailFilter !== 'ALL') {
        if (detailFilter === 'SENT_GROUP') {
          matchesFilter = ['SENT', 'DELIVERED', 'READ', 'REPLIED'].includes(rowStatus);
        } else {
          matchesFilter = rowStatus === detailFilter;
        }
      }
      return matchesSearch && matchesFilter;
    });
  }, [detailedReport, detailFilter, detailSearch, replyPhonesFromLogs]);

  const hasLegacyEstimateRows = useMemo(
    () => detailedReport.some((r) => r.legacyEstimate),
    [detailedReport]
  );

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
      const rk = recipientKeyForCampaignReport(r.phone);
      const effectiveStatus = effectiveCampaignReportStatus(r, replyPhonesFromLogs);
      counts[effectiveStatus]++;
      if (r.connectionId) {
        const cur = perChip.get(r.connectionId) || { sent: 0, replied: 0 };
        cur.sent++;
        if (effectiveStatus === 'REPLIED') cur.replied++;
        perChip.set(r.connectionId, cur);
        if (r.status === 'FAILED') {
          failedPerChip.set(r.connectionId, (failedPerChip.get(r.connectionId) || 0) + 1);
        }
      }
      if (effectiveStatus === 'REPLIED' && r.replyTimestampMs && r.sentTimestampMs) {
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
  }, [detailedReport, connections, replyPhonesFromLogs]);

  const metrics = useMemo(
    () =>
      mergeCampaignMetricsWithReport(m, {
        totalRows: performance.total,
        failedCount: performance.counts.FAILED
      }),
    [m, performance]
  );

  const campaignGeoTotals = useMemo(() => {
    if (campaignGeo.campaignId !== campaign.id) {
      return { delivered: 0, read: 0, replied: 0 };
    }
    return sumCampaignGeoStats(campaignGeo.byUf);
  }, [campaignGeo, campaign.id]);

  const replyFlowStages = useMemo(() => {
    if (!isReplyFlowCampaign(campaign)) return [];
    const stageLogs = scopedCampaignLogs.map((l) => ({
      timestamp: l.timestamp,
      payload: l.payload
    }));
    return buildReplyFlowStageFunnels(campaign.id, campaign, stageLogs, replyPhonesFromLogs);
  }, [campaign, scopedCampaignLogs, replyPhonesFromLogs]);

  const useReplyFlowPrimaryFunnel = replyFlowStages.length > 0;

  /** Funil e score: relatório + geo da campanha (não infla entregues só com successCount). */
  const uiPerformanceBase = useMemo(() => {
    const base =
      performance.total > 0
        ? performance
        : (() => {
            const sent = Math.max(
              0,
              metrics.effectiveProcessed,
              (campaign.successCount || 0) + (campaign.failedCount || 0)
            );
            if (sent <= 0) return performance;
            const failCount = Math.max(metrics.fail, performance.counts.FAILED);
            const delivered = Math.min(sent, Math.max(0, metrics.ok));
            const total = sent;
            const successPct = total > 0 ? Math.round(((total - failCount) / total) * 100) : 0;
            const deliveryPct = total > 0 ? Math.round((delivered / total) * 100) : 0;
            const counts: Record<ReportStatus, number> = {
              PENDING: 0,
              FAILED: failCount,
              SENT: Math.max(0, total - failCount - delivered),
              DELIVERED: delivered,
              READ: 0,
              REPLIED: 0
            };
            return {
              ...performance,
              total,
              counts,
              delivered,
              read: 0,
              replied: 0,
              successPct,
              deliveryPct,
              readPct: 0,
              replyPct: 0
            };
          })();

    const total = Math.max(base.total, metrics.effectiveProcessed);
    const geoDelivered = Math.max(
      campaignGeoTotals.delivered,
      campaignGeoTotals.read,
      campaignGeoTotals.replied
    );
    const geoRead = Math.max(campaignGeoTotals.read, campaignGeoTotals.replied);
    const geoReplied = campaignGeoTotals.replied;
    const delivered =
      base.total > 0
        ? Math.max(base.delivered, geoDelivered)
        : Math.max(base.delivered, Math.min(total, Math.max(0, metrics.ok)), geoDelivered);
    const read = Math.max(base.read, geoRead);
    const replied = Math.max(
      base.replied,
      geoReplied,
      countRepliedFromLogsAndReport(detailedReport, replyPhonesFromLogs)
    );
    if (
      delivered === base.delivered &&
      read === base.read &&
      replied === base.replied &&
      total === base.total
    ) {
      return base;
    }

    const clamped = clampCampaignFunnelMetrics(total, delivered, read, replied);
    const deliveryPct = clamped.sent > 0 ? Math.round((clamped.delivered / clamped.sent) * 100) : 0;
    const readPct = clamped.sent > 0 ? Math.round((clamped.read / clamped.sent) * 100) : 0;
    const replyPct = clamped.sent > 0 ? Math.round((clamped.replied / clamped.sent) * 100) : 0;

    return {
      ...base,
      total: clamped.sent,
      delivered: clamped.delivered,
      read: clamped.read,
      replied: clamped.replied,
      deliveryPct,
      readPct,
      replyPct,
      counts: {
        ...base.counts,
        DELIVERED: clamped.delivered,
        READ: clamped.read,
        REPLIED: clamped.replied
      }
    };
  }, [
    performance,
    metrics,
    campaign.successCount,
    campaign.failedCount,
    campaignGeoTotals,
    detailedReport,
    replyPhonesFromLogs
  ]);

  /** Fluxo por resposta: funil principal por contato (etapa 1), não por total de envios na fila. */
  const uiPerformance = useMemo(() => {
    if (!useReplyFlowPrimaryFunnel) return uiPerformanceBase;
    const fromReport = aggregateFunnelFromReportRows(
      detailedReport.map((r) => ({
        status: effectiveCampaignReportStatus(r, replyPhonesFromLogs)
      }))
    );
    const primary = primaryFunnelFromReplyFlowStages(replyFlowStages);
    const uniqueRecipients = new Set(
      detailedReport
        .map((r) => recipientKeyForCampaignReport(r.phone))
        .filter((k) => Boolean(k))
    );
    const contactTotal = Math.max(
      campaign.totalContacts || 0,
      uniqueRecipients.size,
      primary.sent,
      fromReport.sent
    );
    const repliedContacts = countRepliedFromLogsAndReport(detailedReport, replyPhonesFromLogs);
    const clamped = clampCampaignFunnelMetrics(
      contactTotal,
      Math.max(fromReport.delivered, primary.delivered, campaignGeoTotals.delivered),
      Math.max(fromReport.read, primary.read, campaignGeoTotals.read),
      Math.max(
        fromReport.replied,
        primary.replied,
        campaignGeoTotals.replied,
        performance.replied,
        repliedContacts
      )
    );
    return {
      ...uiPerformanceBase,
      total: clamped.sent,
      delivered: clamped.delivered,
      read: clamped.read,
      replied: clamped.replied,
      deliveryPct: funnelPct(clamped.delivered, clamped.sent),
      readPct: funnelPct(clamped.read, clamped.sent),
      replyPct: funnelPct(clamped.replied, clamped.sent),
      successPct:
        clamped.sent > 0
          ? Math.round(((clamped.sent - uiPerformanceBase.counts.FAILED) / clamped.sent) * 100)
          : uiPerformanceBase.successPct,
      counts: {
        ...uiPerformanceBase.counts,
        DELIVERED: clamped.delivered,
        READ: clamped.read,
        REPLIED: clamped.replied
      }
    };
  }, [
    uiPerformanceBase,
    useReplyFlowPrimaryFunnel,
    replyFlowStages,
    campaignGeoTotals,
    campaign.totalContacts,
    detailedReport,
    replyPhonesFromLogs,
    performance.replied
  ]);

  const progress = metrics.progressPct;
  const successRate = metrics.successRatePct;
  const failureRate =
    metrics.effectiveProcessed > 0 ? Math.round((metrics.fail / metrics.effectiveProcessed) * 100) : 0;
  const startedFmt = formatDateTimeBR(campaign.createdAt);
  const elapsedSec = startedAt ? Math.max(0, (now - startedAt.getTime()) / 1000) : 0;
  const throughputPerMin = elapsedSec > 0 ? +(metrics.effectiveProcessed / (elapsedSec / 60)).toFixed(1) : 0;
  const remaining = metrics.pending;
  const pendingKpi = isDone ? 0 : isRunning ? Math.max(remaining, pendingLive) : remaining;
  const etaSec = throughputPerMin > 0 ? (remaining / throughputPerMin) * 60 : 0;

  const campaignLogs = useMemo(() => scopedCampaignLogs as SystemLog[], [scopedCampaignLogs]);

  /** Mostra o banner de reenvio quando a campanha conclui com falhas. */
  useEffect(() => {
    if (isDone && performance.counts.FAILED > 0) {
      setShowRetryBanner(true);
    }
  }, [isDone, performance.counts.FAILED]);

  const handleRetryFailed = useCallback(async () => {
    const failedRows = detailedReport.filter(
      (r) => effectiveCampaignReportStatus(r, replyPhonesFromLogs) === 'FAILED'
    );
    if (failedRows.length === 0) {
      toast.error('Nenhum contato com falha encontrado.');
      return;
    }
    const connId = (campaign.selectedConnectionIds || [])[0];
    if (!connId) {
      toast.error('Nenhum chip configurado nesta campanha.');
      return;
    }
    const failedPhones = failedRows.map((r) => r.phone);
    setRetrying(true);
    try {
      await startCampaign(
        connId,
        failedPhones,
        campaign.message,
        campaign.selectedConnectionIds || [],
        undefined,
        `${campaign.name} — Reenvio (${failedPhones.length})`,
        {
          messageStages: campaign.messageStages,
          replyFlow: campaign.replyFlow,
          delaySeconds: campaign.delaySeconds,
          channelWeights: campaign.channelWeights
        }
      );
      toast.success(`Reenvio iniciado para ${failedPhones.length} contato(s).`);
      setShowRetryBanner(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao iniciar reenvio.';
      toast.error(msg);
    } finally {
      setRetrying(false);
    }
  }, [detailedReport, campaign, replyPhonesFromLogs, startCampaign]);

  const handleFilterClick = (filter: ReportFilter) => {
    setDetailFilter(filter);
    reportSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const channelLabelForExport = (id?: string) => {
    if (!id) return '';
    const c = connections.find((x) => x.id === id);
    const label = c?.name || id.slice(0, 14);
    return label.replace(/[;\n\r]+/g, ' ');
  };

  const exportReportCsv = () => {
    if (filteredReport.length === 0) {
      toast.error('Nenhum registro para exportar.');
      return;
    }
    const header =
      'nome;telefone;status;enviado_em;respondido_em;resposta;erro;mensagem_enviada;canal\n';
    const body = filteredReport
      .map((r) => {
        const status = STATUS_META[r.status].label;
        const safe = (s: string | undefined) => (s || '').replace(/[;\n\r]+/g, ' ');
        return `${safe(r.contactName)};${r.phone};${status};${r.sentTime};${r.replyTime || ''};${safe(r.replyText)};${safe(
          r.errorMessage
        )};${safe(r.sentMessage)};${channelLabelForExport(r.connectionId)}`;
      })
      .join('\n');
    const blob = new Blob(['\uFEFF' + header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-${campaign.name.replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`Ficheiro gerado (${filteredReport.length} linhas) — UTF-8 para Excel.`);
  };

  const exportReportXlsx = () => {
    if (filteredReport.length === 0) {
      toast.error('Nenhum registro para exportar.');
      return;
    }
    const header = [
      'Nome',
      'Telefone',
      'Status',
      'Enviado em',
      'Respondido em',
      'Resposta',
      'Erro',
      'Mensagem enviada',
      'Canal'
    ];
    const rows = filteredReport.map((r) => [
      r.contactName,
      r.phone,
      STATUS_META[r.status].label,
      r.sentTime,
      r.replyTime || '',
      r.replyText || '',
      r.errorMessage || '',
      r.sentMessage || '',
      channelLabelForExport(r.connectionId)
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
    const safe =
      campaign.name.replace(/\W+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'campanha';
    XLSX.writeFile(wb, `relatorio-${safe}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Planilha XLSX com ${filteredReport.length} linhas.`);
  };

  const exportReportJson = () => {
    if (filteredReport.length === 0) {
      toast.error('Nenhum registro para exportar.');
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      filter: detailFilter,
      search: detailSearch || undefined,
      rows: filteredReport.map((r) => ({
        phone: r.phone,
        contactName: r.contactName,
        status: r.status,
        statusLabel: STATUS_META[r.status].label,
        sentTime: r.sentTime,
        sentTimestampMs: r.sentTimestampMs,
        replyTime: r.replyTime,
        replyTimestampMs: r.replyTimestampMs,
        replyText: r.replyText,
        errorMessage: r.errorMessage,
        sentMessage: r.sentMessage,
        connectionId: r.connectionId,
        channelLabel: channelLabelForExport(r.connectionId)
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-${campaign.name.replace(/\W+/g, '-')}-${campaign.id.slice(0, 8)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`JSON com ${filteredReport.length} linhas.`);
  };

  const printReportForPdf = () => {
    if (filteredReport.length === 0) {
      toast.error('Nada para imprimir com o filtro atual.');
      return;
    }
    const esc = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const rows = filteredReport
      .map(
        (r) => `<tr>
      <td>${esc(r.contactName)}</td>
      <td>${esc(r.phone)}</td>
      <td>${esc(STATUS_META[r.status].label)}</td>
      <td>${esc(r.sentTime)}</td>
      <td>${esc(r.replyTime || '')}</td>
      <td>${esc((r.replyText || '').slice(0, 280))}</td>
    </tr>`
      )
      .join('');
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(campaign.name)}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;padding:20px;color:#111}
  h1{font-size:20px;margin:0 0 8px}
  .meta{color:#555;font-size:12px;margin-bottom:20px}
  table{border-collapse:collapse;width:100%;font-size:11px}
  th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}
  th{background:#f3f4f6;font-weight:600}
  @media print { body { padding: 12px } }
</style></head><body>
<h1>${esc(campaign.name)}</h1>
<div class="meta">ZapMass · ${esc(new Date().toLocaleString('pt-BR'))} · ${filteredReport.length} linhas · Filtro: ${esc(detailFilter)}</div>
<table>
<thead><tr><th>Nome</th><th>Telefone</th><th>Status</th><th>Enviado</th><th>Resposta em</th><th>Resposta</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<script>window.onload=function(){window.focus();window.print();}</script>
</body></html>`;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      toast.error('Permita pop-ups para abrir a impressão ou PDF.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
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
      `Status: ${
        isRunning ? 'Em execução' : isPaused ? 'Pausada' : isScheduled ? 'Agendada' : isDone ? 'Concluída' : 'Pendente'
      }`,
      `Total: ${campaign.totalContacts || 0} contatos`,
      `Entregues: ${metrics.ok} (${successRate}%)`,
      `Respostas: ${uiPerformance.replied} (${uiPerformance.replyPct}%)`,
      `Falhas: ${metrics.fail}`,
      startedAt ? `Iniciada em: ${startedFmt.date} ${startedFmt.time}` : ''
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines).then(
      () => toast.success('Resumo copiado para compartilhar.'),
      () => toast.error('Falha ao copiar.')
    );
  };

  const onlineChips = (campaign.selectedConnectionIds || []).filter((id) => {
    const c = connections.find((x) => x.id === id);
    return c?.status === ConnectionStatus.CONNECTED;
  }).length;

  // Donut geometry (hero)
  const donutSize = 200;
  const donutStroke = 18;
  const donutR = (donutSize - donutStroke) / 2;
  const donutC = 2 * Math.PI * donutR;
  const successArc = (metrics.ok / Math.max(1, metrics.plannedSendTotal)) * donutC;
  const failArc = (metrics.fail / Math.max(1, metrics.plannedSendTotal)) * donutC;

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
              {!isDone && !isScheduled && !isWaitingForReplies && (
                <Button
                  variant={isRunning ? 'secondary' : 'primary'}
                  size="sm"
                  leftIcon={isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  onClick={() => onTogglePause(campaign.id)}
                >
                  {isRunning ? 'Pausar' : 'Retomar'}
                </Button>
              )}
              {isWaitingForReplies && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Play className="w-4 h-4" />}
                  onClick={() => onTogglePause(campaign.id)}
                  title="Sincronizar status — confirma a campanha como ativa e aguardando respostas"
                >
                  Sincronizar status
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
                title="Arquivo CSV com UTF-8 (abre no Excel). Inclui mensagem e canal."
              >
                CSV / Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FileSpreadsheet className="w-4 h-4" />}
                onClick={exportReportXlsx}
                title="Planilha .xlsx (Excel / LibreOffice)"
              >
                XLSX
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FileJson className="w-4 h-4" />}
                onClick={exportReportJson}
                title="Exportar JSON (automação / backup estruturado)"
              >
                JSON
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Printer className="w-4 h-4" />}
                onClick={printReportForPdf}
                title="Abre janela para imprimir ou guardar como PDF"
              >
                Imprimir / PDF
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
                <Badge variant={statusVariant} dot={isRunning || isWaitingForReplies}>
                  {isRunning
                    ? 'Em execução'
                    : isPaused
                    ? 'Pausada'
                    : isScheduled
                    ? 'Agendada'
                    : isDone
                    ? 'Concluída'
                    : isWaitingForReplies
                    ? 'Aguardando respostas'
                    : 'Pendente'}
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
                  <span style={{ color: 'var(--text-2)' }}>{(campaign.totalContacts || 0).toLocaleString('pt-BR')}</span>
                  contatos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />
                  <span style={{ color: onlineChips > 0 ? '#10b981' : 'var(--text-2)' }}>
                    {onlineChips}/{(campaign.selectedConnectionIds || []).length}
                  </span>
                  chip{(campaign.selectedConnectionIds || []).length > 1 ? 's' : ''} online
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
                  value={
                    isRunning && etaSec > 0
                      ? formatDuration(etaSec)
                      : remaining.toLocaleString('pt-BR')
                  }
                  hint={
                    isRunning && etaSec > 0
                      ? `termina ~${new Date(Date.now() + etaSec * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                      : isRunning
                      ? 'calculando…'
                      : remaining > 0
                      ? 'aguardando'
                      : 'concluído'
                  }
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
                  {metrics.fail > 0 && (
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
                    {metrics.effectiveProcessed.toLocaleString('pt-BR')} /{' '}
                    {metrics.plannedSendTotal.toLocaleString('pt-BR')}
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
          value={(useReplyFlowPrimaryFunnel ? uiPerformance.delivered : metrics.ok).toLocaleString('pt-BR')}
          helper={
            useReplyFlowPrimaryFunnel
              ? `${uiPerformance.deliveryPct}% (etapa 1)`
              : `${successRate}% do total`
          }
          color="#10b981"
          onClick={() => handleFilterClick('SENT_GROUP')}
        />
        <KpiPill
          label="Responderam"
          value={uiPerformance.replied.toLocaleString('pt-BR')}
          helper={uiPerformance.replied > 0 ? `${uiPerformance.replyPct}%` : 'sem respostas'}
          color="#8b5cf6"
          onClick={() => handleFilterClick('REPLIED')}
        />
        <KpiPill
          label="Falhas"
          value={metrics.fail.toLocaleString('pt-BR')}
          helper={metrics.fail > 0 ? `${failureRate}%` : 'nenhuma'}
          color="#ef4444"
          onClick={() => handleFilterClick('FAILED')}
        />
        <KpiPill
          label="Pendentes"
          value={pendingKpi.toLocaleString('pt-BR')}
          helper={
            isRunning
              ? `fila ao vivo${etaSec > 0 ? ` · ETA ${formatDuration(etaSec)}` : ''}`
              : pendingKpi > 0
              ? 'fila aguardando'
              : 'sem fila'
          }
          color="#f59e0b"
          onClick={() => handleFilterClick('PENDING')}
        />
      </div>

      {/* ===== BANNER: reenvio de falhas após conclusão ===== */}
      {showRetryBanner && isDone && performance.counts.FAILED > 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-3"
          style={{
            background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.05))',
            border: '1px solid rgba(239,68,68,0.35)'
          }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(239,68,68,0.18)' }}
          >
            <AlertCircle className="w-4 h-4" style={{ color: '#ef4444' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
              {performance.counts.FAILED} envio{performance.counts.FAILED !== 1 ? 's' : ''} falharam nesta campanha
            </p>
            <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Deseja reenviar automaticamente para os contatos com falha? Uma nova campanha será criada com
              os mesmos chips e mensagem.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />}
              onClick={handleRetryFailed}
              disabled={retrying}
            >
              {retrying ? 'Reenviando…' : 'Tentar novamente'}
            </Button>
            <button
              onClick={() => setShowRetryBanner(false)}
              className="p-1.5 rounded-md transition-colors hover:bg-black/10"
              style={{ color: 'var(--text-3)' }}
              title="Dispensar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {campaign.replyFlow?.enabled && (isRunning || isWaitingForReplies) && (campaign.replyFlow.steps?.length || 0) > 1 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-3"
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(16,185,129,0.08))',
            border: '1px solid rgba(245,158,11,0.28)'
          }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(245,158,11,0.18)' }}
          >
            <Reply className="w-4 h-4" style={{ color: '#d97706' }} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
              Fluxo por resposta — aguardando respostas
            </p>
            <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Etapa 1 já foi enviada. A etapa 2 será disparada automaticamente assim que o contato
              responder{campaign.replyFlow.steps?.[0]?.acceptAnyReply
                ? ' (qualquer mensagem serve)'
                : ' com a palavra-chave configurada'}
              . Esta campanha <strong>não precisa de "Retomar"</strong> — ela avança sozinha ao receber a resposta.
              Clique em "Sincronizar status" se o progresso estiver travado na tela.
            </p>
          </div>
        </div>
      )}

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
              {useReplyFlowPrimaryFunnel
                ? 'etapa 1 por contato — etapas seguintes no painel abaixo'
                : 'funil completo com taxas de conversão e benchmarks de mercado'}
            </p>
          </div>
        </div>
        <PerformanceFunnel
          sent={
            useReplyFlowPrimaryFunnel
              ? uiPerformance.total
              : uiPerformance.total || (campaign.successCount || 0) + (campaign.failedCount || 0)
          }
          delivered={uiPerformance.delivered}
          read={uiPerformance.read}
          replied={uiPerformance.replied}
          variant="bars"
        />
        {useReplyFlowPrimaryFunnel && (
          <div className="mt-4">
            <ReplyFlowStageFunnels
              stages={replyFlowStages}
              totalContacts={campaign.totalContacts || replyFlowStages[0]?.sent || 0}
            />
          </div>
        )}
        {/* Dashboard de progresso do motor multi-etapas (quando stageConfigs presente) */}
        {campaign.stageConfigs && campaign.stageConfigs.length > 0 && (
          <CampaignMultiStepDashboard
            campaign={campaign}
            stageLabels={campaign.stageConfigs.map((s) => s.body.slice(0, 60))}
          />
        )}
      </div>

      {/* ============================ SCORE + MESSAGE PREVIEW ============================ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <CampaignScoreCard
            inputs={{
              delivered: uiPerformance.delivered,
              read: uiPerformance.read,
              replied: uiPerformance.replied,
              sent: uiPerformance.total,
              plannedContacts: campaign.totalContacts || metrics.plannedSendTotal || 0,
              throughputPerMin,
              failed: uiPerformance.counts.FAILED,
              replyFlowMode: useReplyFlowPrimaryFunnel
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
          total: uiPerformance.total,
          delivered: uiPerformance.delivered,
          read: uiPerformance.read,
          replied: uiPerformance.replied,
          failed: uiPerformance.counts.FAILED,
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
          selectedConnectionIds={campaign.selectedConnectionIds || []}
          connections={connections}
          chipBreakdown={performance.chipBreakdown}
          failedPerChip={performance.failedPerChip}
        />

        {/* Logs ao vivo */}
        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}
              >
                <Terminal className="w-4 h-4" style={{ color: '#10b981' }} />
              </div>
              <div className="min-w-0">
                <h3 className="ui-title text-[14px]">Logs do disparo</h3>
                <p className="ui-subtitle text-[11.5px] truncate">Eventos em tempo real desta campanha</p>
              </div>
              {isRunning && (
                <Badge variant="success" className="shrink-0">
                  Ao vivo
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowLogModal(true)}>
              Ver todos
            </Button>
          </div>
          <CampaignDispatchLogs
            logs={campaignLogs}
            filter={logFilter}
            onFilterChange={setLogFilter}
            variant="compact"
            isRunning={isRunning}
            maxItems={8}
          />
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
                  {hasLegacyEstimateRows && (
                    <span className="block mb-1.5 text-[11px] leading-snug" style={{ color: '#f59e0b' }}>
                      Parte das linhas foi reconstruída a partir dos contadores da campanha e da lista de contatos
                      (histórico sem logs por destinatário). Telefone e status por linha são estimativas.
                    </span>
                  )}
                  {filteredReport.length} de {detailedReport.length} contato
                  {detailedReport.length === 1 ? '' : 's'} • status em tempo real
                  {logsHasMore && (
                    <button
                      className="ml-2 underline text-[11px]"
                      style={{ color: 'var(--accent)' }}
                      onClick={loadMoreLogs}
                      disabled={logsLoadingMore}
                    >
                      {logsLoadingMore ? 'Carregando…' : `Carregar mais logs`}
                    </button>
                  )}
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
              {performance.counts.FAILED > 0 && (
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />}
                  onClick={handleRetryFailed}
                  disabled={retrying}
                  title={`Reenviar ${performance.counts.FAILED} contato(s) com falha`}
                >
                  {retrying ? 'Reenviando…' : `Reenviar falhas (${performance.counts.FAILED})`}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Download className="w-3.5 h-3.5" />}
                onClick={exportReportCsv}
                title="CSV UTF-8 para Excel"
              >
                CSV / Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                onClick={exportReportXlsx}
                title="XLSX"
              >
                XLSX
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FileJson className="w-3.5 h-3.5" />}
                onClick={exportReportJson}
                title="JSON"
              >
                JSON
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Printer className="w-3.5 h-3.5" />}
                onClick={printReportForPdf}
                title="Imprimir / PDF"
              >
                PDF
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
                    const rk = recipientKeyForCampaignReport(item.phone);
                    const logHint = replyPhonesFromLogs.get(rk);
                    const displayStatus = effectiveCampaignReportStatus(
                      item,
                      replyPhonesFromLogs
                    ) as ReportStatus;
                    const meta = STATUS_META[displayStatus];
                    const nameForInitials = (item.contactName || '').trim();
                    const initials =
                      nameForInitials &&
                      !/^\+?\d[\d\s]*$/.test(nameForInitials) &&
                      nameForInitials !== `+${item.phone}`
                        ? nameForInitials
                            .replace(/^\+/, '')
                            .split(/\s+/)
                            .map((p) => p[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()
                        : item.phone.slice(-2);
                    const replyTextResolved = item.replyText || logHint?.replyText;
                    const replySnippet = replyTextResolved
                      ? replyTextResolved.length > 80
                        ? `${replyTextResolved.slice(0, 80)}…`
                        : replyTextResolved
                      : '';
                    const replyTs = item.replyTimestampMs || logHint?.replyTimestampMs;
                    const replyTimeResolved =
                      item.replyTime ||
                      (replyTs ? new Date(replyTs).toLocaleTimeString('pt-BR') : undefined);
                    const replyLatency =
                      replyTs && item.sentTimestampMs
                        ? Math.round((replyTs - item.sentTimestampMs) / 1000)
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
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <div
                                  className="text-[13px] font-semibold truncate leading-tight"
                                  style={{ color: 'var(--text-1)' }}
                                >
                                  {item.contactName}
                                </div>
                                {item.legacyEstimate && (
                                  <Badge variant="warning" className="text-[9px] py-0 px-1.5">
                                    estimativa
                                  </Badge>
                                )}
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
                          <RowTimeline status={displayStatus} />
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
                          {replyTimeResolved && (
                            <div
                              className="text-[10.5px] font-mono mt-0.5 inline-flex items-center gap-1"
                              style={{ color: '#10b981' }}
                            >
                              <Reply className="w-2.5 h-2.5" />
                              {replyTimeResolved}
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
                          {displayStatus === 'FAILED' ? (
                            <span style={{ color: 'var(--danger)' }} className="truncate inline-block max-w-full">
                              {item.errorMessage || 'Erro desconhecido'}
                            </span>
                          ) : item.stageReplies?.length || replyTextResolved ? (
                            <CampaignStageRepliesCell
                              stageReplies={item.stageReplies}
                              fallbackText={replyTextResolved}
                              compact
                            />
                          ) : (
                            <span
                              className="text-[11.5px] leading-snug block max-w-[280px]"
                              style={{ color: 'var(--text-3)' }}
                            >
                              {campaignReportReplyDetailLabel(displayStatus, replyTextResolved) || '—'}
                            </span>
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
        subtitle="Histórico completo de envios, respostas e falhas desta campanha"
        icon={<Terminal className="w-5 h-5" />}
        size="lg"
      >
        <CampaignDispatchLogs
          logs={campaignLogs}
          filter={logFilter}
          onFilterChange={setLogFilter}
          variant="full"
          isRunning={isRunning}
          hasMore={logsHasMore}
          loadingMore={logsLoadingMore}
          onLoadMore={loadMoreLogs}
        />
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
        {openRow && (() => {
          const modalStatus = effectiveCampaignReportStatus(openRow, replyPhonesFromLogs) as ReportStatus;
          const modalMeta = STATUS_META[modalStatus];
          const modalReplyHint = replyPhonesFromLogs.get(recipientKeyForCampaignReport(openRow.phone));
          const modalReplyTime = openRow.replyTime || (modalReplyHint?.replyTimestampMs
            ? new Date(modalReplyHint.replyTimestampMs).toLocaleTimeString('pt-BR')
            : undefined);
          const modalReplyText = openRow.replyText || modalReplyHint?.replyText;
          const modalReplyTs = openRow.replyTimestampMs || modalReplyHint?.replyTimestampMs;
          return (
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
                <Badge variant={modalMeta.variant} dot>
                  <span className="inline-flex items-center gap-1">
                    {modalMeta.icon}
                    {modalMeta.label}
                  </span>
                </Badge>
              </div>

              <div className="space-y-2 text-[12.5px]">
                <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                  <Check className="w-3.5 h-3.5" style={{ color: '#94a3b8' }} />
                  <span>Enviada às</span>
                  <span className="font-mono" style={{ color: 'var(--text-1)' }}>{openRow.sentTime}</span>
                </div>
                {(modalStatus === 'DELIVERED' || modalStatus === 'READ' || modalStatus === 'REPLIED') && (
                  <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                    <CheckCheck className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                    <span>Entregue no dispositivo</span>
                  </div>
                )}
                {(modalStatus === 'READ' || modalStatus === 'REPLIED') && (
                  <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                    <CheckCheck className="w-3.5 h-3.5" style={{ color: '#8b5cf6' }} />
                    <span>Lida pelo contato</span>
                  </div>
                )}
                {modalStatus === 'REPLIED' && (modalReplyTime || modalReplyText) && (
                  <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                    <Reply className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                    <span>Respondeu{modalReplyTime ? ' às' : ''}</span>
                    {modalReplyTime && <span className="font-mono" style={{ color: '#10b981' }}>{modalReplyTime}</span>}
                    {modalReplyTs && openRow.sentTimestampMs && (
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        (em {formatDuration(Math.round((modalReplyTs - openRow.sentTimestampMs) / 1000))})
                      </span>
                    )}
                  </div>
                )}
                {modalStatus === 'FAILED' && (
                  <div className="flex items-start gap-2" style={{ color: 'var(--danger)' }}>
                    <XCircle className="w-3.5 h-3.5 mt-0.5" />
                    <span>{openRow.errorMessage || 'Falha no envio.'}</span>
                  </div>
                )}
              </div>
            </div>

            {(openRow.sentMessage || modalReplyText || openRow.stageReplies?.length) && (
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
                {openRow.stageReplies?.length ? (
                  <div className="space-y-2">
                    {openRow.stageReplies.map((s) => (
                      <div key={`${s.stageNumber}-${s.replyTimestampMs}`} className="flex justify-start">
                        <div
                          className="max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-sm text-[13px] whitespace-pre-wrap"
                          style={{
                            background: 'var(--surface-2)',
                            color: 'var(--text-1)',
                            border: '1px solid var(--border-subtle)'
                          }}
                        >
                          <span
                            className="text-[9.5px] font-bold uppercase tracking-wide block mb-1"
                            style={{ color: '#d97706' }}
                          >
                            Resposta · Etapa {s.stageNumber}
                          </span>
                          {s.replyText || '—'}
                          <div
                            className="text-[10px] mt-1 text-right font-mono"
                            style={{ color: 'var(--text-3)' }}
                          >
                            {s.replyTime}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  modalReplyText && (
                    <div className="flex justify-start">
                      <div
                        className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-[13px] whitespace-pre-wrap"
                        style={{
                          background: 'var(--surface-2)',
                          color: 'var(--text-1)',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        {modalReplyText}
                        <div
                          className="text-[10px] mt-1 text-right font-mono"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {modalReplyTime}
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" leftIcon={<Copy className="w-3.5 h-3.5" />} onClick={() => copyPhone(openRow.phone)}>
                Copiar número
              </Button>
              {modalReplyText && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Copy className="w-3.5 h-3.5" />}
                  onClick={() => {
                    navigator.clipboard.writeText(modalReplyText || '').then(
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
          );
        })()}
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
