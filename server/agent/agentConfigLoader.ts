import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from '../firebaseAdmin.js';
import type {
  AgentConfig,
  AgentKnowledgeOverride,
  AgentMode,
  AgentOrchestratorOverride,
  AgentScreenAgentOverride
} from './types.js';

const COLLECTION = 'appConfig';
const DOC_ID = 'agent';

const STARTER_DEFAULT = [
  'Quantos contatos tenho?',
  'Como conectar um chip WhatsApp?',
  'Resumo da minha conta',
  'Sugira uma mensagem de cobrança'
];

let cache: { at: number; data: AgentConfig } | null = null;
const TTL_MS = 15_000;

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function parseKnowledgeOverrides(raw: unknown): AgentKnowledgeOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentKnowledgeOverride[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim().slice(0, 64) : '';
    const title = typeof o.title === 'string' ? clampStr(o.title, 120) : '';
    const body = typeof o.body === 'string' ? clampStr(o.body, 4000) : '';
    if (!id || !title || body.length < 8) continue;
    const keywords = Array.isArray(o.keywords)
      ? o.keywords
          .filter((k): k is string => typeof k === 'string')
          .map((k) => k.trim().slice(0, 48))
          .filter(Boolean)
          .slice(0, 24)
      : [];
    out.push({
      id,
      title,
      body,
      keywords,
      navigateTo: typeof o.navigateTo === 'string' ? o.navigateTo.slice(0, 64) : undefined,
      enabled: o.enabled === false ? false : true
    });
  }
  return out.slice(0, 200);
}

function parseMode(raw: unknown): AgentMode {
  if (raw === 'standard' || raw === 'admin_full' || raw === 'auto') return raw;
  return 'auto';
}

function parseScreenAgentOverrides(raw: unknown): AgentScreenAgentOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentScreenAgentOverride[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const screenKey = typeof o.screenKey === 'string' ? o.screenKey.trim().slice(0, 64) : '';
    if (!screenKey) continue;
    const entry: AgentScreenAgentOverride = { screenKey };
    if (typeof o.systemPromptExtra === 'string') {
      entry.systemPromptExtra = clampStr(o.systemPromptExtra, 2000);
    }
    if (Array.isArray(o.enabledTools)) {
      entry.enabledTools = o.enabledTools
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 24);
    }
    if (Array.isArray(o.tags)) {
      entry.tags = o.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().slice(0, 48))
        .filter(Boolean)
        .slice(0, 16);
    }
    if (o.enabled === false) entry.enabled = false;
    out.push(entry);
  }
  return out.slice(0, 40);
}

function parseOrchestratorOverride(raw: unknown): AgentOrchestratorOverride {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: AgentOrchestratorOverride = {};
  if (typeof o.systemPromptExtra === 'string') {
    out.systemPromptExtra = clampStr(o.systemPromptExtra, 2000);
  }
  if (Array.isArray(o.enabledTools)) {
    out.enabledTools = o.enabledTools
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 24);
  }
  if (Array.isArray(o.tags)) {
    out.tags = o.tags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim().slice(0, 48))
      .filter(Boolean)
      .slice(0, 16);
  }
  return out;
}

export function defaultAgentConfig(): AgentConfig {
  return {
    enabled: true,
    systemPromptExtra: '',
    dailyLimitOverride: null,
    starterSuggestions: [...STARTER_DEFAULT],
    llmPolishEnabled: true,
    knowledgeOverrides: [],
    defaultAdminMode: 'auto',
    screenAgentOverrides: [],
    orchestratorOverride: {}
  };
}

export function mergeAgentConfigPartial(raw: Record<string, unknown> | undefined): AgentConfig {
  const base = defaultAgentConfig();
  const o = raw || {};
  if (typeof o.enabled === 'boolean') base.enabled = o.enabled;
  if (typeof o.systemPromptExtra === 'string') {
    base.systemPromptExtra = clampStr(o.systemPromptExtra, 2000);
  }
  if (o.dailyLimitOverride === null) base.dailyLimitOverride = null;
  else if (typeof o.dailyLimitOverride === 'number' && Number.isFinite(o.dailyLimitOverride)) {
    base.dailyLimitOverride = Math.min(200, Math.max(1, Math.floor(o.dailyLimitOverride)));
  }
  if (Array.isArray(o.starterSuggestions)) {
    const list = o.starterSuggestions
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().slice(0, 200))
      .filter((s) => s.length >= 2)
      .slice(0, 12);
    if (list.length > 0) base.starterSuggestions = list;
  }
  if (typeof o.llmPolishEnabled === 'boolean') base.llmPolishEnabled = o.llmPolishEnabled;
  if (o.defaultAdminMode !== undefined) base.defaultAdminMode = parseMode(o.defaultAdminMode);
  base.knowledgeOverrides = parseKnowledgeOverrides(o.knowledgeOverrides);
  if (o.screenAgentOverrides !== undefined) {
    base.screenAgentOverrides = parseScreenAgentOverrides(o.screenAgentOverrides);
  }
  if (o.orchestratorOverride !== undefined) {
    base.orchestratorOverride = parseOrchestratorOverride(o.orchestratorOverride);
  }
  if (typeof o.updatedAt === 'string') base.updatedAt = o.updatedAt;
  return base;
}

