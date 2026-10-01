import {
  buildDiagnosticsErrorSample,
  type DiagnosticsErrorSample,
} from '../shared/diagnosticsBundle.js';

const MAX_PER_TENANT = 120;

type RawEvent = {
  tenantId: string;
  at: string;
  source: DiagnosticsErrorSample['source'];
  level: DiagnosticsErrorSample['level'];
  message: string;
  campaignId?: string;
  connectionId?: string;
  phone?: string;
};

const byTenant = new Map<string, DiagnosticsErrorSample[]>();

export function pushTenantDiagnosticEvent(raw: RawEvent): void {
  const tid = String(raw.tenantId || '').trim();
  if (!tid) return;
  const sample = buildDiagnosticsErrorSample(raw);
  let list = byTenant.get(tid);
  if (!list) {
    list = [];
    byTenant.set(tid, list);
  }
  list.unshift(sample);
  if (list.length > MAX_PER_TENANT) list.length = MAX_PER_TENANT;
}

export function listTenantDiagnosticEvents(tenantId: string, limit = 80): DiagnosticsErrorSample[] {
  const tid = String(tenantId || '').trim();
  const list = byTenant.get(tid) || [];
  const n = Math.max(1, Math.min(120, limit));
  return list.slice(0, n);
}
