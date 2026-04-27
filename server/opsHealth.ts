/**
 * Lógica partilhada: alertas operacionais (UI admin, contadores Prometheus).
 */

export type AdminOpsAlertLevel = 'warn' | 'critical';

export type AdminOpsAlert = {
  level: AdminOpsAlertLevel;
  code: string;
  message: string;
};

export function getChannelCapacityHeuristic(ramTotalGb: number): { safe: number; critical: number } {
  const gb = ramTotalGb ?? 0;
  if (gb <= 0) return { safe: 3, critical: 5 };
  if (gb <= 4) return { safe: 2, critical: 3 };
  if (gb <= 8) return { safe: 5, critical: 7 };
  if (gb <= 16) return { safe: 10, critical: 14 };
  if (gb <= 32) return { safe: 20, critical: 26 };
  if (gb <= 64) return { safe: 40, critical: 52 };
  return { safe: Math.floor(gb * 0.6), critical: Math.floor(gb * 0.8) };
}

export function buildAlerts(input: {
  ramPct: number;
  load1: number;
  cpuCount: number;
  heapMb: number;
  firebaseConfigured: boolean;
  firebasePingOk: boolean;
  firebaseError?: string;
  connectedSessions: number;
  safeSessionRef: number;
}): AdminOpsAlert[] {
  const alerts: AdminOpsAlert[] = [];
  const {
    ramPct,
    load1,
    cpuCount,
    heapMb,
    firebaseConfigured,
    firebasePingOk,
    firebaseError,
    connectedSessions,
    safeSessionRef
  } = input;

  if (firebaseConfigured && !firebasePingOk) {
    alerts.push({
      level: 'critical',
      code: 'firebase',
      message: `Firebase (Admin API): ${firebaseError || 'falha no ping'}. Risco a login, assinaturas e dados.`
    });
  }

  if (ramPct >= 92) {
    alerts.push({
      level: 'critical',
      code: 'ram',
      message: `RAM do ambiente do processo em ~${ramPct}%. Risco de OOM e travamentos.`
    });
  } else if (ramPct >= 85) {
    alerts.push({
      level: 'warn',
      code: 'ram',
      message: `RAM do ambiente do processo em ~${ramPct}%. Monitore swap e canais WhatsApp.`
    });
  }

  const loadRatio = load1 / Math.max(1, cpuCount);
  if (loadRatio >= 4) {
    alerts.push({
      level: 'critical',
      code: 'load',
      message: `Load average 1m (${load1.toFixed(1)}) muito acima de ${cpuCount} CPU(s). Fila de trabalho crítica.`
    });
  } else if (loadRatio >= 2) {
    alerts.push({
      level: 'warn',
      code: 'load',
      message: `Load average 1m (${load1.toFixed(1)}) elevado para ${cpuCount} CPU(s).`
    });
  }

  if (heapMb >= 2000) {
    alerts.push({
      level: 'warn',
      code: 'heap',
      message: `Heap do Node ~${heapMb} MB. Verifique vazamento ou carga anormal.`
    });
  }

  if (connectedSessions > safeSessionRef * 1.4) {
    alerts.push({
      level: 'warn',
      code: 'sessions',
      message: `~${connectedSessions} sessões WA ligadas; referência de conforto ~${safeSessionRef} (heurística).`
    });
  }

  return alerts;
}

export function countAlertLevels(alerts: AdminOpsAlert[]): { critical: number; warn: number } {
  let critical = 0;
  let warn = 0;
  for (const a of alerts) {
    if (a.level === 'critical') critical += 1;
    else warn += 1;
  }
  return { critical, warn };
}