export function invalidateAgentConfigCache(): void {
  cache = null;
}

export async function loadAgentConfigFromFirestore(db: Firestore): Promise<AgentConfig> {
  const snap = await db.collection(COLLECTION).doc(DOC_ID).get();
  return snap.exists ? mergeAgentConfigPartial(snap.data() as Record<string, unknown>) : defaultAgentConfig();
}

export async function loadAgentConfig(): Promise<AgentConfig> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;

  const admin = getFirebaseAdmin();
  let merged: AgentConfig;
  if (!admin) {
    merged = defaultAgentConfig();
  } else {
    merged = await loadAgentConfigFromFirestore(getFirestore(admin));
  }
  cache = { at: now, data: merged };
  return merged;
}

export async function saveAgentConfigMerge(partial: Partial<AgentConfig>): Promise<AgentConfig> {
  const admin = getFirebaseAdmin();
  if (!admin) {
    throw new Error('Firestore indisponível — não foi possível salvar config do agente.');
  }
  const db = getFirestore(admin);
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const current = await loadAgentConfigFromFirestore(db);
  const next: AgentConfig = {
    enabled: partial.enabled !== undefined ? partial.enabled : current.enabled,
    systemPromptExtra:
      partial.systemPromptExtra !== undefined ? clampStr(partial.systemPromptExtra, 2000) : current.systemPromptExtra,
    dailyLimitOverride:
      partial.dailyLimitOverride !== undefined ? partial.dailyLimitOverride : current.dailyLimitOverride,
    starterSuggestions:
      partial.starterSuggestions !== undefined ? partial.starterSuggestions.slice(0, 12) : current.starterSuggestions,
    llmPolishEnabled:
      partial.llmPolishEnabled !== undefined ? partial.llmPolishEnabled : current.llmPolishEnabled,
    knowledgeOverrides:
      partial.knowledgeOverrides !== undefined
        ? parseKnowledgeOverrides(partial.knowledgeOverrides)
        : current.knowledgeOverrides,
    defaultAdminMode:
      partial.defaultAdminMode !== undefined ? parseMode(partial.defaultAdminMode) : current.defaultAdminMode,
    screenAgentOverrides:
      partial.screenAgentOverrides !== undefined
        ? parseScreenAgentOverrides(partial.screenAgentOverrides)
        : current.screenAgentOverrides,
    orchestratorOverride:
      partial.orchestratorOverride !== undefined
        ? parseOrchestratorOverride(partial.orchestratorOverride)
        : current.orchestratorOverride,
    updatedAt: new Date().toISOString()
  };
  await ref.set(next, { merge: true });
  invalidateAgentConfigCache();
  cache = { at: Date.now(), data: next };
  return next;
}

export function sanitizeAgentConfigPatch(body: unknown): Partial<AgentConfig> {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const out: Partial<AgentConfig> = {};
  if (typeof b.enabled === 'boolean') out.enabled = b.enabled;
  if (typeof b.systemPromptExtra === 'string') out.systemPromptExtra = b.systemPromptExtra;
  if (b.dailyLimitOverride === null) out.dailyLimitOverride = null;
  else if (typeof b.dailyLimitOverride === 'number' && Number.isFinite(b.dailyLimitOverride)) {
    out.dailyLimitOverride = Math.min(200, Math.max(1, Math.floor(b.dailyLimitOverride)));
  }
  if (typeof b.llmPolishEnabled === 'boolean') out.llmPolishEnabled = b.llmPolishEnabled;
  if (b.defaultAdminMode !== undefined) out.defaultAdminMode = parseMode(b.defaultAdminMode);
  if (Array.isArray(b.starterSuggestions)) {
    out.starterSuggestions = b.starterSuggestions
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().slice(0, 200))
      .filter((s) => s.length >= 2)
      .slice(0, 12);
  }
  if (Array.isArray(b.knowledgeOverrides)) {
    out.knowledgeOverrides = parseKnowledgeOverrides(b.knowledgeOverrides);
  }
  if (Array.isArray(b.screenAgentOverrides)) {
    out.screenAgentOverrides = parseScreenAgentOverrides(b.screenAgentOverrides);
  }
  if (b.orchestratorOverride !== undefined) {
    out.orchestratorOverride = parseOrchestratorOverride(b.orchestratorOverride);
  }
  return out;
}
