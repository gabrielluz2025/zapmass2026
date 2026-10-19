import type { AssistantAskResult, AssistantHistoryMessage, KnowledgeChunk } from '../assistant/assistantTypes.js';

/** Escopo híbrido: tenant (dados do cliente) ou plataforma (ops/admin). */
export type AgentScope = 'tenant' | 'platform';

/** Modo de resposta: regras/RAG, ou IA com snapshot completo (admin). */
export type AgentMode = 'auto' | 'standard' | 'admin_full';

export type AgentKnowledgeOverride = KnowledgeChunk & {
  /** Se false, oculta chunk base com mesmo id. */
  enabled?: boolean;
};

export type AgentConfig = {
  enabled: boolean;
  /** Texto extra no system prompt (Gemini). */
  systemPromptExtra: string;
  /** null = usar ASSISTANT_DAILY_LIMIT do env. */
  dailyLimitOverride: number | null;
  starterSuggestions: string[];
  llmPolishEnabled: boolean;
  /** Chunks adicionais ou substituições (mesmo id sobrescreve). */
  knowledgeOverrides: AgentKnowledgeOverride[];
  /** Escopo padrão quando mode=auto e usuário é admin. */
  defaultAdminMode: AgentMode;
  updatedAt?: string;
};

export type AgentAskParams = {
  tenantId: string;
  actorId: string;
  question: string;
  screen?: string;
  currentView?: string;
  history?: AssistantHistoryMessage[];
  context?: unknown;
  mode?: AgentMode;
  scope?: AgentScope;
  isPlatformAdmin: boolean;
  allowLlm?: boolean;
};

export type AgentAskSuccess = AssistantAskResult & {
  mode: AgentMode;
  scope: AgentScope;
  dataUsed?: boolean;
};

export type AgentAskFailure = {
  ok: false;
  error: string;
  remainingToday: number;
};

export type AgentAskResponse = AgentAskSuccess | AgentAskFailure;

export type AgentStatusPayload = {
  ok: true;
  enabled: boolean;
  dailyLimit: number;
  remainingToday: number;
  llmEnabled: boolean;
  geminiConfigured: boolean;
  /** FAB legado /api/ai (importação, mapa) — requer GEMINI_LEGACY_ASSISTANT=true. */
  legacyGeminiFabEnabled: boolean;
  provider: 'none' | 'gemini' | 'groq';
  model: string | null;
  isPlatformAdmin: boolean;
  modes: AgentMode[];
  scopes: AgentScope[];
  suggestions: string[];
};

export type AgentToolContext = {
  tenantId: string;
  actorId: string;
  screen: string;
  question: string;
  context?: unknown;
  isPlatformAdmin: boolean;
};

export type AgentToolDefinition = {
  id: string;
  label: string;
  scope: AgentScope;
  description: string;
};
