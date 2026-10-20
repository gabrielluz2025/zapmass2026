import { describe, expect, it } from 'vitest';
import { SCREEN_AGENTS, ORCHESTRATOR_AGENT } from '../../shared/agentRegistry.js';
import { buildAgentRegistry, resolveActiveAgentContext, resolveScreenAgent } from './agentRegistry.js';
import { defaultAgentConfig } from './agentConfigLoader.js';

describe('agentRegistry', () => {
  it('SCREEN_AGENTS inclui dashboard Radar e campaigns Disparador', () => {
    const radar = SCREEN_AGENTS.find((a) => a.screenKey === 'dashboard');
    const disparador = SCREEN_AGENTS.find((a) => a.screenKey === 'campaigns');
    expect(radar?.name).toBe('Radar');
    expect(disparador?.name).toBe('Disparador');
  });

  it('orquestrador é ZapMass Core', () => {
    expect(ORCHESTRATOR_AGENT.name).toBe('ZapMass Core');
    expect(ORCHESTRATOR_AGENT.id).toBe('zapmass-core');
  });

  it('buildAgentRegistry expõe mappings e contagem', () => {
    const reg = buildAgentRegistry(defaultAgentConfig());
    expect(reg.ok).toBe(true);
    expect(reg.screenAgentCount).toBe(SCREEN_AGENTS.length);
    expect(reg.mappings.length).toBe(SCREEN_AGENTS.length);
    expect(reg.orchestrator.enabledTools.length).toBeGreaterThan(3);
  });

  it('override por tela altera prompt e ferramentas', () => {
    const cfg = defaultAgentConfig();
    cfg.screenAgentOverrides = [
      {
        screenKey: 'campaigns',
        systemPromptExtra: 'Foque em campanhas ativas.',
        enabledTools: ['campaigns'],
        tags: ['disparo', 'teste']
      }
    ];
    const agent = resolveScreenAgent(cfg, 'campaigns');
    expect(agent.systemPromptExtra).toContain('campanhas ativas');
    expect(agent.enabledTools).toEqual(['campaigns']);
    expect(agent.tags).toContain('teste');
  });

  it('resolveActiveAgentContext combina prompts do orquestrador e da tela', () => {
    const cfg = defaultAgentConfig();
    cfg.systemPromptExtra = 'Global';
    cfg.screenAgentOverrides = [{ screenKey: 'dashboard', systemPromptExtra: 'Radar extra' }];
    const ctx = resolveActiveAgentContext(cfg, 'dashboard');
    expect(ctx.orchestratorName).toBe('ZapMass Core');
    expect(ctx.combinedSystemPromptExtra).toContain('Global');
    expect(ctx.combinedSystemPromptExtra).toContain('Radar extra');
  });
});
