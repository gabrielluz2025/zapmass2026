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

/** Agrega envios SUCCESS das campanhas (logs + snapshot) por dia local. */
export function computeDailySendsFromCampaigns(campaigns: Campaign[]): Map<string, number> {
  const bucket = new Map<string, number>();
  const bump = (dk: string | null) => {
    if (!dk) return;
    bucket.set(dk, (bucket.get(dk) || 0) + 1);
  };

  for (const c of campaigns) {
    let counted = 0;
    const logs = c.logs || [];
    if (logs.length > 0) {
      for (const l of logs) {
        if (l.type !== 'SUCCESS') continue;
        bump(dayKeyFromTimestamp(l.timestamp));
        counted++;
      }
    }
    if (counted === 0) {
      for (const row of c.reportSnapshot?.rows || []) {
        if (!row.sentTimestampMs && !row.sentTime) continue;
        bump(
          row.sentTimestampMs
            ? dayKeyFromTimestamp(row.sentTimestampMs)
            : dayKeyFromTimestamp(row.sentTime)
        );
        counted++;
      }
    }
    if (counted > 0) continue;
    const bulk = Math.max(0, Number(c.successCount) || 0);
    if (bulk <= 0) continue;
    const dk = dayKeyFromTimestamp(c.lastRunAt || c.createdAt);
    if (!dk) continue;
    bucket.set(dk, (bucket.get(dk) || 0) + bulk);
  }
  return bucket;
}

export function getDailySendSeriesLastNDays(
  uid: string | undefined,
  n: number,
  campaignBuckets?: Map<string, number>
): { date: string; count: number }[] {
  const local =
    uid && typeof window !== 'undefined' ? parseDaily(localStorage.getItem(dailyKey(uid))).totalsByDay : {};
  const out: { date: string; count: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dk = dayKeyFromDate(d);
    const fromCampaign = campaignBuckets?.get(dk) || 0;
    const fromLocal = Number(local[dk]) || 0;
    out.push({ date: dk, count: Math.max(fromCampaign, fromLocal) });
  }
  return out;
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
