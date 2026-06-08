/**
 * Novos blocos do painel: radar de campanhas, saúde dos chips, alertas CRM,
 * envios últimos 7 dias, score da base, feed de actividade e meta mensal.
 */
import React, { useDeferredValue, useMemo, useState } from 'react';
import type { Campaign, Contact, Conversation, SystemLog, WarmupChipStats, WhatsAppConnection } from '../../types';
import { ConnectionStatus } from '../../types';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Flame,
  Goal,
  HeartCrack,
  Layers,
  Radar,
  Send,
  Signal,
  Snowflake,
  Thermometer,
  TrendingUp,
  Trophy,
  UserRound,
  Zap
} from 'lucide-react';
import { Button, Card, Modal } from '../ui';
import { Sparkline } from '../Sparkline';
import {
  campaignStatusLabel,
  computeCampaignFleetSummary,
  computeCampaignRadar,
  formatCampaignWhen
} from '../../utils/dashboardCampaignInsights';
import { buildChannelDispatchInsights } from '../../utils/channelDispatchInsights';
import {
  computeDailyBreakdownFromServer,
  dailySendMapFromRecord,
  daysInCurrentMonth,
  formatFunnelDayTooltip,
  getFunnelDailySeriesLastNDays,
  getFunnelMonthSentSoFar,
  getMonthlyGoal,
  setMonthlyGoal
} from '../../utils/dashboardLocalStats';

const FUNNEL_CHART_MAX_PX = 72;

const FUNNEL_METRICS = [
  { key: 'sent' as const, label: 'Enviados', color: '#10b981' },
  { key: 'delivered' as const, label: 'Entregues', color: '#3b82f6' },
  { key: 'read' as const, label: 'Lidos', color: '#f59e0b' },
  { key: 'replied' as const, label: 'Respondidos', color: '#a78bfa' }
];

function formatSendChartDay(dateStr: string): { day: string; weekday: string; isToday: boolean } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const now = new Date();
  const isToday =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(dt)
    .replace(/\./g, '')
    .slice(0, 3);
  return { day: String(d || 0).padStart(2, '0'), weekday, isToday };
}
import { computeContactTemperatures } from '../../utils/contactTemperature';
import { normPhoneKey } from '../../utils/brPhoneNormalize';
import { parseFirestoreDateToIso } from '../../utils/followUp';

const RATE_CAP_MESSAGES_PER_HOUR = 100;

