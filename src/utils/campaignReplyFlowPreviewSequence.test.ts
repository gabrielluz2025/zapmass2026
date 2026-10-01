import { describe, expect, it } from 'vitest';
import {
  buildReplyFlowPreviewSequence,
  dedupeReplyFlowPreviewTokens,
  formatReplyFlowOptionTrigger
} from './campaignReplyFlowPreviewSequence';

describe('dedupeReplyFlowPreviewTokens', () => {
  it('remove duplicatas case-insensitive', () => {
    expect(dedupeReplyFlowPreviewTokens(['quero', 'QUERO', 'quero'])).toEqual(['quero']);
  });
});

describe('formatReplyFlowOptionTrigger', () => {
  it('junta gatilhos únicos', () => {
    expect(
      formatReplyFlowOptionTrigger({ tokens: ['1', 'quero', 'quero'] }, 0)
    ).toBe('1 / quero');
  });

  it('usa tokensText legado', () => {
    expect(formatReplyFlowOptionTrigger({ tokensText: 'sim, SIM' }, 0)).toBe('sim');
  });
});

describe('buildReplyFlowPreviewSequence', () => {
  it('menu: opção entrada + resposta saída + conector', () => {
    const seq = buildReplyFlowPreviewSequence([
      {
        body: 'Abertura',
        options: [{ tokens: ['quero', 'quero'], reply: 'Ótimo!' }]
      },
      { body: 'Etapa 2', acceptAnyReply: true }
    ]);
    expect(seq.filter((s) => s.kind === 'in').map((s) => s.text)).toEqual(['quero']);
    expect(seq.filter((s) => s.kind === 'out').map((s) => s.text)).toEqual(['Abertura', 'Ótimo!', 'Etapa 2']);
    expect(seq.some((s) => s.kind === 'gate' && s.meta?.includes('Continua'))).toBe(true);
  });

  it('linear: conector aguardando qualquer resposta', () => {
    const seq = buildReplyFlowPreviewSequence([
      { body: 'A', acceptAnyReply: true },
      { body: 'B', acceptAnyReply: true }
    ]);
    expect(seq.find((s) => s.kind === 'gate')?.meta).toBe('Aguardando: qualquer resposta');
  });
});
