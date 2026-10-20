/** Rótulos do assistente admin — padrão plataforma, Gemini só no legado opt-in. */

export type AiProviderBadge = 'deterministic' | 'groq' | 'gemini';

export type AgentProviderField = 'none' | 'groq' | 'gemini';

export function resolveProviderBadge(provider: AgentProviderField | string | undefined): AiProviderBadge {
  if (provider === 'groq') return 'groq';
  if (provider === 'gemini') return 'gemini';
  return 'deterministic';
}

export function getEngineTurnBadge(params: {
  lastSource: string | null;
  providerBadge: AiProviderBadge;
  legacyGeminiFab: boolean;
}): string {
  const { lastSource, providerBadge, legacyGeminiFab } = params;
  if (lastSource === 'llm') {
    if (providerBadge === 'groq') return 'Groq · dados ao vivo';
    if (providerBadge === 'gemini' && legacyGeminiFab) return 'Gemini · dados ao vivo';
  }
  if (lastSource === 'cache') return 'Resposta salva · determinístico';
  return 'Determinístico · Plataforma';
}

export function getHeroMotorLabel(providerBadge: AiProviderBadge, legacyGeminiFab: boolean): string {
  if (providerBadge === 'groq') return 'Groq (opt-in via env)';
  if (providerBadge === 'gemini' && legacyGeminiFab) return 'Gemini (legado opt-in)';
  return 'determinístico · plataforma';
}

/** Banner de custo / API paga — só no FAB legado com Gemini explícito. */
export function shouldShowLlmCostBanner(providerBadge: AiProviderBadge, legacyGeminiFab: boolean): boolean {
  return legacyGeminiFab && providerBadge === 'gemini';
}

export const ASSISTANT_ADMIN_TITLE = 'Agente ZapMass';
export const ASSISTANT_LEGACY_TITLE = 'Assistente IA (Gemini)';
