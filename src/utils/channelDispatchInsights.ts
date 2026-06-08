import type { WarmupChipStats, WhatsAppConnection } from '../types';

export type ChannelDispatchTemp = 'hot' | 'warm' | 'cold';

export interface ChannelDispatchTempInfo {
  temp: ChannelDispatchTemp;
  label: string;
  color: string;
  bg: string;
  trendPct: number;
}

export interface ChannelDailySent {
  date: string;
  sent: number;
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Últimos N dias de disparos do canal (zeros nos dias sem histórico). */
export function getChannelLastNSentDays(
  stats: WarmupChipStats | undefined,
  n: number,
  sentTodayLive = 0
): ChannelDailySent[] {
  const dict = new Map((stats?.dailyHistory || []).map((d) => [d.date, d.sent || 0]));
  const out: ChannelDailySent[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(d);
    const isToday = i === 0;
    const sent = isToday ? Math.max(dict.get(key) || 0, sentTodayLive) : dict.get(key) || 0;
    out.push({ date: key, sent });
  }
  return out;
}

export function formatChannelSparkDay(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(2000, (m || 1) - 1, d || 1);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'narrow' })
    .format(dt)
    .replace(/\./g, '')
    .slice(0, 1)
    .toUpperCase();
}

/** Quente / morno / frio conforme volume recente de disparos do canal. */
export function computeChannelDispatchTemp(
  sentToday: number,
  last7: ChannelDailySent[],
  dailyLimit?: number
): ChannelDispatchTempInfo {
  const series = last7.map((d) => d.sent);
  const weekTotal = series.reduce((a, b) => a + b, 0);
  const avg7 = weekTotal / Math.max(series.length, 1);
  const yesterday = series.length >= 2 ? series[series.length - 2] : 0;
  const trendPct =
    yesterday > 0 ? Math.round(((sentToday - yesterday) / yesterday) * 100) : sentToday > 0 ? 100 : 0;

  const hotThreshold =
    dailyLimit && dailyLimit > 0 ? Math.max(25, Math.floor(dailyLimit * 0.55)) : 35;
  const warmThreshold =
    dailyLimit && dailyLimit > 0 ? Math.max(6, Math.floor(dailyLimit * 0.12)) : 8;

  if (sentToday >= hotThreshold || avg7 >= hotThreshold * 0.55) {
    return { temp: 'hot', label: 'Quente', color: '#10b981', bg: 'rgba(16,185,129,0.14)', trendPct };
  }
  if (sentToday >= warmThreshold || weekTotal >= warmThreshold * 4) {
    return { temp: 'warm', label: 'Morno', color: '#f97316', bg: 'rgba(249,115,22,0.14)', trendPct };
  }
  return { temp: 'cold', label: 'Frio', color: '#38bdf8', bg: 'rgba(56,189,248,0.14)', trendPct };
}

export function buildChannelDispatchInsights(
  connection: WhatsAppConnection,
  stats?: WarmupChipStats
): {
  last7: ChannelDailySent[];
  sentToday: number;
  weekTotal: number;
  temp: ChannelDispatchTempInfo;
} {
  const sentToday = Math.max(connection.messagesSentToday || 0, 0);
  const last7 = getChannelLastNSentDays(stats, 7, sentToday);
  const weekTotal = last7.reduce((n, d) => n + d.sent, 0);
  const temp = computeChannelDispatchTemp(sentToday, last7, connection.dailyLimit);
  return { last7, sentToday, weekTotal, temp };
}
