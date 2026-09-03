import {
  chipProtectionReasonLabel,
  defaultChipProtectionPolicy,
  envChipSyncProfileNormal,
  mergeSyncProfile,
  strictSyncProfile,
  type ChipProtectionPolicy,
  type ChipProtectionReason,
  type ChipSyncProfile
} from '../shared/chipProtection.js';
import { getTenantDispatchSettings, loadTenantSettings, saveTenantSettings } from './tenantSettings.js';
import { getAutoWarmupState, stopAutoWarmup } from './whatsappService.js';
import { listDueEnrollmentsPg } from './nurture/nurtureRepository.js';
import { getOrCreatePrimaryJourneyPg } from './nurture/nurtureRepository.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import { getChipCircuitBreaker } from './chipCircuitBreaker.js';
import { isInDeployGraceWindow } from '../shared/deployGrace.js';

const effectiveCache = new Map<
  string,
  { active: boolean; reason: ChipProtectionReason | null; policy: ChipProtectionPolicy; at: number }
>();
const EFFECTIVE_CACHE_MS = 30_000;

const closeEventsByTenant = new Map<string, number[]>();
export const CLOSE_STORM_WINDOW_MS = 30 * 60 * 1000;
export const CLOSE_STORM_THRESHOLD = 3;

/** Progresso de quedas recentes antes do lock reconnect_storm (para UI/alertas). */
export function getReconnectStormProgress(tenantId: string): {
  count: number;
  threshold: number;
  windowMs: number;
} {
  const uid = String(tenantId || '').trim();
  const now = Date.now();
  const recent = (closeEventsByTenant.get(uid) ?? []).filter((t) => now - t < CLOSE_STORM_WINDOW_MS);
  return { count: recent.length, threshold: CLOSE_STORM_THRESHOLD, windowMs: CLOSE_STORM_WINDOW_MS };
}

export type ChipProtectionConnectionRow = {
  id: string;
  name: string;
  status: string;
  circuitState: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
  failRatePct: number;
  sentWindow: number;
  failuresWindow: number;
  inQuarantine: boolean;
  quarantineUntil: string | null;
  banCount: number;
};

export type ChipProtectionFeedItem = {
  at: string;
  level: 'ok' | 'info' | 'warn' | 'danger';
  title: string;
  detail?: string;
};

export type ChipActivitySnapshot = {
  chipQuietMode: boolean;
  chipProtectionPolicy: ChipProtectionPolicy;
  protectionReason: ChipProtectionReason | null;
  protectionReasonLabel: string;
  protectionLockUntil: string | null;
  lockRemainingMs: number | null;
  fetchedAt: string;
  nurture: { journeyEnabled: boolean; dueEnrollments: number; pausedByQuiet: boolean };
  autoWarmup: { active: boolean; connectionIds: string[]; pausedByQuiet: boolean };
  campaigns: { activeCount: number; queueHint: string };
  campaignProtection: {
    runningCount: number;
    pausedByProtection: Array<{
      campaignId: string;
      reason?: string;
      message?: string;
      autoResumeAt?: number;
    }>;
  };
  connections: ChipProtectionConnectionRow[];
  liveFeed: ChipProtectionFeedItem[];
  sync: ChipSyncProfile;
  risks: Array<{ level: 'warn' | 'info'; message: string }>;
  recommendations: string[];
};

function resolvePolicyFromSettings(settings: {
  chipProtectionPolicy?: ChipProtectionPolicy;
  chipQuietMode?: boolean;
}): ChipProtectionPolicy {
  const p = settings.chipProtectionPolicy;
  if (p === 'auto' || p === 'always' || p === 'off') return p;
  if (settings.chipQuietMode) return 'always';
  return defaultChipProtectionPolicy();
}

function lockActive(settings: { chipProtectionLockUntil?: string }): boolean {
  const raw = settings.chipProtectionLockUntil;
  if (!raw) return false;
  const until = new Date(raw).getTime();
  return Number.isFinite(until) && until > Date.now();
}

function lockReason(settings: {
  chipProtectionLockUntil?: string;
  chipProtectionLockReason?: string;
}): ChipProtectionReason | null {
  const r = String(settings.chipProtectionLockReason || '').trim();
  if (r === 'ban_cooldown' || r === 'reconnect_storm') return r;
  return lockActive(settings) ? 'ban_cooldown' : null;
}

