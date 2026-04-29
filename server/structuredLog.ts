/**
 * Linha JSON para agregadores (Cloud Logging, Loki, etc.).
 * Desligar: STRUCTURED_LOG=0
 */
export function structuredLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown> = {}
): void {
  if (String(process.env.STRUCTURED_LOG ?? '').trim().toLowerCase() === '0') {
    return;
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
