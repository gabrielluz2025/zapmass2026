import { handleAssistantAsk } from '../assistant/assistantEngine.js';
import { getRemainingQuota } from '../assistant/assistantCache.js';
import { loadAgentConfig } from './agentConfigLoader.js';
import { buildAdminFullPrompt } from './toolRegistry.js';
import {
  agentGeminiConfigured,
  generateAgentFullAnswer,
  resolveAgentProvider,
  agentModelLabel,
  isAgentLlmAvailable,
  isGeminiLegacyFabEnabled
} from './llmProvider.js';
import { buildAdminFullDeterministicAnswer } from './adminDeterministic.js';
import { classifyIntent } from '../assistant/assistantRouter.js';
import type { AgentAskParams, AgentAskResponse, AgentMode, AgentScope, AgentStatusPayload } from './types.js';

function resolveMode(params: AgentAskParams, cfgDefault: AgentMode): AgentMode {
  const requested = params.mode || 'auto';
  if (requested === 'standard' || requested === 'admin_full') return requested;
  if (params.isPlatformAdmin && cfgDefault === 'admin_full') return 'admin_full';
  return 'standard';
}

function resolveScope(params: AgentAskParams, mode: AgentMode): AgentScope {
  if (params.scope === 'platform' || params.scope === 'tenant') return params.scope;
  return mode === 'admin_full' ? 'platform' : 'tenant';
}

export async function getAgentStatus(params: {
  tenantId: string;
  actorId: string;
  isPlatformAdmin: boolean;
}): Promise<AgentStatusPayload> {
  const cfg = await loadAgentConfig();
  const remainingToday = await getRemainingQuota(params.tenantId, params.actorId);
  const dailyLimit =
    cfg.dailyLimitOverride != null
      ? cfg.dailyLimitOverride
      : Number(process.env.ASSISTANT_DAILY_LIMIT ?? 20);

  const geminiConfigured = agentGeminiConfigured();
  const provider = resolveAgentProvider();
  const llmEnabled =
    params.isPlatformAdmin && isAgentLlmAvailable() && process.env.ASSISTANT_LLM_ENABLED !== 'false';

  return {
    ok: true,
    enabled: cfg.enabled,
    dailyLimit: Number.isFinite(dailyLimit) ? dailyLimit : 20,
    remainingToday,
    llmEnabled: !!llmEnabled && cfg.llmPolishEnabled,
    geminiConfigured,
    legacyGeminiFabEnabled: isGeminiLegacyFabEnabled(),
    provider: llmEnabled && cfg.llmPolishEnabled ? provider : 'none',
    model: llmEnabled && cfg.llmPolishEnabled ? agentModelLabel() : null,
    isPlatformAdmin: params.isPlatformAdmin,
    modes: ['auto', 'standard', 'admin_full'],
    scopes: ['tenant', 'platform'],
    suggestions: cfg.starterSuggestions
  };
}

export async function handleAgentAsk(params: AgentAskParams): Promise<AgentAskResponse> {
  const cfg = await loadAgentConfig();
  if (!cfg.enabled) {
    const remaining = await getRemainingQuota(params.tenantId, params.actorId);
    return { ok: false, error: 'Assistente temporariamente desativado pela plataforma.', remainingToday: remaining };
  }

  const mode = resolveMode(params, cfg.defaultAdminMode);
  const scope = resolveScope(params, mode);
  const screen = (params.screen || params.currentView || 'geral').slice(0, 64);

  if (mode === 'admin_full') {
    if (!params.isPlatformAdmin) {
      const remaining = await getRemainingQuota(params.tenantId, params.actorId);
      return {
        ok: false,
        error: 'Modo IA completa restrito a administradores da plataforma.',
        remainingToday: remaining
      };
    }
    const question = params.question.trim().slice(0, 2000);
    if (question.length < 2) {
      const remaining = await getRemainingQuota(params.tenantId, params.actorId);
      return { ok: false, error: 'Escreva uma pergunta com pelo menos 2 caracteres.', remainingToday: remaining };
    }

    try {
      let answer: string;
      let source: 'llm' | 'tools' = 'tools';
      let usedLlm = false;

      if (isAgentLlmAvailable()) {
        const { systemInstruction, userPrompt } = await buildAdminFullPrompt({
          screen,
          question,
          tenantId: params.tenantId,
          actorId: params.actorId,
          context: params.context,
          systemExtra: cfg.systemPromptExtra
        });
        answer = await generateAgentFullAnswer({ systemInstruction, userPrompt });
        source = 'llm';
        usedLlm = true;
      } else {
        const det = await buildAdminFullDeterministicAnswer({
          tenantId: params.tenantId,
          actorId: params.actorId,
          screen,
          question,
          context: params.context
        });
        answer = det.answer;
      }

      const remaining = await getRemainingQuota(params.tenantId, params.actorId);
      return {
        ok: true,
        answer,
        intent: classifyIntent(question),
        source,
        remainingToday: remaining,
        usedLlm,
        mode: 'admin_full',
        scope,
        dataUsed: true
      };
    } catch (e) {
      const remaining = await getRemainingQuota(params.tenantId, params.actorId);
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Falha na IA.',
        remainingToday: remaining
      };
    }
  }

  const allowLlm =
    !!params.allowLlm &&
    params.isPlatformAdmin &&
    cfg.llmPolishEnabled &&
    process.env.ASSISTANT_LLM_ENABLED !== 'false';

  const result = await handleAssistantAsk({
    tenantId: params.tenantId,
    actorId: params.actorId,
    question: params.question,
    currentView: params.currentView || params.screen,
    history: params.history,
    allowLlm
  });

  if (!result.ok) return result;

  return {
    ...result,
    mode: 'standard',
    scope,
    dataUsed: result.source === 'tools' || result.source === 'llm'
  };
}

/** Atalho compatível com POST /api/ai/assist (Gemini + snapshot). */
export async function handleAgentAssistCompat(params: {
  tenantId: string;
  actorId: string;
  screen: string;
  question: string;
  context?: unknown;
  isPlatformAdmin: boolean;
}): Promise<{ ok: true; answer: string; dataUsed: boolean } | { ok: false; error: string }> {
  const res = await handleAgentAsk({
    ...params,
    mode: 'admin_full',
    scope: 'platform',
    isPlatformAdmin: params.isPlatformAdmin,
    allowLlm: true
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, answer: res.answer, dataUsed: !!res.dataUsed };
}
