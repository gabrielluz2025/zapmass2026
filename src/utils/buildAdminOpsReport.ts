import { apiUrl } from './apiBase';

export type AdminOpsReportBundle = {
  geradoEm: string;
  tela: 'admin-ops';
  opsSnapshot: unknown;
  vpsMaintenance: unknown;
  resumoTexto: string;
};

const DEFAULT_QUESTION =
  'Analise o relatório de servidor e alertas anexado. Diga se a operação está normal, o que merece atenção e quais passos recomenda (se houver).';

export function adminOpsAssistantQuestion(): string {
  return DEFAULT_QUESTION;
}

function fmtAlerts(alerts: unknown): string {
  if (!Array.isArray(alerts) || alerts.length === 0) return 'Nenhum alerta ativo.';
  return alerts
    .map((a) => {
      if (a && typeof a === 'object' && 'message' in a) return `- ${String((a as { message: string }).message)}`;
      return `- ${String(a)}`;
    })
    .join('\n');
}

export function formatAdminOpsReportMarkdown(bundle: AdminOpsReportBundle): string {
  const ops = bundle.opsSnapshot as {
    at?: string;
    system?: { load1?: number; load5?: number; load15?: number; cpus?: number; ram?: number; cpu?: number };
    alerts?: Array<{ level?: string; message?: string }>;
    whatsapp?: { connectedSessions?: number };
  } | null;
  const vps = bundle.vpsMaintenance as {
    operatingStatus?: string;
    incidentNote?: string;
    live?: { load1?: number; load15?: number; indexOk?: boolean | null };
    lastSnapshot?: {
      at?: string;
      ok?: boolean;
      load1?: number;
      postgresCpuPct?: number | null;
      indexOk?: boolean;
      evolutionRecovered?: boolean;
      issueCount?: number;
    };
    alerts?: Array<{ message?: string }>;
  } | null;

  const lines: string[] = [
    '# Relatório ZapMass — Servidor & alertas',
    `Gerado em: ${bundle.geradoEm}`,
    '',
    '## Status operacional',
    `- Painel VPS: **${vps?.operatingStatus ?? '—'}**`,
    vps?.incidentNote ? `- Nota: ${vps.incidentNote}` : '',
    '',
    '## Host (ops-snapshot)',
    ops?.system
      ? `- Load 1/5/15m: ${ops.system.load1?.toFixed(2) ?? '—'} / ${ops.system.load5?.toFixed(2) ?? '—'} / ${ops.system.load15?.toFixed(2) ?? '—'} (${ops.system.cpus ?? '?'} CPUs)`
      : '- Ops snapshot indisponível',
    ops?.system ? `- CPU/RAM processo: ${ops.system.cpu ?? '—'}% / ${ops.system.ram ?? '—'}%` : '',
    ops?.whatsapp ? `- Sessões WA conectadas: ${ops.whatsapp.connectedSessions ?? '—'}` : '',
    '',
    '## Manutenção VPS',
    vps?.live
      ? `- Load live: ${vps.live.load1?.toFixed(2) ?? '—'} (15m ${vps.live.load15?.toFixed(2) ?? '—'})`
      : '',
    vps?.live ? `- Índice Evolution: ${vps.live.indexOk === true ? 'OK' : vps.live.indexOk === false ? 'AUSENTE' : '—'}` : '',
    vps?.lastSnapshot
      ? `- Último check: ${vps.lastSnapshot.at ?? '—'} · OK=${vps.lastSnapshot.ok} · PG CPU=${vps.lastSnapshot.postgresCpuPct ?? '—'}%`
      : '- Sem snapshot do monitor na VPS',
    vps?.lastSnapshot?.evolutionRecovered ? '- Evolution recuperado no último check' : '',
    '',
    '## Alertas',
    fmtAlerts(vps?.alerts?.length ? vps.alerts : ops?.alerts),
    '',
    '## JSON completo',
    '```json',
    JSON.stringify({ opsSnapshot: bundle.opsSnapshot, vpsMaintenance: bundle.vpsMaintenance }, null, 2),
    '```'
  ];

  return lines.filter(Boolean).join('\n');
}

export async function fetchAdminOpsReport(token: string): Promise<AdminOpsReportBundle> {
  const headers = { Authorization: `Bearer ${token}` };
  const [opsRes, vpsRes] = await Promise.all([
    fetch(apiUrl('/api/admin/ops-snapshot'), { headers }),
    fetch(apiUrl('/api/admin/vps-maintenance'), { headers })
  ]);

  const opsSnapshot = opsRes.ok ? await opsRes.json() : { error: `HTTP ${opsRes.status}` };
  const vpsMaintenance = vpsRes.ok ? await vpsRes.json() : { error: `HTTP ${vpsRes.status}` };

  const bundle: Omit<AdminOpsReportBundle, 'resumoTexto'> & { resumoTexto?: string } = {
    geradoEm: new Date().toISOString(),
    tela: 'admin-ops',
    opsSnapshot,
    vpsMaintenance
  };
  const full: AdminOpsReportBundle = {
    ...bundle,
    resumoTexto: formatAdminOpsReportMarkdown(bundle as AdminOpsReportBundle)
  };
  return full;
}
