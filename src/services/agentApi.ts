import { apiFetchJson } from '../utils/apiFetchAuth';
import { apiUrl } from '../utils/apiBase';

export type AgentMode = 'auto' | 'standard' | 'admin_full';
export type AgentScope = 'tenant' | 'platform';

export type AgentMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  navigateTo?: string;
  source?: string;
  mode?: AgentMode;
};

export type AgentStatus = {
  ok: boolean;
  enabled: boolean;
  dailyLimit: number;
  remainingToday: number;
  llmEnabled: boolean;
  geminiConfigured: boolean;
  legacyGeminiFabEnabled: boolean;
  provider: 'none' | 'gemini' | 'groq';
  model: string | null;
  isPlatformAdmin: boolean;
  modes: AgentMode[];
  scopes: AgentScope[];
  suggestions: string[];
};

export type AgentScreenAgentOverride = {
  screenKey: string;
  systemPromptExtra?: string;
  enabledTools?: string[];
  tags?: string[];
  enabled?: boolean;
};

export type AgentOrchestratorOverride = {
  systemPromptExtra?: string;
  enabledTools?: string[];
  tags?: string[];
};

export type AgentRegistryPayload = {
  ok: true;
  orchestrator: {
    id: string;
    name: string;
    tagline: string;
    tags: string[];
    systemPromptExtra: string;
    enabledTools: string[];
    defaultEnabledTools?: string[];
  };
  screenAgents: Array<{
    screenKey: string;
    profileId: string;
    name: string;
    tagline: string;
    tags: string[];
    systemPromptExtra: string;
    enabledTools: string[];
    enabled: boolean;
    defaultEnabledTools?: string[];
  }>;
  screenAgentCount: number;
  mappings: Array<{ screenKey: string; profileId: string; agentName: string }>;
  availableTools: Array<{ id: string; label: string; scope: string; description: string }>;
};

export type AgentActivityEntry = {
  at: string;
  tenantIdPrefix: string;
  actorIdPrefix: string;
  mode: AgentMode;
  screen: string;
  orchestrator?: string;
  agentPersona: string;
  agentProfile: string;
  intent: string;
  source: string;
  toolsUsed: string[];
  usedLlm: boolean;
  questionPreview: string;
};

export type AgentAskResponse =
  | {
      ok: true;
      answer: string;
      intent: string;
      source: string;
      suggestions?: string[];
      navigateTo?: string;
      remainingToday: number;
      usedLlm: boolean;
      mode?: AgentMode;
      scope?: AgentScope;
      dataUsed?: boolean;
      toolsUsed?: string[];
      agentPersona?: string;
      agentProfile?: string;
      orchestratorName?: string;
    }
  | {
      ok: false;
      error: string;
      remainingToday: number;
    };

export type AgentConfig = {
  enabled: boolean;
  systemPromptExtra: string;
  dailyLimitOverride: number | null;
  starterSuggestions: string[];
  llmPolishEnabled: boolean;
  knowledgeOverrides: Array<{
    id: string;
    title: string;
    keywords: string[];
    body: string;
    navigateTo?: string;
    tags?: string[];
    enabled?: boolean;
  }>;
  defaultAdminMode: AgentMode;
  screenAgentOverrides?: AgentScreenAgentOverride[];
  orchestratorOverride?: AgentOrchestratorOverride;
  updatedAt?: string;
};

export async function fetchAgentRegistry(): Promise<AgentRegistryPayload> {
  return apiFetchJson<AgentRegistryPayload>('/api/agent/registry');
}

export async function fetchAgentStatus(): Promise<AgentStatus> {
  return apiFetchJson<AgentStatus>('/api/agent/status');
}

export async function askAgent(params: {
  question: string;
  screen?: string;
  currentView?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: unknown;
  mode?: AgentMode;
  scope?: AgentScope;
}): Promise<AgentAskResponse> {
  return apiFetchJson<AgentAskResponse>('/api/agent/ask', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

/** Compatível com token manual (painel legado). */
export async function fetchAgentStatusWithToken(token: string): Promise<AgentStatus | null> {
  const res = await fetch(apiUrl('/api/agent/status'), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()) as AgentStatus;
}

const DEFAULT_ASK_TIMEOUT_MS = 50_000;

export async function askAgentWithToken(
  token: string,
  params: {
    question: string;
    currentView?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    mode?: AgentMode;
  },
  opts?: { timeoutMs?: number }
): Promise<AgentAskResponse> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
  const res = await fetch(apiUrl('/api/agent/ask'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ ...params, mode: params.mode ?? 'standard' }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = (await res.json().catch(() => ({}))) as AgentAskResponse;
  if (!res.ok && data && 'error' in data) return data;
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, remainingToday: 0 };
  }
  return data;
}

export async function fetchAgentActivityAdmin(limit = 15): Promise<{
  ok: boolean;
  entries: AgentActivityEntry[];
}> {
  return apiFetchJson(`/api/agent/activity?limit=${limit}`);
}

export async function fetchAgentActivityWithToken(
  token: string,
  limit = 15
): Promise<AgentActivityEntry[]> {
  const res = await fetch(apiUrl(`/api/agent/activity?limit=${limit}`), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000)
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { entries?: AgentActivityEntry[] };
  return data.entries ?? [];
}

export async function fetchAgentConfigAdmin(): Promise<{ ok: boolean; config: AgentConfig }> {
  return apiFetchJson('/api/agent/config');
}

export async function patchAgentConfigAdmin(partial: Partial<AgentConfig>) {
  return apiFetchJson<{ ok: boolean; config: AgentConfig }>('/api/agent/config', {
    method: 'PATCH',
    body: JSON.stringify({ config: partial })
  });
}

export async function fetchAgentKnowledgeAdmin() {
  return apiFetchJson<{
    ok: boolean;
    baseCount: number;
    mergedCount: number;
    overrides: AgentConfig['knowledgeOverrides'];
  }>('/api/agent/knowledge');
}

export async function patchAgentKnowledgeAdmin(overrides: AgentConfig['knowledgeOverrides']) {
  return apiFetchJson<{ ok: boolean; overrides: AgentConfig['knowledgeOverrides'] }>(
    '/api/agent/knowledge',
    {
      method: 'PATCH',
      body: JSON.stringify({ overrides })
    }
  );
}
