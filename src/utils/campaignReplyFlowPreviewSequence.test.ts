import { describe, expect, it } from 'vitest';
import {
  buildReplyFlowPreviewSequence,
  dedupeReplyFlowPreviewTokens,
  formatReplyFlowOptionTrigger,
  REPLY_FLOW_PREVIEW_EMPTY_REPLY,
  resolveMenuOptionPreviewReply
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

  it('menu: uma bolha de saída por opção (resposta vazia → placeholder)', () => {
    const seq = buildReplyFlowPreviewSequence([
      {
        body: 'Abertura',
        options: [
          { tokens: ['quero'], reply: 'OK' },
          { tokens: ['sair'], reply: '' }
        ]
      }
    ]);
    const outsAfterMenu = seq.filter((s) => s.kind === 'out' && s.stepLabel?.startsWith('Resposta'));
    expect(outsAfterMenu).toHaveLength(2);
    expect(outsAfterMenu[0].text).toBe('OK');
    expect(outsAfterMenu[1].text).toBe(REPLY_FLOW_PREVIEW_EMPTY_REPLY);
  });

  it('menu: resposta vazia usa corpo da próxima etapa (como no envio real)', () => {
    const steps = [
      {
        body: 'Olá',
        options: [{ tokens: ['1'], reply: '' }, { tokens: ['2'], reply: 'Tchau' }]
      },
      { body: 'Pitch etapa 2' }
    ];
    expect(resolveMenuOptionPreviewReply(steps[0], steps[0].options![0], 0, steps)).toBe('Pitch etapa 2');
    const seq = buildReplyFlowPreviewSequence(steps);
    expect(seq.find((s) => s.stepLabel === 'Resposta 1')?.text).toBe('Pitch etapa 2');
    expect(seq.find((s) => s.stepLabel === 'Resposta 2')?.text).toBe('Tchau');
  });
});
