/** Histórico local do painel — envios por dia (campanhas + incrementos ao vivo) e meta mensal. */

import type { Campaign } from '../types';

const STORAGE_PREFIX = 'zapmass.dashboard.v2';

export type DashboardDailyBucket = Record<string, number>; // YYYY-MM-DD → quantidade incremental

interface DailyPayload {
  v: 1;
  totalsByDay: DashboardDailyBucket;
}

interface GoalPayload {
  goal: number;
}

function dailyKey(uid: string): string {
  return `${STORAGE_PREFIX}.daily.${uid}`;
}

function goalKey(uid: string): string {
  return `${STORAGE_PREFIX}.monthlyGoal.${uid}`;
}

function parseDaily(raw: string | null): DailyPayload {
  if (!raw) return { v: 1, totalsByDay: {} };
  try {
    const j = JSON.parse(raw) as Partial<DailyPayload>;
    if (j?.v !== 1 || typeof j.totalsByDay !== 'object' || !j.totalsByDay) return { v: 1, totalsByDay: {} };
    return { v: 1, totalsByDay: { ...j.totalsByDay } };
  } catch {
    return { v: 1, totalsByDay: {} };
  }
}

/** Regista incrementos no total enviado do funil (só aumentos; ignorar zeragens). */
export function recordDashboardFunnelSentIncrement(uid: string | undefined, prevSent: number, nextSent: number): void {
  if (!uid || typeof window === 'undefined') return;
  const delta = Math.max(0, Math.floor(nextSent) - Math.floor(prevSent));
  if (delta <= 0) return;
  const key = dailyKey(uid);
  const now = new Date();
  const dk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const data = parseDaily(localStorage.getItem(key));
  data.totalsByDay[dk] = (data.totalsByDay[dk] || 0) + delta;
  const cutoff = Date.now() - 40 * 24 * 60 * 60 * 1000;
  for (const d of Object.keys(data.totalsByDay)) {
    const [y, m, day] = d.split('-').map(Number);
    if (!y || !m || !day) continue;
    const t = new Date(y, m - 1, day).getTime();
    if (t < cutoff) delete data.totalsByDay[d];
  }
  localStorage.setItem(key, JSON.stringify(data));
}

function dayKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayKeyFromTimestamp(raw: unknown): string | null {
  if (raw == null) return null;
  const d =
    raw instanceof Date
      ? raw
      : typeof raw === 'number'
        ? new Date(raw)
        : new Date(String(raw));
  if (!Number.isFinite(d.getTime())) return null;
  return dayKeyFromDate(d);
}

export type DayCampaignBreakdown = {
  total: number;
  campaigns: Array<{ name: string; count: number }>;
};

function campaignDisplayName(c: Campaign): string {
  const n = (c.name || '').trim();
  return n || 'Campanha sem nome';
}

function addToBreakdown(
  map: Map<string, DayCampaignBreakdown>,
  dk: string | null,
  campaignName: string,
  amount: number
): void {
  if (!dk || amount <= 0) return;
  const cur = map.get(dk) || { total: 0, campaigns: [] };
  cur.total += amount;
  const hit = cur.campaigns.find((x) => x.name === campaignName);
  if (hit) hit.count += amount;
  else cur.campaigns.push({ name: campaignName, count: amount });
  map.set(dk, cur);
}

/** Mensagens enviadas pelas campanhas, agrupadas por dia e por nome da campanha. */
export function computeDailyCampaignBreakdown(campaigns: Campaign[]): Map<string, DayCampaignBreakdown> {
  const map = new Map<string, DayCampaignBreakdown>();

  for (const c of campaigns) {
    const label = campaignDisplayName(c);
    let counted = 0;
    const logs = c.logs || [];
    if (logs.length > 0) {
      for (const l of logs) {
        if (l.type !== 'SUCCESS') continue;
        addToBreakdown(map, dayKeyFromTimestamp(l.timestamp), label, 1);
        counted++;
      }
    }
    if (counted === 0) {
      for (const row of c.reportSnapshot?.rows || []) {
        if (!row.sentTimestampMs && !row.sentTime) continue;
        addToBreakdown(
          map,
          row.sentTimestampMs
            ? dayKeyFromTimestamp(row.sentTimestampMs)
            : dayKeyFromTimestamp(row.sentTime),
          label,
          1
        );
        counted++;
      }
    }
    if (counted > 0) continue;
    const bulk = Math.max(0, Number(c.successCount) || 0);
    if (bulk <= 0) continue;
    addToBreakdown(map, dayKeyFromTimestamp(c.lastRunAt || c.createdAt), label, bulk);
  }
  return map;
}

export function computeDailySendsFromCampaigns(campaigns: Campaign[]): Map<string, number> {
  const breakdown = computeDailyCampaignBreakdown(campaigns);
  const bucket = new Map<string, number>();
  for (const [dk, row] of breakdown) bucket.set(dk, row.total);
  return bucket;
}

export function dailySendMapFromRecord(raw?: Record<string, number> | null): Map<string, number> {
  const bucket = new Map<string, number>();
  if (!raw || typeof raw !== 'object') return bucket;
  for (const [dk, v] of Object.entries(raw)) {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (n > 0) bucket.set(dk, n);
  }
  return bucket;
}

