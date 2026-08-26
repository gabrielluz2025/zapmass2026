/**
 * Dispara replay de mensagens inbound perdidas via API local (processo principal).
 *
 * Não importe evolutionService diretamente — scripts one-off não compartilham Redis/chatStore
 * com o servidor em execução.
 *
 * Uso na VPS:
 *   docker exec -w /app zapmass-zapmass-1 npm run replay:inbound -- conn_1787679548030_1
 */
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const connectionId = process.argv[2]?.trim();
  if (!connectionId) {
    console.error('Uso: npm run replay:inbound -- <connectionId>');
    process.exit(1);
  }

  const port = String(process.env.PORT || '3001').trim() || '3001';
  const url = `http://127.0.0.1:${port}/api/internal/connections/${encodeURIComponent(connectionId)}/replay-inbound`;

  const res = await fetch(url, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
