/**
 * Diagnóstico pré-aquecimento — identifica riscos antes de iniciar auto-warmup.
 */
import { filterByConnectionScope } from './connectionScopeServer.js';
import {
  getReconnectStormProgress,
  refreshEffectiveProtection,
} from './chipProtectionService.js';
import { getChipCircuitBreaker } from './chipCircuitBreaker.js';
import { getTenantDispatchSettings } from './tenantSettings.js';
import { isBrazilNightHour } from './sleepModeService.js';
import { getAutoWarmupState } from './whatsappService.js';
import { getWarmupChipStats } from './whatsappService.js';

export type WarmupDiagnosticSeverity = 'blocker' | 'warning' | 'info';

export type WarmupDiagnosticFinding = {
  code: string;
  severity: WarmupDiagnosticSeverity;
  title: string;
  detail: string;
  connectionId?: string;
  recommendation?: string;
};

export type WarmupDiagnosticChipRow = {
  connectionId: string;
  name: string;
  phone: string;
  status: string;
  selected: boolean;
  connected: boolean;
  connectedSinceMs: number | null;
  connectedAgeMinutes: number | null;
  banCount: number;
  inQuarantine: boolean;
  quarantineUntil: string | null;
  circuitState: 'CLOSED' | 'HALF_OPEN' | 'OPEN' | 'unknown';
  warmupFailedTotal: number;
  warmupSentTotal: number;
  goConnected: boolean | null;
};

export type WarmupDiagnosticReport = {
  ok: boolean;
  canStart: boolean;
  summary: string;
  intervalMinutes: number;
  selectedCount: number;
  eligibleConnectedCount: number;
  pairCount: number;
  fetchedAt: string;
  chips: WarmupDiagnosticChipRow[];
  findings: WarmupDiagnosticFinding[];
  recommendations: string[];
};

const MIN_STABLE_MINUTES = 10;
const AGGRESSIVE_INTERVAL_MAX = 5;

function pushFinding(
  findings: WarmupDiagnosticFinding[],
  finding: WarmupDiagnosticFinding
): void {
  findings.push(finding);
}

