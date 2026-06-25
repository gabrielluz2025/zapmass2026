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

/** Sugere 2-3 respostas rápidas para a última mensagem recebida no chat */
export async function aiSuggestChatReplies(
  lastMessages: Array<{ sender: string; text: string; type: string }>
): Promise<{ ok: boolean; suggestions: string[]; error?: string }> {
  const result = await apiFetchJson<{ ok: boolean; answer: string; error?: string }>('/api/ai/assist', {
    method: 'POST',
    body: JSON.stringify({
      screen: 'chat',
      question:
        'Baseado nas últimas mensagens desta conversa de WhatsApp, sugira EXATAMENTE 3 respostas curtas, naturais e prontas para enviar. ' +
        'Retorne SOMENTE as 3 respostas separadas pelo símbolo | (pipe), sem numeração, sem aspas, sem explicação. Máximo 12 palavras cada.',
      context: { messages: lastMessages.slice(-6) },
    }),
  });
  if (!result.ok || !result.answer) {
    return { ok: false, suggestions: [], error: result.error };
  }
  const suggestions = result.answer
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 120)
    .slice(0, 3);
  return { ok: true, suggestions };
}
