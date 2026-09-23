import { describe, expect, it } from 'vitest';
import { findBestMatchingOption } from '../shared/replyFlowMatch.js';

describe('replyFlowCatchUp matching', () => {
  it('reconhece sair e quero no gate típico', () => {
    const options = [
      {
        tokens: ['sair', 'nao', 'não'],
        marketingEffect: 'opt_out',
        reply: 'ok sair',
        priority: 0,
      },
      {
        tokens: ['quero', 'sim'],
        marketingEffect: 'opt_in',
        reply: 'ok quero',
        priority: 0,
      },
    ];
    expect(findBestMatchingOption(options, 'Sair', 'word')).not.toBeNull();
    expect(findBestMatchingOption(options, 'QUERO', 'word')).not.toBeNull();
  });
});
