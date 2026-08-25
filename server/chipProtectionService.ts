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

const effectiveCache = new Map<
  string,
  { active: boolean; reason: ChipProtectionReason | null; policy: ChipProtectionPolicy; at: number }
>();
const EFFECTIVE_CACHE_MS = 30_000;

const closeEventsByTenant = new Map<string, number[]>();
const CLOSE_STORM_WINDOW_MS = 30 * 60 * 1000;
const CLOSE_STORM_THRESHOLD = 3;

export type ChipActivitySnapshot = {
  chipQuietMode: boolean;
  chipProtectionPolicy: ChipProtectionPolicy;
  protectionReason: ChipProtectionReason | null;
  protectionReasonLabel: string;
  protectionLockUntil: string | null;
  nurture: { journeyEnabled: boolean; dueEnrollments: number; pausedByQuiet: boolean };
  autoWarmup: { active: boolean; connectionIds: string[]; pausedByQuiet: boolean };
  campaigns: { activeCount: number; queueHint: string };
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
  console.log(`[ChipProtection] Lock ${reason} até ${until} tenant=${uid}`);
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
  const { active } = await refreshEffectiveProtection(tenantId);
  if (!active) return;
  const warmup = getAutoWarmupState(tenantId);
  if (warmup.active) stopAutoWarmup(tenantId);
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
    const prev = closeEventsByTenant.get(ownerUid) ?? [];
    const recent = prev.filter((t) => now - t < CLOSE_STORM_WINDOW_MS);
    recent.push(now);
    closeEventsByTenant.set(ownerUid, recent);

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

  if (warmup.active && active) {
    risks.push({
      level: 'info',
      message: 'Auto-aquecimento será parado pela proteção automática.',
    });
  } else if (warmup.active) {
    risks.push({
      level: 'warn',
      message: `Auto-aquecimento ativo em ${warmup.connectionIds.length} chip(s).`,
    });
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

  if (!active && policy === 'auto' && activeCampaigns === 0) {
    recommendations.push('Nenhuma campanha ativa — a proteção automática deve ativar em instantes.');
  }

  const lockUntil =
    settings.chipProtectionLockUntil && lockActive(settings)
      ? settings.chipProtectionLockUntil
      : null;

  return {
    chipQuietMode: active,
    chipProtectionPolicy: policy,
    protectionReason: reason,
    protectionReasonLabel: chipProtectionReasonLabel(reason),
    protectionLockUntil: lockUntil,
    nurture: {
      journeyEnabled,
      dueEnrollments,
      pausedByQuiet: active && dueEnrollments > 0,
    },
    autoWarmup: {
      active: warmup.active,
      connectionIds: warmup.connectionIds,
      pausedByQuiet: active && warmup.active,
    },
    campaigns: {
      activeCount: activeCampaigns,
      queueHint:
        activeCampaigns > 0
          ? 'Campanha ativa — proteção automática pausada para permitir envios.'
          : 'Sem campanha — proteção automática mantém chips quietos.',
    },
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
