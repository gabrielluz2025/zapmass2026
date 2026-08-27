import { RECONNECT_STAGGER_MS } from '../shared/deployGrace.js';

let chain: Promise<void> = Promise.resolve();
let lastRunAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Serializa restart/connect Evolution — N chips em paralelo após deploy
 * disparam alertas de tempestade no WhatsApp e no chipProtectionService.
 */
export function runEvolutionReconnectExclusive(task: () => Promise<void>): void {
  chain = chain
    .then(async () => {
      const now = Date.now();
      const wait = Math.max(0, lastRunAt + RECONNECT_STAGGER_MS - now);
      if (wait > 0) await sleep(wait);
      lastRunAt = Date.now();
      await task();
    })
    .catch(() => {
      /* fila continua */
    });
}
