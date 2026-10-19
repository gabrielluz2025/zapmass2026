import { geminiGenerateText, isGeminiConfigured } from '../geminiService.js';
import { polishWithLlm, creativeWithLlm, isLlmAvailable } from '../assistant/assistantLlm.js';
import {
  isAgentLlmAvailable,
  isGeminiLegacyFabEnabled,
  resolveAgentLlmProvider,
  resolveAgentProvider
} from './agentLlmConfig.js';

export function agentGeminiConfigured(): boolean {
  return isGeminiConfigured();
}

export function agentAssistantLlmAvailable(): boolean {
  return isLlmAvailable();
}

export { resolveAgentProvider, isGeminiLegacyFabEnabled, isAgentLlmAvailable, resolveAgentLlmProvider };

export function agentModelLabel(): string | null {
  if (!isAgentLlmAvailable()) return null;
  const p = resolveAgentLlmProvider();
  if (p === 'groq') return process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';
  if (p === 'gemini') return (process.env.GEMINI_MODEL || 'gemini-3.5-flash').trim();
  return null;
}

function maxOutputTokens(): number {
  const n = Number(process.env.ASSISTANT_LLM_MAX_TOKENS ?? 512);
  return Number.isFinite(n) ? Math.min(2048, Math.max(64, Math.floor(n))) : 512;
}

async function callGroqChat(systemInstruction: string, userPrompt: string): Promise<string> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY não configurada.');
  const model = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens(),
      temperature: 0.25,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status}${err ? `: ${err.slice(0, 200)}` : ''}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Resposta vazia do Groq.');
  return text;
}

export async function generateAgentFullAnswer(params: {
  systemInstruction: string;
  userPrompt: string;
}): Promise<string> {
  const provider = resolveAgentLlmProvider();
  if (provider === 'groq') {
    return callGroqChat(params.systemInstruction, params.userPrompt);
  }
  if (provider === 'gemini') {
    return geminiGenerateText(params.userPrompt, params.systemInstruction, { jsonMode: false });
  }
  throw new Error('LLM externo desativado (AGENT_LLM_PROVIDER=none).');
}

export { polishWithLlm, creativeWithLlm, isLlmAvailable };
