import type { Express, Request, Response } from 'express';
import { assertAdminFromBearer } from './adminAuth.js';
import {
  buildCampaignQueueSummary,
  countCampaignQueueJobsDetailed,
  purgeCampaignQueueJobs,
} from './campaignQueueAdmin.js';
import { isLoopbackRequest } from './chipHealthMonitorAuth.js';
import * as evolutionService from './evolutionService.js';

function parseConfirmPhrase(campaignId: string, raw: unknown): boolean {
  const expected = `PURGE ${String(campaignId || '').trim()}`;
  return String(raw || '').trim() === expected;
}

async function handleSummary(req: Request, res: Response): Promise<void> {
  const queue = evolutionService.getCampaignBullmqQueue();
  const campaignId = String(req.query.campaignId || '').trim() || undefined;
  const summary = await buildCampaignQueueSummary(queue, {
    campaignId,
    topLimit: Number(req.query.limit || 30) || 30,
  });

  let redisWait: number | null = null;
  let redisDelayed: number | null = null;
  try {
    const conn = await evolutionService.getRedisConnectionForOps?.();
    if (conn) {
      const w = await conn.llen('bull:campaign-messages:wait');
      const d = await conn.zcard('bull:campaign-messages:delayed');
      redisWait = typeof w === 'number' ? w : Number(w) || 0;
      redisDelayed = typeof d === 'number' ? d : Number(d) || 0;
    }
  } catch {
    /* Redis opcional no payload */
  }

  res.json({
    ok: true,
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

  const queue = evolutionService.getCampaignBullmqQueue();
  if (!queue) {
    res.status(503).json({ ok: false, error: 'Fila campaign-messages indisponível (Redis).' });
    return;
  }

  const before = await countCampaignQueueJobsDetailed(queue, campaignId);

  let paused = false;
  if (!dryRun && body.pauseFirst !== false) {
    evolutionService.pauseCampaign(campaignId);
    paused = true;
  }

  const purge = await purgeCampaignQueueJobs(queue, campaignId, { dryRun });
  const after =
    dryRun ? before : await countCampaignQueueJobsDetailed(queue, campaignId);

  res.json({
    ok: true,
    paused,
    before,
    after,
    purge,
  });
}

export function registerCampaignQueueRoutes(app: Express): void {
  app.get('/api/internal/campaign-queue/summary', async (req, res) => {
    if (!isLoopbackRequest(req)) {
      return res.status(403).json({ ok: false, error: 'Somente localhost.' });
    }
    try {
      await handleSummary(req, res);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[api/internal/campaign-queue/summary]', message);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post('/api/internal/campaign-queue/purge', async (req, res) => {
    if (!isLoopbackRequest(req)) {
      return res.status(403).json({ ok: false, error: 'Somente localhost.' });
    }
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
