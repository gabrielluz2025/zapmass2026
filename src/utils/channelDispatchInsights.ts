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
  warmupSent: number;
}

/** Gera chave YYYY-MM-DD para uma data em UTC-3 (horário de Brasília, fixo desde 2019).
 *  Equivalente ao que o servidor grava após a correção de timezone no todayKey(). */
export const brazilDayKey = (ts: number = Date.now()): string => {
  const d = new Date(ts - 3 * 60 * 60 * 1000); // UTC → UTC-3
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export function campaignSentFromEntry(entry?: { sent?: number; warmupSent?: number } | null): number {
  if (!entry) return 0;
  const warmup = Math.max(0, entry.warmupSent || 0);
  return Math.max(0, (entry.sent || 0) - warmup);
}

export function warmupSentFromEntry(entry?: { warmupSent?: number } | null): number {
  return Math.max(0, entry?.warmupSent || 0);
}

/** Últimos N dias de disparos do canal (zeros nos dias sem histórico).
 *  Usa UTC-3 (Brasília) para gerar as chaves de data — alinhado com o servidor após correção de timezone. */
export function getChannelLastNSentDays(
  stats: WarmupChipStats | undefined,
  n: number,
  sentTodayLive = 0,
  warmupTodayLive = 0
): ChannelDailySent[] {
  const dict = new Map((stats?.dailyHistory || []).map((d) => [d.date, d]));
  const out: ChannelDailySent[] = [];
  const nowMs = Date.now();
  const todayKeyBrazil = brazilDayKey(nowMs);
  for (let i = n - 1; i >= 0; i--) {
    const dayMs = nowMs - i * 24 * 60 * 60 * 1000;
    const key = brazilDayKey(dayMs);
    const entry = dict.get(key);
    const isToday = key === todayKeyBrazil;
    const campaignHist = campaignSentFromEntry(entry);
    const warmupHist = warmupSentFromEntry(entry);
    out.push({
      date: key,
      sent: isToday ? Math.max(campaignHist, sentTodayLive) : campaignHist,
      warmupSent: isToday ? Math.max(warmupHist, warmupTodayLive) : warmupHist,
    });
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
  warmupToday: number;
  weekTotal: number;
  warmupWeekTotal: number;
  totalCampaign: number;
  totalWarmup: number;
  temp: ChannelDispatchTempInfo;
} {
  const liveCampaign = Math.max(connection.messagesSentToday || 0, 0);
  const todayKey = brazilDayKey();
  const todayEntry = stats?.dailyHistory?.find((d) => d.date === todayKey);
  const warmupToday = warmupSentFromEntry(todayEntry);
  const campaignFromStats = campaignSentFromEntry(todayEntry);
  const sentToday = Math.max(liveCampaign, campaignFromStats);
  const last7 = getChannelLastNSentDays(stats, 7, sentToday, warmupToday);
  const weekTotal = last7.reduce((n, d) => n + d.sent, 0);
  const warmupWeekTotal = last7.reduce((n, d) => n + d.warmupSent, 0);
  const totalWarmup = (stats?.dailyHistory || []).reduce((n, d) => n + warmupSentFromEntry(d), 0);
  const mixedTotal = stats?.totalSent ?? connection.totalMessagesSent ?? 0;
  const totalCampaign = Math.max(0, mixedTotal - totalWarmup);
  const temp = computeChannelDispatchTemp(sentToday, last7, connection.dailyLimit);
  return {
    last7,
    sentToday,
    warmupToday,
    weekTotal,
    warmupWeekTotal,
    totalCampaign,
    totalWarmup,
    temp,
  };
}
