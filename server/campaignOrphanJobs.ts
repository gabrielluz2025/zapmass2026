/** Escolhe a campanha para religar jobs cujo campaign_id ficou NULL (ON DELETE SET NULL). */

export type OrphanCampaignCandidate = {
  id: string;
  status: string;
  createdAt?: string;
};

const TERMINAL = new Set(['COMPLETED', 'FAILED']);
const LIVE = new Set(['DRAFT', 'RUNNING', 'PAUSED', 'WAITING_REPLY']);

/**
 * Só anexa órfãos quando dá para ter certeza: uma campanha viva,
 * ou exatamente uma DRAFT/RUNNING/PAUSED/WAITING_REPLY.
 * Com duas campanhas ativas, não adivinha.
 */
export function pickOrphanJobCampaignTarget(
  campaigns: OrphanCampaignCandidate[]
): string | null {
  const ids = campaigns
    .map((c) => ({
      id: String(c.id || '').trim(),
      status: String(c.status || '').toUpperCase(),
    }))
    .filter((c) => c.id);
  if (ids.length === 0) return null;
  const notDone = ids.filter((c) => !TERMINAL.has(c.status));
  const pool = notDone.length > 0 ? notDone : ids;
  if (pool.length === 1) return pool[0].id;
  const live = pool.filter((c) => LIVE.has(c.status));
  if (live.length === 1) return live[0].id;
  return null;
}
