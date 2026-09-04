import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Campaign } from '../src/types.js';

const SNAP_DIR = path.join(
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url)),
  '../data/campaign-recipients'
);

const INLINE_MAX = 1_500;

export type RecipientSnapshot = {
  numbers: string[];
  recipients?: Array<{ phone: string; vars: Record<string, string> }>;
};

function snapPath(campaignId: string): string {
  return path.join(SNAP_DIR, `${String(campaignId || '').trim()}.json`);
}

export function saveCampaignRecipientSnapshot(
  campaignId: string,
  data: RecipientSnapshot
): boolean {
  const id = String(campaignId || '').trim();
  if (!id) return false;
  try {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(snapPath(id), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadCampaignRecipientSnapshot(campaignId: string): RecipientSnapshot | null {
  const id = String(campaignId || '').trim();
  if (!id) return null;
  try {
    const raw = fs.readFileSync(snapPath(id), 'utf8');
    const parsed = JSON.parse(raw) as RecipientSnapshot;
    if (!parsed || !Array.isArray(parsed.numbers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function purgeCampaignRecipientSnapshot(campaignId: string): void {
  const id = String(campaignId || '').trim();
  if (!id) return;
  try {
    fs.unlinkSync(snapPath(id));
  } catch {
    /* ok */
  }
}

/** Snapshot leve para persistir no JSONB / devolver na API de lista. */
export function slimScheduleSnapshotForStore(
  campaignId: string,
  snap: Campaign['scheduleStartSnapshot'] | undefined
): Campaign['scheduleStartSnapshot'] | undefined {
  if (!snap) return snap;
  const numbers = Array.isArray(snap.numbers) ? snap.numbers : [];
  const recipients = Array.isArray(snap.recipients) ? snap.recipients : undefined;
  if (numbers.length <= INLINE_MAX && (!recipients || recipients.length <= INLINE_MAX)) {
    return snap;
  }
  saveCampaignRecipientSnapshot(campaignId, { numbers, recipients });
  return {
    ...snap,
    numbers: [],
    recipients: undefined,
  };
}

/** Remove arrays pesados da resposta GET /api/campaigns (campanha já salva no banco). */
export function campaignForClientList(c: Campaign): Campaign {
  const snap = c.scheduleStartSnapshot;
  if (!snap) return c;
  const n = Array.isArray(snap.numbers) ? snap.numbers.length : 0;
  const r = Array.isArray(snap.recipients) ? snap.recipients.length : 0;
  if (n <= 80 && r <= 80) return c;
  return {
    ...c,
    scheduleStartSnapshot: {
      ...snap,
      numbers: [],
      recipients: undefined,
    },
  };
}
