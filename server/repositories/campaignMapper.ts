import { CampaignStatus, type Campaign } from '../../src/types.js';

export type CampaignRow = {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  next_run_at: Date | null;
  schedule_lock_until: Date | null;
  doc: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const STATUS_VALUES = new Set<string>(Object.values(CampaignStatus));

function parseStatus(raw: unknown): Campaign['status'] {
  const s = String(raw || 'DRAFT');
  if (s === 'STARTED') return CampaignStatus.RUNNING;
  if (STATUS_VALUES.has(s)) return s as Campaign['status'];
  return CampaignStatus.DRAFT;
}

export function campaignDocPayload(input: Record<string, unknown>, tenantId: string): Record<string, unknown> {
  const doc = { ...input };
  doc.ownerUid = tenantId;
  if (!doc.createdAt) doc.createdAt = new Date().toISOString();
  return doc;
}

export function rowToCampaign(row: CampaignRow): Campaign {
  const raw = row.doc && typeof row.doc === 'object' ? row.doc : {};
  const total = Number(raw.totalContacts) || Number(raw.total) || 0;
  const createdAt =
    typeof raw.createdAt === 'string'
      ? raw.createdAt
      : row.created_at.toISOString();
  return {
    ...(raw as unknown as Campaign),
    id: row.id,
    name: row.name || String(raw.name || 'Campanha'),
    message: String(raw.message || ''),
    messageStages: Array.isArray(raw.messageStages) ? (raw.messageStages as string[]) : undefined,
    replyFlow: raw.replyFlow as Campaign['replyFlow'],
    totalContacts: total,
    processedCount: Number(raw.processedCount) || 0,
    successCount: Number(raw.successCount) || 0,
    failedCount: Number(raw.failedCount) || 0,
    status: parseStatus(row.status || raw.status),
    selectedConnectionIds: Array.isArray(raw.selectedConnectionIds)
      ? (raw.selectedConnectionIds as string[])
      : Array.isArray(raw.connectionIds)
        ? (raw.connectionIds as string[])
        : [],
    contactListId: String(raw.contactListId || ''),
    contactListName: String(raw.contactListName || ''),
    createdAt,
    delaySeconds: raw.delaySeconds != null ? Number(raw.delaySeconds) : undefined,
    scheduleTimeZone: typeof raw.scheduleTimeZone === 'string' ? raw.scheduleTimeZone : undefined,
    weeklySchedule: raw.weeklySchedule as Campaign['weeklySchedule'],
    scheduleRepeatWeekly: raw.scheduleRepeatWeekly === true,
    scheduleOnceLocalDate:
      typeof raw.scheduleOnceLocalDate === 'string' ? raw.scheduleOnceLocalDate : undefined,
    scheduleOnceLocalTime:
      typeof raw.scheduleOnceLocalTime === 'string' ? raw.scheduleOnceLocalTime : undefined,
    nextRunAt: row.next_run_at
      ? row.next_run_at.toISOString()
      : typeof raw.nextRunAt === 'string'
        ? raw.nextRunAt
        : undefined,
    lastRunAt: typeof raw.lastRunAt === 'string' ? raw.lastRunAt : undefined,
    scheduleStartSnapshot: raw.scheduleStartSnapshot as Campaign['scheduleStartSnapshot'],
    channelWeights: raw.channelWeights as Campaign['channelWeights']
  };
}

export function campaignRowFieldsFromDoc(
  doc: Record<string, unknown>
): { name: string; status: string; next_run_at: Date | null } {
  const name = String(doc.name || 'Campanha').slice(0, 500);
  const status = parseStatus(doc.status);
  let next_run_at: Date | null = null;
  const nr = doc.nextRunAt;
  if (typeof nr === 'string' && nr.trim()) {
    const t = Date.parse(nr);
    if (Number.isFinite(t)) next_run_at = new Date(t);
  }
  return { name, status, next_run_at };
}
