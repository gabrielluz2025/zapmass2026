/** Janela após restart do processo API — quedas aqui são esperadas (deploy Docker). */
export const DEPLOY_GRACE_MS = 10 * 60 * 1000;

/** Aguarda retomada de campanhas RUNNING após boot. */
export const CAMPAIGN_RESUME_GRACE_MS = 5 * 60 * 1000;

/** Intervalo mínimo entre chamadas /instance/restart|connect (evita tempestade). */
export const RECONNECT_STAGGER_MS = 18_000;

export function processUptimeMs(): number {
  return Math.floor(process.uptime() * 1000);
}

export function isInDeployGraceWindow(uptimeMs = processUptimeMs()): boolean {
  return uptimeMs < DEPLOY_GRACE_MS;
}

export function isInCampaignResumeGrace(uptimeMs = processUptimeMs()): boolean {
  return uptimeMs < CAMPAIGN_RESUME_GRACE_MS;
}

export function deployGraceRemainingMs(uptimeMs = processUptimeMs()): number {
  return Math.max(0, DEPLOY_GRACE_MS - uptimeMs);
}
