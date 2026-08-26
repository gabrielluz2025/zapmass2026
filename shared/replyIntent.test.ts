import { describe, expect, it } from 'vitest';
import {
  classifyReplyIntent,
  classifyReplyIntentFromHistory,
  autoApplyLeadClassFromIntent,
  findActionableReplyInHistory,
  isPoliteAcknowledgment,
  isPositiveCampaignIntent,
} from './replyFlowMatch.ts';

describe('reply intent classification', () => {
  it('trata amém e tamo junto como cortesia, não quero', () => {
    expect(isPoliteAcknowledgment('Amém')).toBe(true);
    expect(isPoliteAcknowledgment('Paz do Senhor Amém Deus abençoe')).toBe(true);
    expect(isPoliteAcknowledgment('tamo junto')).toBe(true);
    expect(isPositiveCampaignIntent('Amém')).toBe(false);
    expect(isPositiveCampaignIntent('tamo junto')).toBe(false);
  });

  it('reconhece quero e sim como interesse', () => {
    expect(isPositiveCampaignIntent('Quero')).toBe(true);
    expect(isPositiveCampaignIntent('sim')).toBe(true);
    expect(classifyReplyIntent('quero').kind).toBe('opt_in');
  });

  it('não confunde não quero com opt-in', () => {
    const r = classifyReplyIntent('não quero');
    expect(r.kind).toBe('opt_out');
    expect(isPositiveCampaignIntent('não quero')).toBe(false);
  });

  it('classifica sair como opt-out', () => {
    expect(classifyReplyIntent('sair').kind).toBe('opt_out');
  });

  it('usa fluxo configurado quando disponível', () => {
    const r = classifyReplyIntent('quero', {
      options: [{ tokens: ['quero'], reply: 'Ótimo!' }],
    });
    expect(r.kind).toBe('flow_match');
    expect(r.suggestedLeadClass).toBe('hot');
  });

  it('lista negra quando disse quero e depois sair', () => {
    const r = classifyReplyIntentFromHistory(['quero', 'sair']);
    expect(r.kind).toBe('opt_out');
    expect(r.queroThenSair).toBe(true);
    expect(r.suggestedLeadClass).toBe('blacklist');
    expect(autoApplyLeadClassFromIntent(r)).toBe('blacklist');
  });

  it('quero isolado vira quente na auto-aplicação', () => {
    const r = classifyReplyIntentFromHistory(['quero']);
    expect(r.kind).toBe('opt_in');
    expect(autoApplyLeadClassFromIntent(r)).toBe('hot');
  });

  it('encontra quero no historico mesmo se ultima msg for neutra', () => {
    const hit = findActionableReplyInHistory(['quero', 'obrigado']);
    expect(hit?.classification).toBe('hot');
    expect(hit?.replyText).toBe('quero');
  });

  it('encontra sair apos quero no meio do historico', () => {
    const hit = findActionableReplyInHistory(['quero', 'obrigado', 'sair']);
    expect(hit?.classification).toBe('blacklist');
    expect(hit?.queroThenSair).toBe(true);
  });
});
