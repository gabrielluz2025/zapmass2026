/**
 * Heurística: quantas sessões WA são confortáveis para a RAM do host
 * (Chromium + WhatsApp Web). Não é limite de plano comercial.
 */
export function getChannelCapacity(ramTotalGb: number | undefined) {
  const gb = ramTotalGb ?? 0;
  let safe = 0;
  let critical = 0;
  if (gb <= 0) {
    safe = 3;
    critical = 5;
  } else if (gb <= 4) {
    safe = 2;
    critical = 3;
  } else if (gb <= 8) {
    safe = 5;
    critical = 7;
  } else if (gb <= 16) {
    safe = 10;
    critical = 14;
  } else if (gb <= 32) {
    safe = 20;
    critical = 26;
  } else if (gb <= 64) {
    safe = 40;
    critical = 52;
  } else {
    safe = Math.floor(gb * 0.6);
    critical = Math.floor(gb * 0.8);
  }
  return { safe, critical };
}