/** Detalhe por campanha a partir do contador diário do servidor. */
export function computeDailyBreakdownFromServer(
  campaigns: Campaign[],
  sentByDayByCampaign?: Record<string, Record<string, number>> | null
): Map<string, DayCampaignBreakdown> {
  const map = new Map<string, DayCampaignBreakdown>();
  if (!sentByDayByCampaign || typeof sentByDayByCampaign !== 'object') return map;
  const nameById = new Map(campaigns.map((c) => [c.id, campaignDisplayName(c)]));
  for (const [dk, row] of Object.entries(sentByDayByCampaign)) {
    if (!row || typeof row !== 'object') continue;
    const campaignsRows: Array<{ name: string; count: number }> = [];
    let total = 0;
    for (const [cid, v] of Object.entries(row)) {
      const n = Math.max(0, Math.floor(Number(v) || 0));
      if (n <= 0) continue;
      total += n;
      campaignsRows.push({ name: nameById.get(cid) || 'Campanha', count: n });
    }
    if (total > 0) map.set(dk, { total, campaigns: campaignsRows });
  }
  return map;
}

/** Texto amigável para tooltip da barra (sem jargão técnico). */
export function formatSendDayTooltip(
  dateStr: string,
  count: number,
  breakdown?: DayCampaignBreakdown
): string {
  const [, m, d] = dateStr.split('-');
  if (count <= 0) return `${d}/${m}: nenhuma mensagem enviada`;
  const lines = [`${d}/${m}: ${count.toLocaleString('pt-BR')} mensagens enviadas`];
  const sorted = [...(breakdown?.campaigns || [])].sort((a, b) => b.count - a.count);
  for (const row of sorted.slice(0, 5)) {
    lines.push(`• ${row.name}: ${row.count.toLocaleString('pt-BR')}`);
  }
  if (sorted.length > 5) lines.push(`• +${sorted.length - 5} campanha(s)`);
  return lines.join('\n');
}

export type FunnelDayRow = {
  date: string;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
};

/** Série diária só com o funil "Enviadas" do painel (contagem persistida no servidor). */
export function getDailySendSeriesLastNDays(
  n: number,
  funnelBuckets?: Map<string, number>
): { date: string; count: number }[] {
  return getFunnelDailySeriesLastNDays(n, { sent: funnelBuckets }).map((row) => ({
    date: row.date,
    count: row.sent
  }));
}

/** Funil completo por dia — enviados, entregues, lidos e respondidos. */
export function getFunnelDailySeriesLastNDays(
  n: number,
  buckets: {
    sent?: Map<string, number>;
    delivered?: Map<string, number>;
    read?: Map<string, number>;
    replied?: Map<string, number>;
  }
): FunnelDayRow[] {
  const out: FunnelDayRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dk = dayKeyFromDate(d);
    out.push({
      date: dk,
      sent: buckets.sent?.get(dk) || 0,
      delivered: buckets.delivered?.get(dk) || 0,
      read: buckets.read?.get(dk) || 0,
      replied: buckets.replied?.get(dk) || 0
    });
  }
  return out;
}

export function sumFunnelWeek(row: FunnelDayRow): number {
  return row.sent + row.delivered + row.read + row.replied;
}

/** Texto amigável com as 4 etapas do funil no dia. */
export function formatFunnelDayTooltip(row: FunnelDayRow, breakdown?: DayCampaignBreakdown): string {
  const [, m, d] = row.date.split('-');
  if (sumFunnelWeek(row) <= 0) return `${d}/${m}: sem atividade neste dia`;
  const lines = [
    `${d}/${m}:`,
    `• Enviados: ${row.sent.toLocaleString('pt-BR')}`,
    `• Entregues: ${row.delivered.toLocaleString('pt-BR')}`,
    `• Lidos: ${row.read.toLocaleString('pt-BR')}`,
    `• Respondidos: ${row.replied.toLocaleString('pt-BR')}`
  ];
  const sorted = [...(breakdown?.campaigns || [])].sort((a, b) => b.count - a.count);
  if (row.sent > 0 && sorted.length > 0) {
    lines.push('', 'Campanhas (enviados):');
    for (const camp of sorted.slice(0, 4)) {
      lines.push(`• ${camp.name}: ${camp.count.toLocaleString('pt-BR')}`);
    }
  }
  return lines.join('\n');
}

export function getFunnelMonthSentSoFar(funnelBuckets: Map<string, number>): number {
  return sumMonthFromDailyBuckets(funnelBuckets);
}

export function sumMonthFromDailyBuckets(buckets: Map<string, number>): number {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let s = 0;
  for (const [day, v] of buckets) {
    if (day.startsWith(ym)) s += Number(v) || 0;
  }
  return s;
}

export function getMonthSentSoFar(uid: string | undefined): number {
  if (!uid || typeof window === 'undefined') return 0;
  const data = parseDaily(localStorage.getItem(dailyKey(uid)));
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let s = 0;
  for (const [day, v] of Object.entries(data.totalsByDay)) {
    if (day.startsWith(ym)) s += Number(v) || 0;
  }
  return s;
}

export function getMonthlyGoal(uid: string | undefined): number {
  if (!uid || typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(goalKey(uid));
    if (!raw) return 0;
    const j = JSON.parse(raw) as GoalPayload;
    return Math.max(0, Math.floor(Number(j.goal) || 0));
  } catch {
    return 0;
  }
}

export function setMonthlyGoal(uid: string | undefined, goal: number): void {
  if (!uid || typeof window === 'undefined') return;
  const g = Math.max(0, Math.floor(goal));
  if (g === 0) localStorage.removeItem(goalKey(uid));
  else localStorage.setItem(goalKey(uid), JSON.stringify({ goal: g } satisfies GoalPayload));
}

export function daysInCurrentMonth(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
}
