import { classifyCampaignOutboundError, campaignOutboundErrorKindLabel } from './campaignOutboundErrorKind.js';

export const DIAGNOSTICS_BUNDLE_SCHEMA = 'zapmass.diagnostics.v1' as const;

export type DiagnosticsErrorSample = {
  at: string;
  source: 'campaign' | 'api' | 'inbox' | 'client';
  level: 'error' | 'warn' | 'info';
  code: string;
  codeLabel: string;
  message: string;
  campaignId?: string;
  connectionId?: string;
  phoneMasked?: string;
};

export type DiagnosticsCampaignSummary = {
  id: string;
  name: string;
  status?: string;
  isRunning?: boolean;
  processed?: number;
  successCount?: number;
  failCount?: number;
  pendingJobs?: number;
  paused?: boolean;
};

export type DiagnosticsConnectionSummary = {
  id: string;
  label: string;
  status: string;
  engine?: string;
};

export type DiagnosticsBundle = {
  schema: typeof DIAGNOSTICS_BUNDLE_SCHEMA;
  exportedAt: string;
  appVersion: string;
  gitRef: string;
  tenantId: string;
  configFlags: {
    dataProvider: string;
    evolutionEngine: string;
    vpsOnly?: boolean;
  };
  connections: DiagnosticsConnectionSummary[];
  campaigns: DiagnosticsCampaignSummary[];
  recentErrors: DiagnosticsErrorSample[];
  queue?: {
    waitLen: number | null;
    delayedLen: number | null;
    activeJobs: number | null;
  };
  clientHints?: Record<string, unknown>;
};

const SECRET_KEY = /password|secret|token|apikey|api_key|authorization|bearer|private/i;

export function maskPhoneForDiagnostics(phone: string | undefined): string | undefined {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8) return d || undefined;
  return `***${d.slice(-4)}`;
}

export function sanitizeDiagnosticsRecord(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncado]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const s = value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    return s;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeDiagnosticsRecord(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      out[k] = sanitizeDiagnosticsRecord(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function classifyDiagnosticsErrorCode(message: string): { code: string; codeLabel: string } {
  const kind = classifyCampaignOutboundError(message);
  if (kind !== 'other') {
    return { code: kind, codeLabel: campaignOutboundErrorKindLabel(kind) };
  }
  if (/URL is required/i.test(message)) {
    return { code: 'media_url_required', codeLabel: 'Mídia sem URL (Evolution Go)' };
  }
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return { code: 'network_timeout', codeLabel: 'Timeout / rede' };
  }
  return { code: 'other', codeLabel: 'Outro' };
}

export function buildDiagnosticsErrorSample(input: {
  at: string;
  source: DiagnosticsErrorSample['source'];
  level: DiagnosticsErrorSample['level'];
  message: string;
  campaignId?: string;
  connectionId?: string;
  phone?: string;
}): DiagnosticsErrorSample {
  const { code, codeLabel } = classifyDiagnosticsErrorCode(input.message);
  return {
    at: input.at,
    source: input.source,
    level: input.level,
    code,
    codeLabel,
    message: String(input.message || '').slice(0, 500),
    campaignId: input.campaignId,
    connectionId: input.connectionId,
    phoneMasked: maskPhoneForDiagnostics(input.phone),
  };
}
