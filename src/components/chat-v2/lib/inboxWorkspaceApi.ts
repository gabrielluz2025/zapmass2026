import { apiUrl } from '../../../utils/apiBase';
import { getSessionIdToken } from '../../../utils/sessionAuth';

export type InboxTeammateRow = {
  uid: string;
  displayName: string | null;
  email: string | null;
  role: 'owner' | 'staff';
};

export type InboxFinishResponse = {
  ok?: boolean;
  clientSurveySent?: boolean;
  clientSurveyError?: string;
  error?: string;
};

export async function inboxWorkspaceApi(path: string, init?: RequestInit): Promise<void> {
  const token = await getSessionIdToken();
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const r = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
}

export async function inboxWorkspaceGetJson<T>(path: string): Promise<T> {
  const token = await getSessionIdToken();
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const r = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error || `Erro HTTP ${r.status}`);
  return j as T;
}

export async function inboxWorkspacePostFinish(body: Record<string, unknown>): Promise<InboxFinishResponse> {
  const token = await getSessionIdToken();
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  const r = await fetch(apiUrl('/api/workspace/inbox-finish'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as InboxFinishResponse;
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
}