function sameLocalDay(isoOrStr: string): boolean {
  let d: Date;
  const iso = parseFirestoreDateToIso(isoOrStr as never);
  if (iso) d = new Date(iso);
  else {
    d = new Date(isoOrStr);
    if (Number.isNaN(d.getTime())) return false;
  }
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function computeBaseQuality(contacts: Contact[]): { validPct: number; namedPct: number; uniquePct: number; score: number } {
  const n = contacts.length;
  if (!n) return { validPct: 100, namedPct: 100, uniquePct: 100, score: 100 };
  let valid = 0;
  let named = 0;
  const keyCounts = new Map<string, number>();
  for (const c of contacts) {
    const digits = (c.phone || '').replace(/\D/g, '');
    if (digits.length >= 10) valid++;
    if (String(c.name || '').trim().length >= 2) named++;
    const k = normPhoneKey(c.phone);
    if (k.length >= 10) keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
  }
  let dupContacts = 0;
  for (const count of keyCounts.values()) {
    if (count > 1) dupContacts += count - 1;
  }
  const validPct = Math.round((valid / n) * 100);
  const namedPct = Math.round((named / n) * 100);
  const uniquePct = Math.round((1 - dupContacts / Math.max(n, 1)) * 100);
  const score = Math.round(validPct * 0.4 + namedPct * 0.35 + uniquePct * 0.25);
  return { validPct, namedPct, uniquePct, score };
}

function formatActivity(log: SystemLog): { title: string; sub: string; tone: 'default' | 'warn' | 'err' } {
  const p = (log.payload || {}) as { message?: string; error?: string; campaignId?: string };
  const msg = String(p.message || p.error || '').trim();
  const ev = (log.event || '').toLowerCase();
  if (ev.includes('campaign:error') || ev.endsWith(':error')) return { title: 'Erro', sub: msg || 'Ocorreu um erro.', tone: 'err' };
  if (ev.includes('campaign:warn') || ev.endsWith(':warn')) return { title: 'Aviso', sub: msg || 'Aviso do sistema.', tone: 'warn' };
  if (ev.includes('campaign') || p.campaignId) return { title: 'Campanha', sub: msg || 'Actividade de campanha.', tone: 'default' };
  return { title: log.event || 'Sistema', sub: msg, tone: 'default' };
}

function formatTimeAgo(ts: string): string {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return 'agora';
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  return `${Math.floor(sec / 86400)} d`;
}

interface Props {
  campaigns: Campaign[];
  contacts: Contact[];
  connections: WhatsAppConnection[];
  conversations: Conversation[];
  systemLogs: SystemLog[];
  funnelStatsTotalSent: number;
  funnelUpdatedAt: number;
  funnelSentByDay?: Record<string, number>;
  funnelDeliveredByDay?: Record<string, number>;
  funnelReadByDay?: Record<string, number>;
  funnelRepliedByDay?: Record<string, number>;
  funnelSentByDayByCampaign?: Record<string, Record<string, number>>;
  warmupChipStats?: Record<string, WarmupChipStats>;
  userUid?: string;
  circuitBreakerOpenIds: string[];
  onOpenCampaigns: () => void;
  onOpenConnections: () => void;
  onOpenContacts: () => void;
  onNavigateToChat: (phone: string, name: string) => void;
}

export const DashboardIntelPanel: React.FC<Props> = ({
  campaigns,
  contacts,
  connections,
  conversations,
  systemLogs,
  funnelStatsTotalSent,
  funnelUpdatedAt,
  funnelSentByDay,
  funnelDeliveredByDay,
  funnelReadByDay,
  funnelRepliedByDay,
  funnelSentByDayByCampaign,
  warmupChipStats,
  userUid,
  circuitBreakerOpenIds,
  onOpenCampaigns,
  onOpenConnections,
  onOpenContacts,
  onNavigateToChat
}) => {
  const deferredConversations = useDeferredValue(conversations);
  const [goalRevision, setGoalRevision] = useState(0);
  const [goalModal, setGoalModal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');

  const radar = useMemo(() => computeCampaignRadar(campaigns), [campaigns]);
  const fleetSummary = useMemo(() => computeCampaignFleetSummary(campaigns), [campaigns]);

  const chipFleet = useMemo(() => {
    const breakers = new Set(circuitBreakerOpenIds);
    let online = 0;
    let sentToday = 0;
    let queue = 0;
    let hot = 0;
    let warm = 0;
    let cold = 0;
    let blocked = 0;
    for (const conn of connections) {
      if (conn.status === ConnectionStatus.CONNECTED) online++;
      sentToday += conn.messagesSentToday || 0;
      queue += conn.queueSize || 0;
      if (breakers.has(conn.id)) blocked++;
      const temp = buildChannelDispatchInsights(conn, warmupChipStats?.[conn.id]).temp.temp;
      if (temp === 'hot') hot++;
      else if (temp === 'warm') warm++;
      else cold++;
    }
    return { online, total: connections.length, sentToday, queue, hot, warm, cold, blocked };
  }, [connections, warmupChipStats, circuitBreakerOpenIds]);

  const funnelDailyBuckets = useMemo(() => dailySendMapFromRecord(funnelSentByDay), [funnelSentByDay]);
  const deliveredBuckets = useMemo(() => dailySendMapFromRecord(funnelDeliveredByDay), [funnelDeliveredByDay]);
  const readBuckets = useMemo(() => dailySendMapFromRecord(funnelReadByDay), [funnelReadByDay]);
  const repliedBuckets = useMemo(() => dailySendMapFromRecord(funnelRepliedByDay), [funnelRepliedByDay]);
  const breakdownByDay = useMemo(
    () => computeDailyBreakdownFromServer(campaigns, funnelSentByDayByCampaign),
    [campaigns, funnelSentByDayByCampaign]
  );
  const series7 = useMemo(
    () =>
      getFunnelDailySeriesLastNDays(7, {
        sent: funnelDailyBuckets,
        delivered: deliveredBuckets,
        read: readBuckets,
        replied: repliedBuckets
      }),
    [funnelUpdatedAt, goalRevision, funnelDailyBuckets, deliveredBuckets, readBuckets, repliedBuckets]
  );
  const weekTotals = useMemo(
    () => ({
      sent: series7.reduce((n, s) => n + s.sent, 0),
      delivered: series7.reduce((n, s) => n + s.delivered, 0),
      read: series7.reduce((n, s) => n + s.read, 0),
      replied: series7.reduce((n, s) => n + s.replied, 0)
    }),
    [series7]
  );
  const weekHasData = useMemo(
    () => weekTotals.sent + weekTotals.delivered + weekTotals.read + weekTotals.replied > 0,
    [weekTotals]
  );
  const peakDay = useMemo(() => {
    if (!series7.length) return null;
    return series7.reduce((best, s) => (s.sent > best.sent ? s : best), series7[0]);
  }, [series7]);
  const monthSent = useMemo(
    () => getFunnelMonthSentSoFar(funnelDailyBuckets),
    [funnelUpdatedAt, goalRevision, funnelDailyBuckets]
  );
  const monthlyGoal = useMemo(() => getMonthlyGoal(userUid), [userUid, goalRevision]);

  const quality = useMemo(() => computeBaseQuality(contacts), [contacts]);

  const activityFeed = useMemo(() => [...systemLogs].slice(0, 5), [systemLogs]);

  const breakerSet = useMemo(() => new Set(circuitBreakerOpenIds), [circuitBreakerOpenIds]);

  const tempMap = useMemo(
    () => computeContactTemperatures(contacts, deferredConversations),
    [contacts, deferredConversations]
  );

  const hotStale7d = useMemo(() => {
    const DAY = 86400000;
    const now = Date.now();
    const cut = now - 7 * DAY;
    const rows: Contact[] = [];
    for (const c of contacts) {
      const t = tempMap[c.id];
      if (!t || t.temp !== 'hot') continue;
      if (!t.lastSentTs || t.lastSentTs >= cut) continue;
      rows.push(c);
    }
    return rows.sort((a, b) => (tempMap[a.id]?.lastSentTs || 0) - (tempMap[b.id]?.lastSentTs || 0)).slice(0, 6);
  }, [contacts, tempMap]);

  const followUpsToday = useMemo(() => {
    return contacts.filter((c) => c.followUpAt && sameLocalDay(c.followUpAt)).slice(0, 8);
  }, [contacts]);

  const maxBar = Math.max(
    1,
    ...series7.flatMap((s) => [s.sent, s.delivered, s.read, s.replied])
  );

  const monthDays = daysInCurrentMonth();
  const dayOfMonth = new Date().getDate();
  const projectedMonth = monthSent > 0 && dayOfMonth > 0 ? Math.round((monthSent / dayOfMonth) * monthDays) : 0;
  const goalProgressPct = monthlyGoal > 0 ? Math.min(100, Math.round((monthSent / monthlyGoal) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 px-0.5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(59,130,246,0.15))',
            border: '1px solid rgba(16,185,129,0.35)'
          }}
        >
          <Radar className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-500)' }} />
        </div>
        <h2 className="ui-title text-[16px]" style={{ color: 'var(--text-1)' }}>
          Inteligência do painel
        </h2>
        <span className="text-[11px] w-full sm:w-auto" style={{ color: 'var(--text-3)' }}>
          Radar, chips, CRM, tendência e metas — passe o mouse nos gráficos
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 sm:gap-4">
        <Card className="zm-intel-card zm-radar-card xl:col-span-4 p-0 overflow-hidden">
          <div className="zm-radar-accent" aria-hidden />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4" style={{ color: '#3b82f6' }} />
              <h3 className="ui-title text-[14px]">Radar de campanhas</h3>
            </div>
            <p className="text-[10px] mb-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Resumo rápido do que suas campanhas fizeram e o que vem a seguir.
            </p>

            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {[
                { label: 'Em disparo', val: fleetSummary.running, color: '#10b981' },
                { label: 'Agendadas', val: fleetSummary.scheduled, color: '#3b82f6' },
                { label: 'Concluídas', val: fleetSummary.completed, color: '#8b5cf6' }
              ].map((k) => (
                <div
                  key={k.label}
                  className="rounded-lg px-2 py-1.5 text-center"
                  style={{
                    background: `color-mix(in srgb, ${k.color} 10%, var(--surface-1))`,
                    border: `1px solid color-mix(in srgb, ${k.color} 22%, transparent)`
                  }}
                >
                  <p className="text-[15px] font-black tabular-nums leading-none" style={{ color: k.color }}>
                    {k.val}
                  </p>
                  <p className="text-[8px] font-bold uppercase mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {k.label}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              <div
                className="rounded-xl p-2.5 border"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: 'color-mix(in srgb, #3b82f6 5%, var(--surface-1))'
                }}
              >
                <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                  <Zap className="w-3 h-3" /> Última campanha
                </p>
                {radar.lastTouched ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-[12px] truncate" style={{ color: 'var(--text-1)' }}>
                        {radar.lastTouched.name}
                      </p>
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}
                      >
                        {campaignStatusLabel(radar.lastTouched.status)}
                      </span>
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                      <Send className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                      {(radar.lastTouched.successCount || 0).toLocaleString('pt-BR')} enviadas
                      {formatCampaignWhen(radar.lastTouched) ? ` · ${formatCampaignWhen(radar.lastTouched)}` : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Nenhuma campanha ainda.</p>
                )}
              </div>

              <div
                className="rounded-xl p-2.5 border"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: 'color-mix(in srgb, #10b981 5%, var(--surface-1))'
                }}
              >
                <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                  <Trophy className="w-3 h-3" /> Melhor desempenho
                </p>
                {radar.bestSuccess ? (
                  <>
                    <p className="font-semibold text-[12px] truncate" style={{ color: 'var(--text-1)' }}>
                      {radar.bestSuccess.name}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: '#10b981' }}>
                      {radar.bestSuccessPct}% das mensagens enviadas com sucesso
                    </p>
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Aguardando campanha concluída.</p>
                )}
              </div>

              <div
                className="rounded-xl p-2.5 border"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: 'color-mix(in srgb, #f59e0b 5%, var(--surface-1))'
                }}
              >
                <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                  <CalendarClock className="w-3 h-3" /> Próximo disparo
                </p>
                {radar.nextScheduled ? (
                  <>
                    <p className="font-semibold text-[12px] truncate" style={{ color: 'var(--text-1)' }}>
                      {radar.nextScheduled.campaign.name}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {new Date(radar.nextScheduled.nextRunAt).toLocaleString('pt-BR')}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Nada agendado por agora.</p>
                )}
              </div>
            </div>

            {weekHasData && (
              <p className="text-[10px] mt-3 px-2 py-1.5 rounded-lg" style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}>
                Esta semana: <strong style={{ color: 'var(--text-2)' }}>{weekTotals.sent.toLocaleString('pt-BR')}</strong> enviadas
                {weekTotals.replied > 0 && (
                  <span> · <strong style={{ color: '#a78bfa' }}>{weekTotals.replied}</strong> respostas</span>
                )}
              </p>
            )}

            <Button variant="ghost" size="sm" className="mt-3 w-full justify-between" onClick={onOpenCampaigns}>
              Abrir campanhas
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </Card>

        <Card className="zm-intel-card zm-chip-health-card xl:col-span-4 p-0 overflow-hidden">
          <div className="zm-chip-health-accent" aria-hidden />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Signal className="w-4 h-4" style={{ color: '#10b981' }} />
              <h3 className="ui-title text-[14px]">Saúde dos chips</h3>
            </div>
            <p className="text-[10px] mb-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Ritmo de envio, temperatura do canal e alertas de proteção anti-ban.
            </p>

            {connections.length > 0 && (
              <div
                className="rounded-xl px-2.5 py-2 mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <span style={{ color: 'var(--text-2)' }}>
                  <strong>{chipFleet.online}</strong>/{chipFleet.total} online
                </span>
                <span style={{ color: 'var(--text-2)' }}>
                  Hoje: <strong>{chipFleet.sentToday.toLocaleString('pt-BR')}</strong> envios
                </span>
                <span style={{ color: 'var(--text-3)' }}>Fila: {chipFleet.queue}</span>
                <span className="flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-3)' }}>
                  <span className="inline-flex items-center gap-0.5"><Flame className="w-3 h-3 text-emerald-500" />{chipFleet.hot}</span>
                  <span className="inline-flex items-center gap-0.5"><Thermometer className="w-3 h-3 text-orange-500" />{chipFleet.warm}</span>
                  <span className="inline-flex items-center gap-0.5"><Snowflake className="w-3 h-3 text-sky-400" />{chipFleet.cold}</span>
                </span>
              </div>
            )}

            <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
              {connections.slice(0, 12).map((conn) => {
                const online = conn.status === ConnectionStatus.CONNECTED;
                const insights = buildChannelDispatchInsights(conn, warmupChipStats?.[conn.id]);
                const TempIcon =
                  insights.temp.temp === 'hot' ? Flame : insights.temp.temp === 'warm' ? Thermometer : Snowflake;
                const paceCap = conn.dailyLimit && conn.dailyLimit > 0 ? conn.dailyLimit : RATE_CAP_MESSAGES_PER_HOUR;
                const pct = Math.min(100, Math.round(((conn.messagesSentToday || 0) / paceCap) * 100));
                const open = breakerSet.has(conn.id);
                const paceLabel =
                  open
                    ? 'Canal pausado pelo sistema — aguarde'
                    : pct >= 85
                      ? 'Ritmo alto — cuidado com o limite'
                      : pct >= 40
                        ? 'Ritmo moderado'
                        : 'Ritmo tranquilo';
                return (
                  <div
                    key={conn.id}
                    className="rounded-xl p-2.5 border"
                    style={{
                      borderColor: open ? 'rgba(244,63,94,0.35)' : `${insights.temp.color}33`,
                      background: open ? 'rgba(244,63,94,0.06)' : insights.temp.bg
                    }}
                  >
                    <div className="flex justify-between gap-2 items-start mb-1.5">
                      <div className="min-w-0">
                        <p className="font-semibold text-[11px] truncate" style={{ color: 'var(--text-1)' }}>
                          {conn.name}
                        </p>
                        <p className="text-[9px] mt-0.5" style={{ color: open ? '#f43f5e' : 'var(--text-3)' }}>
                          {paceLabel}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: `${insights.temp.color}22`, color: insights.temp.color }}
                        >
                          <TempIcon className="w-3 h-3" />
                          {insights.temp.label}
                        </span>
                        {open ? (
                          <span className="text-rose-500 font-bold text-[9px] flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" /> Pausado
                          </span>
                        ) : (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{
                              background: online ? 'rgba(16,185,129,0.15)' : 'var(--surface-2)',
                              color: online ? '#10b981' : 'var(--text-3)'
                            }}
                          >
                            {online ? 'Online' : 'Offline'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <Sparkline
                        id={`intel-${conn.id}`}
                        values={insights.last7.map((d) => d.sent)}
                        color={insights.temp.color}
                        width={100}
                        height={26}
                      />
                      <div className="text-right shrink-0">
                        <p className="text-[9px]" style={{ color: 'var(--text-3)' }}>Hoje</p>
                        <p className="text-[13px] font-black tabular-nums" style={{ color: insights.temp.color }}>
                          {insights.sentToday.toLocaleString('pt-BR')}
                        </p>
                        <p className="text-[8px]" style={{ color: 'var(--text-3)' }}>Fila {conn.queueSize ?? 0}</p>
                      </div>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden mt-1.5" style={{ background: 'var(--surface-3)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: open ? '#f43f5e' : pct >= 85 ? '#f59e0b' : insights.temp.color
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {!connections.length && (
                <p className="text-[12px] py-4 text-center" style={{ color: 'var(--text-3)' }}>
                  Nenhum canal conectado. Adicione um chip para começar.
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" className="mt-3 w-full justify-between" onClick={onOpenConnections}>
              Gerir conexões
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </Card>

        <Card className="zm-intel-card zm-send-trend-card xl:col-span-4 p-0 flex flex-col overflow-hidden">
          <div className="zm-send-trend-accent" aria-hidden />
          <div className="p-4 flex flex-col flex-1 min-h-0">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 shrink-0" style={{ color: '#a78bfa' }} />
                  <h3 className="ui-title text-[14px]">Funil de mensagens — 7 dias</h3>
                </div>
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Mesmos números do painel: enviados, entregues, lidos e respondidos por dia.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
              {FUNNEL_METRICS.map((m) => (
                <div
                  key={m.key}
                  className="rounded-lg px-2 py-1.5 tabular-nums"
                  style={{
                    background: `color-mix(in srgb, ${m.color} 12%, var(--surface-1))`,
                    border: `1px solid color-mix(in srgb, ${m.color} 28%, transparent)`
                  }}
                >
                  <p className="text-[8px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-3)' }}>
                    {m.label}
                  </p>
                  <p className="text-[15px] font-black leading-none mt-0.5" style={{ color: m.color }}>
                    {weekTotals[m.key].toLocaleString('pt-BR')}
                  </p>
                  <p className="text-[7px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    na semana
                  </p>
                </div>
              ))}
            </div>

            {weekHasData && peakDay && peakDay.sent > 0 && (
              <p className="text-[10px] mb-2 -mt-1" style={{ color: 'var(--text-3)' }}>
                Pico de envios:{' '}
                <strong style={{ color: 'var(--text-2)' }}>
                  {peakDay.sent.toLocaleString('pt-BR')}
                </strong>{' '}
                ({formatSendChartDay(peakDay.date).day}/{peakDay.date.slice(5, 7)})
                {(() => {
                  const top = [...(breakdownByDay.get(peakDay.date)?.campaigns || [])].sort(
                    (a, b) => b.count - a.count
                  )[0];
                  return top ? (
                    <span className="opacity-90">
                      {' '}
                      — campanha: {top.name}
                    </span>
                  ) : null;
                })()}
              </p>
            )}

            {!weekHasData ? (
              <div
                className="zm-send-chart-empty flex-1 flex flex-col items-center justify-center text-center rounded-xl px-4 py-8"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px dashed var(--border-subtle)'
                }}
              >
                <Activity className="w-8 h-8 mb-2 opacity-25" style={{ color: '#8b5cf6' }} />
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  Nenhuma atividade nesta semana
                </p>
                <p className="text-[10px] mt-1 max-w-[260px]" style={{ color: 'var(--text-3)' }}>
                  {funnelStatsTotalSent > 0
                    ? 'Os envios desta semana ainda não entram no gráfico. Novas mensagens aparecem aqui no dia em que saírem.'
                    : 'Quando você disparar uma campanha, cada mensagem enviada aparece no dia correspondente.'}
                </p>
              </div>
            ) : (
              <div className="zm-intel-bars zm-send-chart flex items-end gap-1 flex-1 min-h-[148px]">
                {series7.map((s, barIdx) => {
                  const meta = formatSendChartDay(s.date);
                  const isPeak = peakDay?.date === s.date && s.sent > 0;
                  return (
                    <div
                      key={s.date}
                      className={`flex-1 flex flex-col justify-end items-center min-w-0 gap-1 ${meta.isToday ? 'zm-send-col--today' : ''}`}
                      title={formatFunnelDayTooltip(s, breakdownByDay.get(s.date))}
                    >
                      <div className="flex items-end justify-center gap-0.5 w-full min-h-[80px] px-0.5">
                        {FUNNEL_METRICS.map((m) => {
                          const val = s[m.key];
                          const barPx =
                            val > 0 ? Math.max(6, Math.round((val / maxBar) * FUNNEL_CHART_MAX_PX)) : 3;
                          return (
                            <div
                              key={m.key}
                              className="flex-1 max-w-[10px] rounded-t-md zm-intel-bar"
                              style={{
                                height: `${barPx}px`,
                                background: m.color,
                                opacity: val > 0 ? (isPeak && m.key === 'sent' ? 1 : 0.88) : 0.2,
                                animationDelay: `${barIdx * 40 + FUNNEL_METRICS.findIndex((x) => x.key === m.key) * 12}ms`
                              }}
                            />
                          );
                        })}
                      </div>
                      <div className="text-center leading-tight">
                        <span
                          className={`block text-[10px] font-bold tabular-nums ${meta.isToday ? 'text-violet-400' : ''}`}
                          style={{ color: meta.isToday ? undefined : 'var(--text-2)' }}
                        >
                          {meta.day}
                        </span>
                        <span className="block text-[8px] uppercase opacity-70" style={{ color: 'var(--text-3)' }}>
                          {meta.weekday}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {weekHasData && (
              <>
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-2">
                  {FUNNEL_METRICS.map((m) => (
                    <span key={m.key} className="inline-flex items-center gap-1 text-[9px]" style={{ color: 'var(--text-3)' }}>
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: m.color }} />
                      {m.label}
                    </span>
                  ))}
                </div>
                <p className="text-[9px] mt-1 text-center" style={{ color: 'var(--text-3)' }}>
                  Passe o mouse no dia para ver o detalhe
                </p>
              </>
            )}

            <div className="mt-4 pt-4 border-t zm-send-goal-block" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Goal className="w-4 h-4" style={{ color: '#f59e0b' }} />
                  <h3 className="ui-title text-[13px]">Meta mensal</h3>
                </div>
                {monthlyGoal > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    type="button"
                    onClick={() => {
                      setGoalDraft(String(monthlyGoal));
                      setGoalModal(true);
                    }}
                  >
                    Editar
                  </Button>
                )}
              </div>
              {monthlyGoal > 0 ? (
                <>
                  <div className="flex items-end justify-between gap-2 mb-2">
                    <p className="text-[22px] font-black tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                      {goalProgressPct}%
                    </p>
                    <p className="text-[10px] text-right" style={{ color: 'var(--text-3)' }}>
                      {monthSent.toLocaleString('pt-BR')} de {monthlyGoal.toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden mb-2" style={{ background: 'var(--surface-3)' }}>
                    <div
                      className="h-full rounded-full transition-all zm-send-goal-fill"
                      style={{ width: `${goalProgressPct}%` }}
                    />
                  </div>
                  {projectedMonth > 0 && (
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      Ritmo atual: ~{projectedMonth.toLocaleString('pt-BR')} até fim do mês
                    </p>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="zm-send-goal-cta w-full rounded-xl px-3 py-3 text-left transition-colors"
                  onClick={() => {
                    setGoalDraft('5000');
                    setGoalModal(true);
                  }}
                >
                  <p className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                    Definir quantas mensagens quer enviar no mês
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    Ex.: 5.000 mensagens — o painel mostra quanto já foi e quanto falta.
                  </p>
                </button>
              )}
            </div>
          </div>
        </Card>

        <Card className="zm-intel-card xl:col-span-6 p-4">
          <div className="flex items-center gap-2 mb-3">
            <HeartCrack className="w-4 h-4 text-rose-400" />
            <h3 className="ui-title text-[14px]">Precisam de atenção</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="font-bold text-[10px] uppercase mb-2" style={{ color: 'var(--text-3)' }}>
                Quentes sem mensagem há 7+ dias
              </p>
              {hotStale7d.length ? (
                <ul className="space-y-2">
                  {hotStale7d.map((c) => (
                    <li key={c.id} className="flex justify-between items-center gap-2 text-[12px]">
                      <span className="truncate font-medium" style={{ color: 'var(--text-1)' }}>
                        {c.name}
                      </span>
                      <Button variant="ghost" size="xs" type="button" onClick={() => onNavigateToChat(c.phone, c.name)}>
                        Chat
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Nenhum caso nesta lista.
                </p>
              )}
            </div>
            <div>
              <p className="font-bold text-[10px] uppercase mb-2" style={{ color: 'var(--text-3)' }}>
                Retorno agendado hoje
              </p>
              {followUpsToday.length ? (
                <ul className="space-y-2">
                  {followUpsToday.map((c) => (
                    <li key={c.id} className="flex justify-between items-center gap-2 text-[12px]">
                      <span className="truncate font-medium" style={{ color: 'var(--text-1)' }}>
                        {c.name}
                      </span>
                      <Button variant="ghost" size="xs" type="button" onClick={() => onNavigateToChat(c.phone, c.name)}>
                        Chat
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Nenhum retorno com data de hoje.
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-3 w-full justify-between" onClick={onOpenContacts}>
            Abrir contatos
            <ChevronRight className="w-4 h-4" />
          </Button>
        </Card>

        <Card className="zm-intel-card xl:col-span-3 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4" style={{ color: '#06b6d4' }} />
            <h3 className="ui-title text-[14px]">Qualidade da base</h3>
          </div>
          <div className="flex items-center justify-center mb-3">
            <div
              className="relative w-24 h-24 rounded-full flex items-center justify-center text-lg font-black"
              style={{ background: `conic-gradient(#10b981 ${quality.score * 3.6}deg, var(--surface-3) 0deg)` }}
            >
              <div className="absolute inset-2 rounded-full flex flex-col items-center justify-center" style={{ background: 'var(--surface-0)' }}>
                <span style={{ color: 'var(--text-1)' }}>{quality.score}</span>
                <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>
                  score
                </span>
              </div>
            </div>
          </div>
          <ul className="space-y-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>
            <li className="flex justify-between gap-2">
              <span>Tel. válido</span>
              <strong>{quality.validPct}%</strong>
            </li>
            <li className="flex justify-between gap-2">
              <span>Nome preenchido</span>
              <strong>{quality.namedPct}%</strong>
            </li>
            <li className="flex justify-between gap-2">
              <span>Menos duplicados</span>
              <strong>{quality.uniquePct}%</strong>
            </li>
          </ul>
        </Card>

        <Card className="zm-intel-card xl:col-span-3 p-4">
          <div className="flex items-center gap-2 mb-3">
            <UserRound className="w-4 h-4" style={{ color: '#94a3b8' }} />
            <h3 className="ui-title text-[14px]">Actividade recente</h3>
          </div>
          {activityFeed.length ? (
            <ul className="space-y-2.5">
              {activityFeed.map((log, i) => {
                const f = formatActivity(log);
                const col = f.tone === 'err' ? '#f43f5e' : f.tone === 'warn' ? '#f59e0b' : '#64748b';
                return (
                  <li key={`${log.timestamp}-${i}`} className="text-[11px] leading-snug border-l-2 pl-2" style={{ borderColor: col }}>
                    <span className="font-semibold block" style={{ color: 'var(--text-1)' }}>
                      {f.title}
                    </span>
                    <span style={{ color: 'var(--text-2)' }}>{f.sub || 'Sem detalhe.'}</span>
                    <span className="block text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {formatTimeAgo(log.timestamp)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              Nenhuma atividade recente para mostrar.
            </p>
          )}
        </Card>
      </div>

      <Modal isOpen={goalModal} onClose={() => setGoalModal(false)} title="Meta de mensagens no mês">
        <p className="text-[12px] mb-3" style={{ color: 'var(--text-2)' }}>
          Quantas mensagens você pretende enviar até ao fim do mês? O painel compara com o que suas campanhas já
          enviaram e mostra a percentagem concluída.
        </p>
        <input
          className="w-full px-3 py-2 rounded-xl border mb-4 text-[14px]"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)', color: 'var(--text-1)' }}
          type="number"
          min={0}
          value={goalDraft}
          onChange={(e) => setGoalDraft(e.target.value)}
          placeholder="Ex: 8000"
        />
        <div className="flex gap-2 justify-end flex-wrap">
          <Button variant="ghost" type="button" onClick={() => setGoalModal(false)}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" type="button" onClick={() => { setMonthlyGoal(userUid, 0); setGoalRevision((x) => x + 1); setGoalModal(false); }}>
            Limpar
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={() => { const n = Math.max(0, Math.floor(Number(goalDraft) || 0)); setMonthlyGoal(userUid, n); setGoalRevision((x) => x + 1); setGoalModal(false); }}>
            Guardar
          </Button>
        </div>
      </Modal>
    </div>
  );
};
