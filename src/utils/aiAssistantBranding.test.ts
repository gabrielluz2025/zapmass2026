import { describe, expect, it } from 'vitest';
import {
  getEngineTurnBadge,
  getHeroMotorLabel,
  resolveProviderBadge,
  shouldShowLlmCostBanner
} from './aiAssistantBranding';

describe('aiAssistantBranding', () => {
  it('resolveProviderBadge mapeia provider do agente', () => {
    expect(resolveProviderBadge('none')).toBe('deterministic');
    expect(resolveProviderBadge('groq')).toBe('groq');
    expect(resolveProviderBadge('gemini')).toBe('gemini');
  });

  it('badge padrão sem LLM nem legado Gemini', () => {
    expect(
      getEngineTurnBadge({ lastSource: 'rules', providerBadge: 'gemini', legacyGeminiFab: false })
    ).toBe('Determinístico · Plataforma');
    expect(getHeroMotorLabel('gemini', false)).toBe('determinístico · plataforma');
    expect(shouldShowLlmCostBanner('gemini', false)).toBe(false);
  });

  it('Groq opt-in aparece no badge quando source llm', () => {
    expect(
      getEngineTurnBadge({ lastSource: 'llm', providerBadge: 'groq', legacyGeminiFab: false })
    ).toBe('Groq · dados ao vivo');
  });

  it('Gemini e API paga só com legado habilitado', () => {
    expect(
      getEngineTurnBadge({ lastSource: 'llm', providerBadge: 'gemini', legacyGeminiFab: true })
    ).toBe('Gemini · dados ao vivo');
    expect(shouldShowLlmCostBanner('gemini', true)).toBe(true);
    expect(getHeroMotorLabel('gemini', true)).toContain('Gemini');
  });
});
