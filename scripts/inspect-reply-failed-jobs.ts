/**
 * Amostra jobs mortos na fila BullMQ campaign-replies (VPS).
 * Uso: npx tsx scripts/inspect-reply-failed-jobs.ts
 */
import Redis from 'ioredis';

const r = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

async function main() {
  const failed = await r.zrange('bull:campaign-replies:failed', 0, 14, 'WITHSCORES');
  console.log('failed count', await r.zcard('bull:campaign-replies:failed'));
  for (let i = 0; i < failed.length; i += 2) {
    const id = failed[i];
    const reason = await r.hget(`bull:campaign-replies:${id}`, 'failedReason');
    const dataRaw = await r.hget(`bull:campaign-replies:${id}`, 'data');
    let to = '';
    let campaignId = '';
    try {
      const data = JSON.parse(dataRaw || '{}') as { to?: string; campaignId?: string };
      to = String(data.to || '').slice(-6);
      campaignId = String(data.campaignId || '').slice(0, 8);
    } catch {
      /* ignore */
    }
    console.log('---', id, 'camp', campaignId, 'to', to);
    console.log(String(reason || '(sem failedReason)').slice(0, 400));
  }
  await r.quit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
