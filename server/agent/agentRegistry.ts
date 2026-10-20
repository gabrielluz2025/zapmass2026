import {
  ORCHESTRATOR_AGENT,
  SCREEN_AGENTS,
  getScreenAgentSeed,
  type OrchestratorSeed,
  type ScreenAgentSeed
} from '../../shared/agentRegistry.js';
import { AGENT_TOOLS } from './toolRegistry.js';
import type { AgentConfig, AgentScreenAgentOverride, AgentOrchestratorOverride } from './types.js';

export type ResolvedScreenAgent = ScreenAgentSeed & {
  systemPromptExtra: string;
  enabledTools: string[];
  enabled: boolean;
};

export type ResolvedOrchestrator = OrchestratorSeed & {
  systemPromptExtra: string;
  enabledTools: string[];
};

export type AgentRegistryMapping = {
  screenKey: string;
  profileId: string;
  agentName: string;
};

export type AgentRegistryPayload = {
  ok: true;
  orchestrator: ResolvedOrchestrator;
  screenAgents: ResolvedScreenAgent[];
  screenAgentCount: number;
  mappings: AgentRegistryMapping[];
  availableTools: Array<{ id: string; label: string; scope: string; description: string }>;
};

const VALID_TOOL_IDS = new Set(AGENT_TOOLS.map((t) => t.id));

function sanitizeToolIds(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const out = raw
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter((id) => VALID_TOOL_IDS.has(id));
  return out.length > 0 ? [...new Set(out)] : [...fallback];
}

function sanitizeTags(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const out = raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().slice(0, 48))
    .filter(Boolean)
    .slice(0, 16);
  return out.length > 0 ? out : [...fallback];
}

function clampPrompt(s: string, max = 2000): string {
  return s.length <= max ? s : s.slice(0, max);
}

function resolveOrchestrator(cfg: AgentConfig): ResolvedOrchestrator {
  const o: AgentOrchestratorOverride = cfg.orchestratorOverride ?? {};
  const globalExtra = cfg.systemPromptExtra?.trim() ?? '';
  const localExtra = o.systemPromptExtra?.trim() ?? '';
  const systemPromptExtra = clampPrompt([globalExtra, localExtra].filter(Boolean).join('\n\n'));
  return {
    ...ORCHESTRATOR_AGENT,
    tags: sanitizeTags(o.tags, ORCHESTRATOR_AGENT.tags),
    systemPromptExtra,
    enabledTools: sanitizeToolIds(o.enabledTools, ORCHESTRATOR_AGENT.defaultEnabledTools)
  };
}

function overrideForScreen(
  cfg: AgentConfig,
  screenKey: string
): AgentScreenAgentOverride | undefined {
  return cfg.screenAgentOverrides?.find((x) => x.screenKey === screenKey);
}

export function resolveScreenAgent(cfg: AgentConfig, screen?: string | null): ResolvedScreenAgent {
  const seed = getScreenAgentSeed(screen);
  const ov = overrideForScreen(cfg, seed.screenKey);
  return {
    ...seed,
    name: seed.name,
    tags: sanitizeTags(ov?.tags, seed.tags),
    systemPromptExtra: clampPrompt(ov?.systemPromptExtra?.trim() ?? ''),
    enabledTools: sanitizeToolIds(ov?.enabledTools, seed.defaultEnabledTools),
    enabled: ov?.enabled !== false
  };
}

export function buildAgentRegistry(cfg: AgentConfig): AgentRegistryPayload {
  const orchestrator = resolveOrchestrator(cfg);
  const screenAgents = SCREEN_AGENTS.map((seed) => resolveScreenAgent(cfg, seed.screenKey));
  const mappings: AgentRegistryMapping[] = screenAgents.map((a) => ({
    screenKey: a.screenKey,
    profileId: a.profileId,
    agentName: a.name
  }));

  return {
    ok: true,
    orchestrator,
    screenAgents,
    screenAgentCount: screenAgents.length,
    mappings,
    availableTools: AGENT_TOOLS.map((t) => ({
      id: t.id,
      label: t.label,
      scope: t.scope,
      description: t.description
    }))
  };
}

/** Persona + ferramentas efetivas para uma pergunta (orquestrador escolhe sub-agente lógico pela tela). */
export function resolveActiveAgentContext(cfg: AgentConfig, screen?: string | null): {
  orchestratorName: string;
  screenAgent: ResolvedScreenAgent;
  combinedSystemPromptExtra: string;
} {
  const orchestrator = resolveOrchestrator(cfg);
  let screenAgent = resolveScreenAgent(cfg, screen);
  if (!screenAgent.enabled) {
    const guia = getScreenAgentSeed('__fallback__');
    screenAgent = {
      ...guia,
      screenKey: screenAgent.screenKey,
      systemPromptExtra: screenAgent.systemPromptExtra,
      enabledTools: guia.defaultEnabledTools,
      enabled: false
    };
  }
  const parts = [orchestrator.systemPromptExtra, screenAgent.systemPromptExtra].filter(Boolean);
  return {
    orchestratorName: orchestrator.name,
    screenAgent,
    combinedSystemPromptExtra: clampPrompt(parts.join('\n\n'))
  };
}
