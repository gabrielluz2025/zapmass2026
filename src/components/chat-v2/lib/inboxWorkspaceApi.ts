import { getSessionIdToken } from '../../../utils/sessionAuth';
import { apiUrl } from '../../../utils/apiBase';

export type InboxTeammateRow = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Fetch autenticado genérico. Lança Error com mensagem do servidor em caso de falha. */
export async function inboxWorkspaceApi(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers as Record<string, string> || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return res;
}

/** GET autenticado com parse JSON. */
export async function inboxWorkspaceGetJson<T>(path: string): Promise<T> {
  const res = await inboxWorkspaceApi(path);
  return res.json() as Promise<T>;
}

/** POST para finalizar atendimento. */
export async function inboxWorkspacePostFinish(body: {
  conversationId: string;
  skipSurvey?: boolean;
  rating?: number;
  comment?: string;
  sendClientSurvey?: boolean;
}): Promise<{ ok?: boolean; clientSurveySent?: boolean; clientSurveyError?: string }> {
  const res = await inboxWorkspaceApi('/api/workspace/inbox-finish', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok?: boolean; clientSurveySent?: boolean; clientSurveyError?: string }>;
}
