/**
 * Cliente HTTP para /api/internal/campaign-queue/* (localhost na VPS).
 *
 * Uso:
 *   npm run campaign:queue -- summary
 *   npm run campaign:queue -- dry-run <campaignId>
 */
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const port = String(process.env.PORT || '3001').trim() || '3001';
  const base = `http://127.0.0.1:${port}`;

  if (cmd === 'summary') {
    const url = arg ? `${base}/api/internal/campaign-queue/summary?campaignId=${encodeURIComponent(arg)}` : `${base}/api/internal/campaign-queue/summary`;
    const res = await fetch(url);
    console.log(JSON.stringify(await res.json(), null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  if (cmd === 'dry-run' && arg) {
    const res = await fetch(`${base}/api/internal/campaign-queue/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: arg, dryRun: true }),
    });
    console.log(JSON.stringify(await res.json(), null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  console.error('Uso: npm run campaign:queue -- summary [campaignId]');
  console.error('     npm run campaign:queue -- dry-run <campaignId>');
  console.error('Purge interativo: bash deployment/campaign-queue-vps.sh purge <campaignId>');
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