async function countActiveCampaigns(tenantId: string): Promise<number> {
  const evo = await import('./evolutionService.js');
  return evo.countActiveCampaignsForOwner(tenantId);
}

export async function computeEffectiveProtection(tenantId: string): Promise<{
  active: boolean;
  reason: ChipProtectionReason | null;
  policy: ChipProtectionPolicy;
}> {
  const uid = String(tenantId || '').trim();
  if (!uid || uid === 'anonymous') {
    return { active: false, reason: null, policy: 'off' };
  }

  const settings = await loadTenantSettings(uid);
  const policy = resolvePolicyFromSettings(settings);

  if (policy === 'off') {
    return { active: false, reason: null, policy };
  }
  if (policy === 'always') {
    return { active: true, reason: 'policy_always', policy };
  }

  if (lockActive(settings)) {
    const lr = lockReason(settings);
    return { active: true, reason: lr || 'ban_cooldown', policy: 'auto' };
  }

  const campaigns = await countActiveCampaigns(uid);
  if (campaigns === 0) {
    return { active: true, reason: 'policy_auto_idle', policy: 'auto' };
  }

  return { active: false, reason: null, policy: 'auto' };
}

export async function refreshEffectiveProtection(tenantId: string): Promise<{
  active: boolean;
  reason: ChipProtectionReason | null;
  policy: ChipProtectionPolicy;
}> {
  const result = await computeEffectiveProtection(tenantId);
  effectiveCache.set(tenantId, { ...result, at: Date.now() });
  return result;
}

export async function isChipQuietMode(tenantId: string): Promise<boolean> {
  const cached = effectiveCache.get(tenantId);
  if (cached && Date.now() - cached.at < EFFECTIVE_CACHE_MS) return cached.active;
  const { active } = await refreshEffectiveProtection(tenantId);
  return active;
}

/** Chips conectados, fora de quarentena, aptos ao aquecimento entre si. */
/** Conta chips conectados (online) elegíveis para aquecimento, incluindo os em quarentena.
 *  O aquecimento ajuda na recuperação de chips banidos/em cooldown — quarentena não bloqueia. */