export async function buildWarmupDiagnostics(
  tenantId: string,
  connectionIds: string[],
  intervalMinutes = 15
): Promise<WarmupDiagnosticReport> {
  const uid = String(tenantId || '').trim();
  const selected = [...new Set(connectionIds.filter(Boolean))];
  const interval = Math.max(1, Math.min(120, Number(intervalMinutes) || 15));
  const findings: WarmupDiagnosticFinding[] = [];
  const recommendations: string[] = [];

  const evo = await import('./evolutionService.js');
  const dispatch = getTenantDispatchSettings(uid);
  const protection = await refreshEffectiveProtection(uid);
  const storm = getReconnectStormProgress(uid);
  const warmupState = getAutoWarmupState(uid);
  const statsByConn = new Map(getWarmupChipStats().map((s) => [s.connectionId, s]));
  const cb = getChipCircuitBreaker();

  const scoped = filterByConnectionScope(uid, evo.getConnections());
  const connById = new Map(scoped.map((c) => [String(c.id || '').trim(), c]));

  let goByName = new Map<string, { connected: boolean }>();
  try {
    const raw = await evo.listGoInstancesRaw();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const name = String(row.name || row.instanceName || '').trim();
      if (!name) continue;
      goByName.set(name, { connected: row.connected === true });
    }
  } catch {
    /* Go indisponível — diagnóstico segue sem essa camada */
  }

  const chips: WarmupDiagnosticChipRow[] = [];

  for (const conn of scoped) {
    const id = String(conn.id || '').trim();
    if (!id) continue;
    const banInfo = evo.getConnectionBanInfo(id);
    const since = evo.getConnectionConnectedSince(id);
    const ageMin =
      typeof since === 'number' && since > 0
        ? Math.floor((Date.now() - since) / 60_000)
        : null;
    const st = String(conn.status || '').toUpperCase();
    const connected = st === 'CONNECTED' || st === 'OPEN';
    const phone = String(conn.phoneNumber || '').replace(/\D/g, '');
    const stat = statsByConn.get(id);
    let circuitState: WarmupDiagnosticChipRow['circuitState'] = 'unknown';
    try {
      const score = await cb.getHealthScore(id);
      circuitState = score.state;
    } catch {
      circuitState = 'unknown';
    }
    const go = goByName.get(id);

    chips.push({
      connectionId: id,
      name: String(conn.name || conn.friendlyName || id),
      phone,
      status: st || 'UNKNOWN',
      selected: selected.includes(id),
      connected,
      connectedSinceMs: since ?? null,
      connectedAgeMinutes: ageMin,
      banCount: banInfo.banCount,
      inQuarantine: banInfo.inQuarantine,
      quarantineUntil:
        banInfo.quarantineUntil && banInfo.quarantineUntil > Date.now()
          ? new Date(banInfo.quarantineUntil).toISOString()
          : null,
      circuitState,
      warmupFailedTotal: stat?.totalFailed ?? 0,
      warmupSentTotal: stat?.totalSent ?? 0,
      goConnected: go ? go.connected : null,
    });
  }

  const selectedChips = chips.filter((c) => c.selected);
  const eligibleSelected = selectedChips.filter(
    (c) => c.connected && c.phone.length >= 10
  );
  const pairCount =
    eligibleSelected.length >= 2
      ? (eligibleSelected.length * (eligibleSelected.length - 1)) / 2
      : 0;

  if (selected.length < 2) {
    pushFinding(findings, {
      code: 'NEED_TWO_CHIPS',
      severity: 'blocker',
      title: 'Menos de 2 chips selecionados',
      detail: `Selecionados: ${selected.length}. O aquecimento precisa de ao menos 2 chips.`,
      recommendation: 'Ative 2 ou mais chips na aba Aquecimento antes de iniciar.',
    });
  }

  if (selected.length >= 2 && eligibleSelected.length < 2) {
    const offline = selectedChips.filter((c) => !c.connected);
    for (const c of offline) {
      pushFinding(findings, {
        code: 'CHIP_OFFLINE',
        severity: 'blocker',
        title: 'Chip selecionado offline',
        detail: `${c.name} (${c.connectionId}) está ${c.status}.`,
        connectionId: c.connectionId,
        recommendation:
          'Reconecte na UI (QR) ou rode KEEP=<id> bash deployment/vps-reconnect-single-chip.sh na VPS.',
      });
    }
    const noPhone = selectedChips.filter((c) => c.connected && c.phone.length < 10);
    for (const c of noPhone) {
      pushFinding(findings, {
        code: 'CHIP_NO_PHONE',
        severity: 'blocker',
        title: 'Chip sem número pareado',
        detail: `${c.name} conectado mas sem telefone válido.`,
        connectionId: c.connectionId,
        recommendation: 'Aguarde pareamento completo ou escaneie QR novamente.',
      });
    }
  }

  for (const c of selectedChips) {
    if (c.connectedAgeMinutes != null && c.connectedAgeMinutes < MIN_STABLE_MINUTES) {
      pushFinding(findings, {
        code: 'CHIP_TOO_NEW',
        severity: 'warning',
        title: 'Chip recém-conectado',
        detail: `${c.name} pareado há ~${c.connectedAgeMinutes} min (ideal: ≥${MIN_STABLE_MINUTES} min).`,
        connectionId: c.connectionId,
        recommendation:
          'Espere 10–15 min após o QR antes de aquecer — disparo imediato aumenta risco de queda/ban.',
      });
    }
    if (c.goConnected === false) {
      pushFinding(findings, {
        code: 'GO_INSTANCE_OFF',
        severity: 'warning',
        title: 'Evolution Go reporta chip OFF',
        detail: `${c.name}: instância existe no Go mas connected=OFF.`,
        connectionId: c.connectionId,
        recommendation: 'Rode reconnect na VPS ou QR na UI antes do aquecimento.',
      });
    }
    if (c.banCount > 0) {
      pushFinding(findings, {
        code: 'BAN_HISTORY',
        severity: c.banCount >= 2 ? 'warning' : 'info',
        title: 'Histórico de banimento',
        detail: `${c.name}: ${c.banCount} ban(s) registrado(s).`,
        connectionId: c.connectionId,
        recommendation: 'Use intervalo ≥15 min, só 2 chips no início, sem campanhas paralelas.',
      });
    }
    if (c.inQuarantine) {
      pushFinding(findings, {
        code: 'QUARANTINE',
        severity: 'info',
        title: 'Chip em quarentena de campanhas',
        detail: `${c.name} em cooldown até ${c.quarantineUntil ? new Date(c.quarantineUntil).toLocaleString('pt-BR') : '—'}.`,
        connectionId: c.connectionId,
        recommendation: 'Aquecimento entre chips próprios ainda é permitido — evite campanhas neste chip.',
      });
    }
    if (c.circuitState === 'OPEN') {
      pushFinding(findings, {
        code: 'CIRCUIT_OPEN',
        severity: 'warning',
        title: 'Circuit breaker aberto',
        detail: `${c.name}: muitas falhas recentes — envios podem falhar.`,
        connectionId: c.connectionId,
        recommendation: 'Configurações → Proteção → resetar circuit ou aguarde recuperação.',
      });
    }
    if (c.warmupFailedTotal >= 5 && c.warmupSentTotal === 0) {
      pushFinding(findings, {
        code: 'WARMUP_SEND_FAILS',
        severity: 'warning',
        title: 'Falhas repetidas no aquecimento',
        detail: `${c.name}: ${c.warmupFailedTotal} falha(s) registrada(s), 0 envios OK.`,
        connectionId: c.connectionId,
        recommendation: 'Verifique se o chip está ON no Go e se os números destino existem no WhatsApp.',
      });
    }
  }

  const phones = new Map<string, string[]>();
  for (const c of eligibleSelected) {
    const list = phones.get(c.phone) ?? [];
    list.push(c.connectionId);
    phones.set(c.phone, list);
  }
  for (const [phone, ids] of phones) {
    if (ids.length > 1) {
      pushFinding(findings, {
        code: 'DUPLICATE_PHONE',
        severity: 'blocker',
        title: 'Dois chips com o mesmo número',
        detail: `Número ${phone} repetido em: ${ids.join(', ')}.`,
        recommendation: 'Remova duplicata — aquecimento entre clones dispara alertas no WhatsApp.',
      });
    }
  }

  if (interval <= AGGRESSIVE_INTERVAL_MAX && eligibleSelected.length >= 3) {
    pushFinding(findings, {
      code: 'INTERVAL_AGGRESSIVE',
      severity: 'warning',
      title: 'Intervalo curto para muitos chips',
      detail: `${interval} min com ${eligibleSelected.length} chips = ${pairCount} pares por rodada.`,
      recommendation: 'Use intervalo base 15–30 min com 4 chips; 5 min só com 2 chips novos.',
    });
  }

  if (dispatch.sleepMode && isBrazilNightHour()) {
    pushFinding(findings, {
      code: 'SLEEP_MODE_NIGHT',
      severity: 'info',
      title: 'Modo silêncio noturno ativo',
      detail: 'Rodadas ficam pausadas entre 20h e 8h (BRT). O timer continua ativo.',
      recommendation: 'Normal — evita padrão robótico de madrugada.',
    });
  }

  if (protection.active && protection.reason === 'ban_cooldown') {
    pushFinding(findings, {
      code: 'TENANT_BAN_COOLDOWN',
      severity: 'info',
      title: 'Cooldown pós-ban no workspace',
      detail: 'Campanhas pausadas 48h; aquecimento entre chips permitido.',
      recommendation: 'Priorize aquecimento lento (15–30 min) em vez de campanhas.',
    });
  }

  if (protection.active && protection.reason === 'reconnect_storm') {
    pushFinding(findings, {
      code: 'RECONNECT_STORM',
      severity: 'warning',
      title: 'Proteção por quedas seguidas',
      detail: 'Várias desconexões recentes — sync e reconexão desacelerados.',
      recommendation: 'Estabilize chips antes de aquecer; evite deploy/restart agora.',
    });
  }

  if (storm.count >= storm.threshold - 1) {
    pushFinding(findings, {
      code: 'STORM_NEAR',
      severity: 'warning',
      title: 'Quedas recentes de chips',
      detail: `${storm.count}/${storm.threshold} quedas em 30 min — mais uma ativa lock de 6h.`,
      recommendation: 'Não reinicie containers; reconecte só chips OFF.',
    });
  }

  const activeCampaigns = evo.countActiveCampaignsForOwner(uid);
  if (activeCampaigns > 0) {
    pushFinding(findings, {
      code: 'CAMPAIGNS_ACTIVE',
      severity: 'warning',
      title: 'Campanhas em execução',
      detail: `${activeCampaigns} campanha(s) ativa(s) no mesmo workspace.`,
      recommendation: 'Pause campanhas durante aquecimento de chips novos — carga dupla aumenta ban.',
    });
  }

  if (warmupState.active) {
    pushFinding(findings, {
      code: 'ALREADY_RUNNING',
      severity: 'info',
      title: 'Aquecimento já ativo no servidor',
      detail: `${warmupState.connectionIds.length} chip(s), intervalo ~${warmupState.intervalMinutes} min.`,
      recommendation: 'Pare e inicie de novo se alterou chips ou intervalo.',
    });
  }

  if (eligibleSelected.length >= 2 && findings.every((f) => f.severity !== 'blocker')) {
    recommendations.push(
      'Configuração sugerida: intervalo 15–30 min, modo silêncio ON, 2 chips nos primeiros 3 dias.',
    );
    if (eligibleSelected.some((c) => (c.connectedAgeMinutes ?? 999) < MIN_STABLE_MINUTES)) {
      recommendations.push('Aguarde estabilização pós-QR antes de clicar Iniciar.');
    }
  }

  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const canStart = blockers.length === 0 && eligibleSelected.length >= 2;

  let summary: string;
  if (blockers.length > 0) {
    summary = `${blockers.length} bloqueio(s) — corrija antes de aquecer.`;
  } else if (warnings.length > 0) {
    summary = `Pode aquecer com cautela — ${warnings.length} aviso(s).`;
  } else if (eligibleSelected.length >= 2) {
    summary = 'Pronto para aquecer — nenhum risco crítico detectado.';
  } else {
    summary = 'Selecione e conecte ao menos 2 chips.';
  }

  return {
    ok: true,
    canStart,
    summary,
    intervalMinutes: interval,
    selectedCount: selected.length,
    eligibleConnectedCount: eligibleSelected.length,
    pairCount,
    fetchedAt: new Date().toISOString(),
    chips,
    findings,
    recommendations,
  };
}
