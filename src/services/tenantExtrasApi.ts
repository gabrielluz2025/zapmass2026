import { apiUrl } from '../utils/apiBase';

async function authFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body && !(init.headers as Record<string, string>)?.['Content-Type']
        ? { 'Content-Type': 'application/json' }
        : {})
    }
  });
}

export type OpsHealth = {
  ok: boolean;
  queue: {
    pending: number;
    sending: number;
    failed: number;
    dead: number;
    sent_last_hour: number;
    backpressureActive: boolean;
  };
  redisUsedPct: number | null;
};

export type CampaignFailure = {
  idempotency_key: string;
  campaign_id: string;
  connection_id: string;
  to_number: string;
  last_error: string;
  updated_at: string;
};

export type LegalAcceptanceRow = {
  doc_type: string;
  doc_version: string;
  accepted_at: string;
};

export type OptOutRow = {
  id: string;
  phone_digits: string;
  reason: string;
  source: string;
  created_at: string;
};

export type MySuggestionRow = {
  id: string;
  text: string;
  screen: string;
  category: string;
  status: string;
  admin_note: string;
  created_at: string;
  updated_at: string;
};

export async function fetchOpsHealth(token: string): Promise<OpsHealth | null> {
  const res = await authFetch(token, '/api/tenant/ops-health');
  if (!res.ok) return null;
  return (await res.json()) as OpsHealth;
}

export async function fetchCampaignFailures(token: string, limit = 50): Promise<CampaignFailure[]> {
  const res = await authFetch(token, `/api/tenant/campaign-failures?limit=${limit}`);
  if (!res.ok) return [];
  const j = (await res.json()) as { items?: CampaignFailure[] };
  return j.items || [];
}

export async function fetchLegacyDlq(token: string): Promise<unknown[]> {
  const res = await authFetch(token, '/api/tenant/legacy-dlq');
  if (!res.ok) return [];
  const j = (await res.json()) as { items?: unknown[] };
  return j.items || [];
}

export async function downloadDataExport(token: string): Promise<void> {
  const res = await authFetch(token, '/api/tenant/data-export');
  if (!res.ok) throw new Error('Falha ao exportar dados.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zapmass-lgpd-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function requestDataDeletion(token: string, note: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await authFetch(token, '/api/tenant/data-deletion-request', {
    method: 'POST',
    body: JSON.stringify({ note })
  });
  return (await res.json()) as { ok: boolean; message?: string; error?: string };
}

export async function recordLegalAcceptance(
  token: string,
  docType: string,
  docVersion: string
): Promise<void> {
  await authFetch(token, '/api/tenant/legal-acceptance', {
    method: 'POST',
    body: JSON.stringify({ docType, docVersion })
  });
}

export async function fetchLegalAcceptances(token: string): Promise<LegalAcceptanceRow[]> {
  const res = await authFetch(token, '/api/tenant/legal-acceptances');
  if (!res.ok) return [];
  const j = (await res.json()) as { items?: LegalAcceptanceRow[] };
  return j.items || [];
}

export async function fetchOptOutList(token: string): Promise<OptOutRow[]> {
  const res = await authFetch(token, '/api/tenant/opt-out-list');
  if (!res.ok) return [];
  const j = (await res.json()) as { items?: OptOutRow[] };
  return j.items || [];
}

export async function addOptOut(token: string, phone: string, reason?: string): Promise<boolean> {
  const res = await authFetch(token, '/api/tenant/opt-out', {
    method: 'POST',
    body: JSON.stringify({ phone, reason, source: 'manual' })
  });
  return res.ok;
}

export async function removeOptOut(token: string, phoneDigits: string): Promise<boolean> {
  const res = await authFetch(token, `/api/tenant/opt-out/${encodeURIComponent(phoneDigits)}`, {
    method: 'DELETE'
  });
  return res.ok;
}

export async function fetchMySuggestions(token: string): Promise<MySuggestionRow[]> {
  const res = await authFetch(token, '/api/product-suggestions/mine');
  if (!res.ok) return [];
  const j = (await res.json()) as { items?: MySuggestionRow[] };
  return j.items || [];
}

export async function testTenantWebhook(token: string): Promise<{ ok: boolean; error?: string }> {
  const res = await authFetch(token, '/api/tenant/webhook-test', { method: 'POST' });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return { ok: Boolean(j.ok), error: j.error };
}
