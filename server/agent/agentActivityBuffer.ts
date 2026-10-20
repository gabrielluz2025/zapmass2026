import type { AgentMode } from './types.js';

export type AgentActivityEntry = {
  at: string;
  tenantIdPrefix: string;
  actorIdPrefix: string;
  mode: AgentMode;
  screen: string;
  agentPersona: string;
  agentProfile: string;
  intent: string;
  source: string;
  toolsUsed: string[];
  usedLlm: boolean;
  questionPreview: string;
};

const MAX_ENTRIES = 80;
const buffer: AgentActivityEntry[] = [];

export function pushAgentActivity(entry: AgentActivityEntry): void {
  buffer.unshift(entry);
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
}

export function getRecentAgentActivity(limit = 25): AgentActivityEntry[] {
  const n = Math.min(MAX_ENTRIES, Math.max(1, Math.floor(limit)));
  return buffer.slice(0, n);
}