export async function countNonQuarantinedWarmupChips(
  tenantId: string,
  connectionIds: string[]
): Promise<number> {
  const ids = [...new Set(connectionIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const evo = await import('./evolutionService.js');
  const scoped = filterByConnectionScope(tenantId, evo.getConnections());
  const allowed = new Set(ids);
  let count = 0;
  for (const conn of scoped) {
    const id = String(conn.id || '').trim();
    if (!id || !allowed.has(id)) continue;
    const st = String(conn.status || '').toUpperCase();
    if (st !== 'CONNECTED' && st !== 'OPEN') continue;
    const phone = String(conn.phoneNumber || '').replace(/\D/g, '');
    if (phone.length < 10) continue;
    // Quarentena NÃO bloqueia aquecimento — chips em cooldown se beneficiam do warmup
    count++;
  }
  return count;
}

/**
 * Motivo pelo qual aquecimento está bloqueado (null = permitido).
 * Chips em quarentena, ban_cooldown e anti-ban PODEM aquecer — o aquecimento
 * ajuda na recuperação. Somente bloqueia se não houver ao menos 2 chips conectados.
 */
export async function getWarmupBlockReason(
  tenantId: string,
  connectionIds?: string[]
): Promise<string | null> {
  const { active, reason } = await refreshEffectiveProtection(tenantId);
  if (!active) return null;
  if (
    reason === 'policy_auto_idle' ||
    reason === 'policy_always' ||
    reason === 'reconnect_storm' ||
    reason === 'ban_cooldown'  // ban_cooldown também permite — o warmup ajuda na recuperação
  ) {
    return null;
  }
  return null;
}

/** Aquecimento entre chips próprios: bloqueia cooldown pós-ban só se não houver 2 chips saudáveis. */
export async function isChipProtectionBlockingWarmup(
  tenantId: string,
  connectionIds?: string[]
): Promise<boolean> {
  return (await getWarmupBlockReason(tenantId, connectionIds)) != null;
}

export function isChipQuietModeSync(tenantId: string): boolean {
  const uid = String(tenantId || '').trim();
  if (!uid) return false;
  const cached = effectiveCache.get(uid);
  if (cached && Date.now() - cached.at < EFFECTIVE_CACHE_MS) return cached.active;

  const settings = getTenantDispatchSettings(uid);
  const policy = resolvePolicyFromSettings(settings);
  if (policy === 'off') return false;
  if (policy === 'always') return true;
  if (lockActive(settings)) return true;
  // auto sem cache: assume protegido (fail-safe)
  return policy === 'auto';
}

export function invalidateChipQuietCache(tenantId: string): void {
  effectiveCache.delete(String(tenantId || '').trim());
}

export async function activateTenantProtectionLock(
  tenantId: string,
  reason: 'ban_cooldown' | 'reconnect_storm',
  hours: number
): Promise<void> {
  const uid = String(tenantId || '').trim();
  if (!uid) return;
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  await saveTenantSettings(uid, {
    chipProtectionLockUntil: until,
    chipProtectionLockReason: reason,
  } as Parameters<typeof saveTenantSettings>[1]);
  invalidateChipQuietCache(uid);
  await enforceChipProtectionSideEffects(uid);
  if (reason === 'ban_cooldown') {
    const { emitAntiBanAlert } = await import('./antiBanProactiveNotifications.js');
    await emitAntiBanAlert(uid, 'tenant-ban-cooldown-started', { hours });
  }
  console.log(`[ChipProtection] Lock ${reason} até ${until} tenant=${uid}`);
}

/** Encerra cooldown/lock manualmente (ex.: chip saudável após revisão). */
export async function clearTenantProtectionLock(tenantId: string): Promise<void> {
  const uid = String(tenantId || '').trim();
  if (!uid) return;
  await saveTenantSettings(uid, {
    chipProtectionLockUntil: '',
    chipProtectionLockReason: '',
  } as Parameters<typeof saveTenantSettings>[1]);
  invalidateChipQuietCache(uid);
  await refreshEffectiveProtection(uid);
  console.log(`[ChipProtection] Lock removido manualmente tenant=${uid}`);
}

export async function setChipProtectionPolicy(
  tenantId: string,
  policy: ChipProtectionPolicy
): Promise<{ chipProtectionPolicy: ChipProtectionPolicy }> {
  await saveTenantSettings(tenantId, { chipProtectionPolicy: policy });
  invalidateChipQuietCache(tenantId);
  await refreshEffectiveProtection(tenantId);
  await enforceChipProtectionSideEffects(tenantId);
  return { chipProtectionPolicy: policy };
}

/** @deprecated use setChipProtectionPolicy */
export async function setChipQuietMode(
  tenantId: string,
  enabled: boolean
): Promise<{ chipQuietMode: boolean }> {
  await setChipProtectionPolicy(tenantId, enabled ? 'always' : 'auto');
  return { chipQuietMode: enabled };
}

export async function enforceChipProtectionSideEffects(tenantId: string): Promise<void> {
  const { active, reason } = await refreshEffectiveProtection(tenantId);
  if (!active) return;
  // Políticas quiet/idle e instabilidade não interrompem aquecimento entre chips próprios.
  if (reason === 'policy_auto_idle' || reason === 'policy_always' || reason === 'reconnect_storm') {
    return;
  }
  if (reason !== 'ban_cooldown') return;
  const warmup = getAutoWarmupState(tenantId);
  if (!warmup.active) return;
  const eligible = await countNonQuarantinedWarmupChips(tenantId, warmup.connectionIds);
  if (eligible >= 2) return;
  stopAutoWarmup(tenantId);
}

export function onConnectionClosed(connectionId: string, wasBan: boolean): void {
  void (async () => {
    const evo = await import('./evolutionService.js');
    const ownerUid = evo.resolveConnectionOwnerUid(connectionId);
    if (!ownerUid) return;

    if (wasBan) {
      await activateTenantProtectionLock(ownerUid, 'ban_cooldown', 48);
      return;
    }

    const now = Date.now();

    // Deploy/restart do container: vários chips caem juntos — não contar como tempestade.
    if (isInDeployGraceWindow()) {
      return;
    }

    const prev = closeEventsByTenant.get(ownerUid) ?? [];
    const recent = prev.filter((t) => now - t < CLOSE_STORM_WINDOW_MS);
    recent.push(now);
    closeEventsByTenant.set(ownerUid, recent);

    if (recent.length === CLOSE_STORM_THRESHOLD - 1) {
      const { emitAntiBanAlert } = await import('./antiBanProactiveNotifications.js');
      await emitAntiBanAlert(ownerUid, 'reconnect-storm-warning', {
        dropsInWindow: recent.length,
        threshold: CLOSE_STORM_THRESHOLD,
        windowMinutes: Math.round(CLOSE_STORM_WINDOW_MS / 60_000),
      });
    }

    if (recent.length >= CLOSE_STORM_THRESHOLD) {
      closeEventsByTenant.set(ownerUid, []);
      await activateTenantProtectionLock(ownerUid, 'reconnect_storm', 6);
    }
  })();
}

export async function getSyncProfileForTenant(tenantId: string): Promise<ChipSyncProfile> {
  const { active, reason } = await refreshEffectiveProtection(tenantId);
  if (!active) return envChipSyncProfileNormal();
  if (reason === 'ban_cooldown' || reason === 'reconnect_storm') {
    return strictSyncProfile(envChipSyncProfileNormal());
  }
  return mergeSyncProfile(envChipSyncProfileNormal(), true);
}

export async function getReconnectLimitsForOwner(ownerUid: string): Promise<{
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}> {
  const quiet = await isChipQuietMode(ownerUid);
  if (!quiet) {
    return { maxAttempts: 6, baseDelayMs: 5_000, maxDelayMs: 120_000 };
  }
  const settings = await loadTenantSettings(ownerUid);
  const strict = lockActive(settings);
  return strict
    ? { maxAttempts: 2, baseDelayMs: 60_000, maxDelayMs: 600_000 }
    : { maxAttempts: 3, baseDelayMs: 30_000, maxDelayMs: 300_000 };
}

export async function shouldBlockOutboundAutomation(tenantId: string): Promise<boolean> {
  return isChipQuietMode(tenantId);
}

export async function getChipActivitySnapshot(tenantId: string): Promise<ChipActivitySnapshot> {
  const uid = String(tenantId || '').trim();
  const { active, reason, policy } = await refreshEffectiveProtection(uid);
  const sync = await getSyncProfileForTenant(uid);
  const settings = await loadTenantSettings(uid);

  let journeyEnabled = false;
  let dueEnrollments = 0;
  try {
    const journey = await getOrCreatePrimaryJourneyPg(uid);
    journeyEnabled = journey.enabled || journey.doc.enabled;
    const due = await listDueEnrollmentsPg(200);
    dueEnrollments = due.filter((r) => r.tenantId === uid).length;
  } catch {
    /* nurture opcional */
  }

  const warmup = getAutoWarmupState(uid);
  const evo = await import('./evolutionService.js');
  const activeCampaigns = evo.countActiveCampaignsForOwner(uid);
  const blockingIds = evo.listActiveBlockingCampaignIdsForOwner(uid);
  const campaignProt = evo.getCampaignProtectionSnapshot(uid);

  const risks: ChipActivitySnapshot['risks'] = [];
  const recommendations: string[] = [];

  if (policy === 'auto' && active && reason === 'policy_auto_idle') {
    recommendations.push(
      'Proteção automática ativa: chips ficam quietos enquanto não há campanha. Ao iniciar uma campanha, a proteção pausa sozinha.'
    );
  }

  if (dueEnrollments > 0 && journeyEnabled && active) {
    risks.push({
      level: 'info',
      message: `Jornada: ${dueEnrollments} envio(s) pendente(s) — bloqueados pela proteção automática.`,
    });
  } else if (dueEnrollments > 0 && journeyEnabled && !active) {
    risks.push({
      level: 'warn',
      message: `Jornada: ${dueEnrollments} envio(s) pendente(s) — campanha ativa suspendeu a proteção.`,
    });
  }

  if (active && reason === 'ban_cooldown') {
    const eligibleWarmup = await countNonQuarantinedWarmupChips(uid, warmup.connectionIds);
    if (eligibleWarmup >= 2) {
      risks.push({
        level: 'info',
        message:
          'Cooldown pós-ban: campanhas e jornada pausadas; aquecimento permitido entre chips saudáveis.',
      });
    } else if (warmup.active) {
      risks.push({
        level: 'info',
        message: 'Auto-aquecimento pausado — inclua ≥2 chips fora de quarentena para aquecer.',
      });
    }
  } else if (warmup.active && reason === 'reconnect_storm') {
    risks.push({
      level: 'info',
      message: 'Auto-aquecimento ativo — instabilidade recente; campanhas desaceleradas, aquecimento segue.',
    });
  } else if (warmup.active) {
    risks.push({
      level: 'warn',
      message: `Auto-aquecimento ativo em ${warmup.connectionIds.length} chip(s).`,
    });
  }

  if (campaignProt.protectionPaused.length > 0) {
    for (const p of campaignProt.protectionPaused) {
      risks.push({
        level: 'warn',
        message: `Campanha ${p.campaignId} pausada pela proteção: ${p.message || p.reason || 'risco detectado'}`,
      });
    }
  }

  if (activeCampaigns > 0) {
    risks.push({
      level: 'warn',
      message: `${activeCampaigns} campanha(s) em execução (${blockingIds.slice(0, 3).join(', ') || '—'}).`,
    });
  }

  if (sync.fullHistory && !active) {
    risks.push({
      level: 'info',
      message: 'Sync de histórico completo ativo ao conectar chip.',
    });
  }

  if (reason === 'ban_cooldown') {
    risks.push({
      level: 'warn',
      message: 'Banimento recente detectado — cooldown de 48h com sync mínimo e reconexão lenta.',
    });
  }

  if (reason === 'reconnect_storm') {
    risks.push({
      level: 'warn',
      message: 'Várias quedas seguidas — proteção reforçada por 6h.',
    });
  }

  const stormProgress = getReconnectStormProgress(uid);
  if (stormProgress.count >= stormProgress.threshold - 1 && stormProgress.count < stormProgress.threshold) {
    risks.push({
      level: 'warn',
      message: `Aviso preventivo: ${stormProgress.count}/${stormProgress.threshold} quedas em 30 min — mais uma queda ativa proteção reforçada.`,
    });
  }

  if (!active && policy === 'auto' && activeCampaigns === 0) {
    recommendations.push('Nenhuma campanha ativa — a proteção automática deve ativar em instantes.');
  }

  const lockUntil =
    settings.chipProtectionLockUntil && lockActive(settings)
      ? settings.chipProtectionLockUntil
      : null;
  const lockRemainingMs = lockUntil
    ? Math.max(0, new Date(lockUntil).getTime() - Date.now())
    : null;

  const fetchedAt = new Date().toISOString();
  const cb = getChipCircuitBreaker();
  const connectionRows: ChipProtectionConnectionRow[] = [];
  const scopedConns = filterByConnectionScope(uid, evo.getConnections());
  for (const conn of scopedConns) {
    const id = String(conn.id || '').trim();
    if (!id) continue;
    const banInfo = evo.getConnectionBanInfo(id);
    const score = await cb.getHealthScore(id);
    connectionRows.push({
      id,
      name: String(conn.name || id),
      status: String(conn.status || 'unknown'),
      circuitState: score.state,
      failRatePct: Math.round(score.failRate * 1000) / 10,
      sentWindow: score.sent,
      failuresWindow: score.failures,
      inQuarantine: banInfo.inQuarantine,
      quarantineUntil:
        banInfo.quarantineUntil && banInfo.quarantineUntil > Date.now()
          ? new Date(banInfo.quarantineUntil).toISOString()
          : null,
      banCount: banInfo.banCount,
    });
  }

  const hardLock = reason === 'ban_cooldown';

  const liveFeed: ChipProtectionFeedItem[] = [];
  if (reason === 'reconnect_storm') {
    liveFeed.push({
      at: fetchedAt,
      level: 'danger',
      title: 'Instabilidade detectada',
      detail: 'Várias quedas seguidas — envios desacelerados ou pausados por até 6h.',
    });
  } else if (reason === 'ban_cooldown') {
    liveFeed.push({
      at: fetchedAt,
      level: 'danger',
      title: 'Cooldown pós-banimento',
      detail: 'Campanhas pausadas por 48h após ban detectado no WhatsApp.',
    });
  } else if (active && reason === 'policy_auto_idle') {
    liveFeed.push({
      at: fetchedAt,
      level: 'ok',
      title: 'Chips quietos (sem campanha)',
      detail: 'Jornada e nutrição pausadas. Ao iniciar campanha, libera automaticamente.',
    });
  } else if (!active && activeCampaigns > 0) {
    liveFeed.push({
      at: fetchedAt,
      level: 'info',
      title: 'Campanha em execução',
      detail: 'Proteção monitora falhas, texto duplicado e saúde dos chips em tempo real.',
    });
  } else if (!active) {
    liveFeed.push({
      at: fetchedAt,
      level: 'info',
      title: 'Envios liberados',
      detail: 'Nenhuma trava de proteção ativa neste momento.',
    });
  }

  for (const row of connectionRows) {
    if (row.inQuarantine) {
      liveFeed.push({
        at: fetchedAt,
        level: 'danger',
        title: `${row.name} em quarentena`,
        detail: row.quarantineUntil
          ? `Até ${new Date(row.quarantineUntil).toLocaleString('pt-BR')}`
          : 'Aguardando fim da quarentena pós-ban.',
      });
    } else if (row.circuitState === 'OPEN') {
      liveFeed.push({
        at: fetchedAt,
        level: 'warn',
        title: `${row.name} — circuit breaker aberto`,
        detail: `Taxa de falha ${row.failRatePct}% (${row.failuresWindow} falhas na janela).`,
      });
    } else if (row.circuitState === 'HALF_OPEN') {
      liveFeed.push({
        at: fetchedAt,
        level: 'warn',
        title: `${row.name} — recuperação`,
        detail: `Monitorando estabilidade (${row.failRatePct}% falhas).`,
      });
    } else if (row.status !== 'CONNECTED' && row.status !== 'CONNECTING') {
      liveFeed.push({
        at: fetchedAt,
        level: 'warn',
        title: `${row.name} offline`,
        detail: `Status: ${row.status}`,
      });
    }
  }

  for (const p of campaignProt.protectionPaused) {
    liveFeed.push({
      at: fetchedAt,
      level: 'warn',
      title: `Campanha pausada (${p.campaignId})`,
      detail: p.message || p.reason,
    });
  }

  if (warmup.active) {
    liveFeed.push({
      at: fetchedAt,
      level: 'info',
      title: 'Auto-aquecimento ativo',
      detail: `${warmup.connectionIds.length} chip(s) trocando mensagens entre si.`,
    });
  }

  return {
    chipQuietMode: active,
    chipProtectionPolicy: policy,
    protectionReason: reason,
    protectionReasonLabel: chipProtectionReasonLabel(reason),
    protectionLockUntil: lockUntil,
    lockRemainingMs,
    fetchedAt,
    nurture: {
      journeyEnabled,
      dueEnrollments,
      pausedByQuiet: active && dueEnrollments > 0,
    },
    autoWarmup: {
      active: warmup.active,
      connectionIds: warmup.connectionIds,
      pausedByQuiet: hardLock && warmup.active,
    },
    campaigns: {
      activeCount: activeCampaigns,
      queueHint:
        activeCampaigns > 0
          ? 'Campanha ativa — proteção monitora risco e pode pausar automaticamente.'
          : 'Sem campanha — proteção automática mantém chips quietos.',
    },
    campaignProtection: {
      runningCount: campaignProt.running,
      pausedByProtection: campaignProt.protectionPaused,
    },
    connections: connectionRows,
    liveFeed: liveFeed.slice(0, 12),
    sync,
    risks,
    recommendations,
  };
}

export async function refreshAllKnownTenantProtections(): Promise<void> {
  const evo = await import('./evolutionService.js');
  const owners = evo.listConnectionOwnerUids();
  for (const uid of owners) {
    await enforceChipProtectionSideEffects(uid);
  }
}

/** Watchdog: alertas preventivos (HALF_OPEN, offline prolongado) — dedupe via Redis no emitAntiBanAlert. */
export async function tickChipEarlyWarningWatchdog(): Promise<void> {
  const evo = await import('./evolutionService.js');
  const { emitAntiBanAlert } = await import('./antiBanProactiveNotifications.js');
  const cb = getChipCircuitBreaker();
  const owners = evo.listConnectionOwnerUids();

  for (const uid of owners) {
    const scopedConns = filterByConnectionScope(uid, evo.getConnections());
    for (const conn of scopedConns) {
      const id = String(conn.id || '').trim();
      if (!id) continue;

      const score = await cb.getHealthScore(id);
      if (score.state === 'HALF_OPEN') {
        await emitAntiBanAlert(uid, 'chip-circuit-breaker-half-open', {
          connectionId: id,
          connectionLabel: String(conn.name || id),
          failRatePct: Math.round(score.failRate * 1000) / 10,
        });
      }
    }
  }
}
