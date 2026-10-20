import { describe, expect, it, afterEach } from 'vitest';
import { mergeAgentConfigPartial, defaultAgentConfig } from './agentConfigLoader.js';
import { resolveAgentLlmProvider, resolveAgentProvider } from './agentLlmConfig.js';
import { getStaticKnowledgeChunks, formatRagAnswer } from './knowledgeService.js';
import { AGENT_TOOLS } from './toolRegistry.js';

describe('agent MVP smoke', () => {
  it('merge config parcial mantém defaults', () => {
    const cfg = mergeAgentConfigPartial({ enabled: false, systemPromptExtra: 'teste' });
    expect(cfg.enabled).toBe(false);
    expect(cfg.systemPromptExtra).toBe('teste');
    expect(cfg.starterSuggestions.length).toBeGreaterThan(0);
  });

  it('defaultAgentConfig é estável', () => {
    const a = defaultAgentConfig();
    const b = defaultAgentConfig();
    expect(a.enabled).toBe(b.enabled);
    expect(a.knowledgeOverrides).toEqual([]);
  });

  it('knowledge estático retorna chunks', () => {
    const chunks = getStaticKnowledgeChunks();
    expect(chunks.length).toBeGreaterThan(3);
  });

  it('formatRagAnswer funciona com hit mínimo', () => {
    const chunks = getStaticKnowledgeChunks();
    const rag = formatRagAnswer([{ chunk: chunks[0], score: 5 }]);
    expect(rag?.answer.length).toBeGreaterThan(10);
  });

  it('tool registry inclui tenant_snapshot', () => {
    expect(AGENT_TOOLS.some((t) => t.id === 'tenant_snapshot')).toBe(true);
    expect(AGENT_TOOLS.some((t) => t.id === 'admin_ops_snapshot')).toBe(true);
    expect(AGENT_TOOLS.some((t) => t.id === 'chat_conversations')).toBe(true);
    expect(AGENT_TOOLS.some((t) => t.scope === 'tenant')).toBe(true);
    expect(AGENT_TOOLS.some((t) => t.scope === 'platform')).toBe(true);
  });

  it('AGENT_LLM_PROVIDER default é none', () => {
    const prev = process.env.AGENT_LLM_PROVIDER;
    delete process.env.AGENT_LLM_PROVIDER;
    expect(resolveAgentLlmProvider()).toBe('none');
    expect(resolveAgentProvider()).toBe('none');
    if (prev !== undefined) process.env.AGENT_LLM_PROVIDER = prev;
  });
});

afterEach(() => {
  delete process.env.AGENT_LLM_PROVIDER;
});
