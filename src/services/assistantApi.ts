import { apiUrl } from '../utils/apiBase';

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  navigateTo?: string;
  source?: string;
};

export type AssistantStatus = {
  ok: boolean;
  dailyLimit: number;
  remainingToday: number;
  llmEnabled: boolean;
  provider: 'none' | 'gemini' | 'groq';
  suggestions: string[];
};

export type AssistantAskResponse =
  | {
      ok: true;
      answer: string;
      intent: string;
      source: string;
      suggestions?: string[];
      navigateTo?: string;
      remainingToday: number;
      usedLlm: boolean;
    }
  | {
      ok: false;
      error: string;
      remainingToday: number;
    };

export async function fetchAssistantStatus(token: string): Promise<AssistantStatus | null> {
  const res = await fetch(apiUrl('/api/assistant/status'), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as AssistantStatus;
}

export async function askAssistant(
  token: string,
  params: { question: string; currentView?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> }
): Promise<AssistantAskResponse> {
  const res = await fetch(apiUrl('/api/assistant/ask'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(params)
  });
  const data = (await res.json().catch(() => ({}))) as AssistantAskResponse;
  if (!res.ok && data && 'error' in data) return data;
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, remainingToday: 0 };
  }
  return data;
}
