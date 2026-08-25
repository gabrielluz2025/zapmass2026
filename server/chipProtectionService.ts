import {
  envChipSyncProfileNormal,
  mergeSyncProfile,
  type ChipSyncProfile
} from '../shared/chipProtection.js';
import { getTenantDispatchSettings, loadTenantSettings } from './tenantSettings.js';
import { getAutoWarmupState, stopAutoWarmup } from './whatsappService.js';
import { listDueEnrollmentsPg } from './nurture/nurtureRepository.js';
import { getOrCreatePrimaryJourneyPg } from './nurture/nurtureRepository.js';

const quietCache = new Map<string, { value: boolean; at: number }>();
const QUIET_CACHE_MS = 15_000;

export type ChipActivitySnapshot = {
  chipQuietMode: boolean;
  nurture: { journeyEnabled: boolean; dueEnrollments: number; pausedByQuiet: boolean };
  autoWarmup: { active: boolean; connectionIds: string[]; pausedByQuiet: boolean };
  campaigns: { activeCount: number; queueHint: string };
  sync: ChipSyncProfile;
  risks: Array<{ level: 'warn' | 'info'; message: string }>;
  recommendations: string[];
};

export async function isChipQuietMode(tenantId: string): Promise<boolean> {
  const uid = String(tenantId || '').trim();
  if (!uid || uid === 'anonymous') return false;

  const cached = quietCache.get(uid);
  if (cached && Date.now() - cached.at < QUIET_CACHE_MS) return cached.value;

  const settings = await loadTenantSettings(uid);
  const quiet = Boolean((settings as { chipQuietMode?: boolean }).chipQuietMode);
  quietCache.set(uid, { value: quiet, at: Date.now() });
  return quiet;
}

export function isChipQuietModeSync(tenantId: string): boolean {
  const uid = String(tenantId || '').trim();
  if (!uid) return false;
  const cached = quietCache.get(uid);
  if (cached && Date.now() - cached.at < QUIET_CACHE_MS) return cached.value;
  const settings = getTenantDispatchSettings(uid);
  return Boolean((settings as { chipQuietMode?: boolean }).chipQuietMode);
}

export function invalidateChipQuietCache(tenantId: string): void {
  quietCache.delete(String(tenantId || '').trim());
}

export async function setChipQuietMode(
  tenantId: string,
  enabled: boolean
): Promise<{ chipQuietMode: boolean }> {
  const { saveTenantSettings } = await import('./tenantSettings.js');
  await saveTenantSettings(tenantId, { chipQuietMode: enabled });
  invalidateChipQuietCache(tenantId);
  if (enabled) {
    const warmup = getAutoWarmupState(tenantId);
    if (warmup.active) stopAutoWarmup(tenantId);
  }
  return { chipQuietMode: enabled };
}

export async function getSyncProfileForTenant(tenantId: string): Promise<ChipSyncProfile> {
  const quiet = await isChipQuietMode(tenantId);
  return mergeSyncProfile(envChipSyncProfileNormal(), quiet);
}

export async function shouldBlockOutboundAutomation(tenantId: string): Promise<boolean> {
  return isChipQuietMode(tenantId);
}

export async function getChipActivitySnapshot(tenantId: string): Promise<ChipActivitySnapshot> {
  const uid = String(tenantId || '').trim();
  const chipQuietMode = await isChipQuietMode(uid);
  const sync = mergeSyncProfile(envChipSyncProfileNormal(), chipQuietMode);

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

  if (dueEnrollments > 0 && journeyEnabled) {
    risks.push({
      level: 'warn',
      message: `Jornada de nutrição: ${dueEnrollments} envio(s) pendente(s) — dispara automaticamente a cada 30s.`,
    });
    if (!chipQuietMode) {
      recommendations.push('Ative o Modo chip quieto ou desligue a jornada se não quer envios automáticos.');
    }
  }

  if (warmup.active) {
    risks.push({
      level: 'warn',
      message: `Auto-aquecimento ativo em ${warmup.connectionIds.length} chip(s).`,
    });
    recommendations.push('Pare o auto-aquecimento quando os chips devem ficar parados.');
  }

  if (activeCampaigns > 0) {
    risks.push({
      level: 'warn',
      message: `${activeCampaigns} campanha(s) em execução (${blockingIds.slice(0, 3).join(', ') || '—'}).`,
    });
  }

  if (sync.fullHistory) {
    risks.push({
      level: 'info',
      message: 'Sync de histórico completo ativo ao conectar chip (stress no WhatsApp).',
    });
    recommendations.push(
      'Defina EVOLUTION_SYNC_FULL_HISTORY=0 na VPS ou use Modo chip quieto para sync leve.'
    );
  }

  if (chipQuietMode) {
    recommendations.push(
      'Modo chip quieto ON: sync leve, jornada e auto-aquecimento pausados para este workspace.'
    );
  } else if (risks.length === 0) {
    recommendations.push('Nenhuma atividade de alto risco detectada no momento.');
  }

  return {
    chipQuietMode,
    nurture: {
      journeyEnabled,
      dueEnrollments,
      pausedByQuiet: chipQuietMode && dueEnrollments > 0,
    },
    autoWarmup: {
      active: warmup.active,
      connectionIds: warmup.connectionIds,
      pausedByQuiet: chipQuietMode && warmup.active,
    },
    campaigns: {
      activeCount: activeCampaigns,
      queueHint:
        activeCampaigns > 0
          ? 'Campanhas ativas consomem a fila de envio.'
          : 'Nenhuma campanha em execução no momento.',
    },
    sync,
    risks,
    recommendations,
  };
}
