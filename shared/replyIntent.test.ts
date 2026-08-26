import { describe, expect, it } from 'vitest';
import {
  classifyReplyIntent,
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
});
