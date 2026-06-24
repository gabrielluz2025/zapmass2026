import { apiFetchJson } from '../utils/apiFetchAuth';

export type AiStatus = {
  ok: boolean;
  configured: boolean;
  admin?: boolean;
  model: string | null;
};

export async function fetchAiStatus(): Promise<AiStatus> {
  return apiFetchJson<AiStatus>('/api/ai/status');
}

export type AiImportRow = {
  lineNumber: number;
  name?: string;
  phone?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  email?: string;
  church?: string;
  role?: string;
  problems?: string[];
  fixes?: string[];
};

export async function aiOrganizeImportRows(rows: AiImportRow[]) {
  return apiFetchJson<{ ok: boolean; rows: AiImportRow[]; error?: string }>(
    '/api/ai/contacts/import-organize',
    { method: 'POST', body: JSON.stringify({ rows }) }
  );
}

export async function aiParseContactsText(text: string) {
  return apiFetchJson<{
    ok: boolean;
    contacts: Array<{
      name: string;
      phone: string;
      city?: string;
      state?: string;
      email?: string;
      church?: string;
      role?: string;
      neighborhood?: string;
    }>;
    error?: string;
  }>('/api/ai/contacts/parse-text', { method: 'POST', body: JSON.stringify({ text }) });
}

export async function aiEnrichContact(contact: Record<string, unknown>) {
  return apiFetchJson<{
    ok: boolean;
    contact: Record<string, string | null>;
    suggestions: string[];
    error?: string;
  }>('/api/ai/contacts/enrich', { method: 'POST', body: JSON.stringify({ contact }) });
}

export async function aiMapDataQuality(
  regionLabel: string,
  samples: Array<{
    id: string;
    name?: string;
    city?: string;
    state?: string;
    neighborhood?: string;
    phone?: string;
  }>
) {
  return apiFetchJson<{
    ok: boolean;
    fixes: Array<{
      id: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      note?: string;
    }>;
    summary: string;
    tips: string[];
    error?: string;
  }>('/api/ai/map/data-quality', {
    method: 'POST',
    body: JSON.stringify({ regionLabel, samples }),
  });
}

export async function aiSuggestCampaignMessage(brief: string, current: string, segment?: string) {
  return apiFetchJson<{
    ok: boolean;
    message: string;
    variants: string[];
    error?: string;
  }>('/api/ai/campaigns/suggest-message', {
    method: 'POST',
    body: JSON.stringify({ brief, current, segment }),
  });
}

export async function aiAsk(screen: string, question: string, context?: unknown) {
  return apiFetchJson<{ ok: boolean; answer: string; dataUsed?: boolean; error?: string }>('/api/ai/assist', {
    method: 'POST',
    body: JSON.stringify({ screen, question, context }),
  });
}
