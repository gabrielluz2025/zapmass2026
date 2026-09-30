import type { Express, Request, Response } from 'express';
import { assertAdminFromBearer } from './adminAuth.js';
import {
  buildCampaignQueueSummaryFromQueues,
  countCampaignQueueJobsDetailed,
  purgeCampaignQueueJobs,
} from './campaignQueueAdmin.js';
import { isChipHealthMonitorInternalAccess, isLoopbackRequest } from './chipHealthMonitorAuth.js';
import * as evolutionService from './evolutionService.js';

function parseConfirmPhrase(campaignId: string, raw: unknown): boolean {
  const expected = `PURGE ${String(campaignId || '').trim()}`;
  return String(raw || '').trim() === expected;
}

async function handleSummary(req: Request, res: Response): Promise<void> {
  const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
  const campaignId = String(req.query.campaignId || '').trim() || undefined;
  const summary = await buildCampaignQueueSummaryFromQueues(queues, {
    campaignId,
    topLimit: Number(req.query.limit || 30) || 30,
  });

  let redisWait: number | null = null;
  let redisDelayed: number | null = null;
  try {
    const conn = await evolutionService.getRedisConnectionForOps?.();
    if (conn) {
      const { sumRedisMassQueueDepth } = await import('./campaignChannelBullmq.js');
      const depth = await sumRedisMassQueueDepth(conn);
      redisWait = depth.waitLen;
      redisDelayed = depth.delayedLen;
    }
  } catch {
    /* Redis opcional no payload */
  }

  res.json({
    ok: true,
    channelQueues: queues.length,
    redis: { waitLen: redisWait, delayedLen: redisDelayed },
    ...summary,
  });
}

async function handlePurge(req: Request, res: Response): Promise<void> {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
    campaignId?: string;
    dryRun?: boolean;
    confirm?: string;
    pauseFirst?: boolean;
  };

  const campaignId = String(body.campaignId || '').trim();
  if (!campaignId) {
    res.status(400).json({ ok: false, error: 'campaignId obrigatório.' });
    return;
  }

  const dryRun = body.dryRun !== false;
  if (!dryRun && !parseConfirmPhrase(campaignId, body.confirm)) {
    res.status(400).json({
      ok: false,
      error: `Confirmação inválida. Envie confirm: "PURGE ${campaignId}" e dryRun: false.`,
    });
    return;
  }

  const queues = await evolutionService.getCampaignBullmqQueuesForAdmin();
  if (queues.length === 0) {
    res.status(503).json({ ok: false, error: 'Filas de campanha indisponíveis (Redis).' });
    return;
  }

  let beforeTotal = 0;
  const beforeByState = { active: 0, waiting: 0, delayed: 0, paused: 0 };
  for (const queue of queues) {
    const before = await countCampaignQueueJobsDetailed(queue, campaignId);
    beforeTotal += before.total;
    for (const k of Object.keys(before.byState) as (keyof typeof beforeByState)[]) {
      beforeByState[k] += before.byState[k];
    }
  }
  const before = { total: beforeTotal, byState: beforeByState };

  let paused = false;
  if (!dryRun && body.pauseFirst !== false) {
    evolutionService.pauseCampaign(campaignId);
    paused = true;
  }

  const purgeResults = [];
  for (const queue of queues) {
    purgeResults.push(await purgeCampaignQueueJobs(queue, campaignId, { dryRun }));
  }
  const purge = purgeResults.reduce(
    (acc, p) => ({
      campaignId: p.campaignId,
      dryRun: p.dryRun,
      matched: acc.matched + p.matched,
      removed: acc.removed + p.removed,
      wouldRemove: acc.wouldRemove + p.wouldRemove,
      skippedActive: acc.skippedActive + p.skippedActive,
      failedRemove: acc.failedRemove + p.failedRemove,
      byState: {
        active: acc.byState.active + p.byState.active,
        waiting: acc.byState.waiting + p.byState.waiting,
        delayed: acc.byState.delayed + p.byState.delayed,
        paused: acc.byState.paused + p.byState.paused,
      },
    }),
    {
      campaignId,
      dryRun,
      matched: 0,
      removed: 0,
      wouldRemove: 0,
      skippedActive: 0,
      failedRemove: 0,
      byState: { active: 0, waiting: 0, delayed: 0, paused: 0 },
    }
  );
  let after = before;
  if (!dryRun) {
    let afterTotal = 0;
    const afterByState = { active: 0, waiting: 0, delayed: 0, paused: 0 };
    for (const queue of queues) {
      const part = await countCampaignQueueJobsDetailed(queue, campaignId);
      afterTotal += part.total;
      for (const k of Object.keys(part.byState) as (keyof typeof afterByState)[]) {
        afterByState[k] += part.byState[k];
      }
    }
    after = { total: afterTotal, byState: afterByState };
  }

  res.json({
    ok: true,
    paused,
    before,
    after,
    purge,
  });
}

function assertInternalCampaignQueueAccess(req: Request, res: Response): boolean {
  if (isLoopbackRequest(req) || isChipHealthMonitorInternalAccess(req)) {
    return true;
  }
  res.status(403).json({
    ok: false,
    error: 'Acesso negado. Use docker compose exec zapmass curl … ou X-Internal-Secret.',
  });
  return false;
}

export function registerCampaignQueueRoutes(app: Express): void {
  app.get('/api/internal/campaign-queue/summary', async (req, res) => {
    if (!assertInternalCampaignQueueAccess(req, res)) return;
    try {
      await handleSummary(req, res);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[api/internal/campaign-queue/summary]', message);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/internal/campaign-queue/purge', async (req, res) => {
    if (!assertInternalCampaignQueueAccess(req, res)) return;
    try {
      await handlePurge(req, res);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[api/internal/campaign-queue/purge]', message);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/admin/campaign-queue/summary', async (req, res) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;
    try {
      await handleSummary(req, res);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/admin/campaign-queue/purge', async (req, res) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;
    try {
      await handlePurge(req, res);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: message });
    }
  });
}
