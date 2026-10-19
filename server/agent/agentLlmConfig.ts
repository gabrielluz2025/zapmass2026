/** Política de LLM externo do Agente ZapMass (independente do Gemini legado /api/ai). */

export type AgentLlmProvider = 'none' | 'groq' | 'gemini';

export function resolveAgentLlmProvider(): AgentLlmProvider {
  const raw = (process.env.AGENT_LLM_PROVIDER || 'none').trim().toLowerCase();
  if (raw === 'groq' || raw === 'gemini') return raw;
  return 'none';
}

export function isAgentLlmAvailable(): boolean {
  if (process.env.ASSISTANT_LLM_ENABLED === 'false') return false;
  const p = resolveAgentLlmProvider();
  if (p === 'groq') return !!process.env.GROQ_API_KEY?.trim();
  if (p === 'gemini') return !!(process.env.GEMINI_API_KEY || '').trim();
  return false;
}

/** FAB /api/ai (importação inteligente, mapa, etc.) — opt-in explícito. */
export function isGeminiLegacyFabEnabled(): boolean {
  return process.env.GEMINI_LEGACY_ASSISTANT === 'true' && !!(process.env.GEMINI_API_KEY || '').trim();
}

export function resolveAgentProvider(): 'none' | 'gemini' | 'groq' {
  const p = resolveAgentLlmProvider();
  if (p === 'groq' && process.env.GROQ_API_KEY?.trim()) return 'groq';
  if (p === 'gemini' && (process.env.GEMINI_API_KEY || '').trim()) return 'gemini';
  return 'none';
}
