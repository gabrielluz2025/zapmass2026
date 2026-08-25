import { describe, expect, it } from 'vitest';
import {
  detectGlobalOptOut,
  expandNumericReplyAliases,
  findBestMatchingOption,
  matchReplyTriggerToken,
  replyMatchesGate,
  simulateReplyFlowMatch,
} from '../shared/replyFlowMatch.js';
import { applyMessageVars, ReplyFlowEngine } from './replyFlowEngine.js';

const matched = (cleanTok: string, body: string, mode?: Parameters<typeof matchReplyTriggerToken>[2]) =>
  matchReplyTriggerToken(cleanTok, body, mode).matched;

describe('applyMessageVars', () => {
  it('resolve o SpinTrax observado sem consumir variáveis de personalização', () => {
    const template = '{Olá|Oi|Paz|E aí|Bom dia} {nome} {horario}';
    const result = applyMessageVars(template, '5548999999999', { nome: 'Marcos' }, 0);

    expect(result).toBe('Olá Marcos ' + result.split(' ').slice(2).join(' '));
    expect(result).not.toContain('{Olá|Oi|Paz|E aí|Bom dia}');
    expect(result).not.toContain('{nome}');
    expect(result).not.toContain('{horario}');
  });
});

describe('matchReplyTriggerToken', () => {
  it('aceita resposta exata', () => {
    expect(matched('1', '1')).toBe(true);
    expect(matched('excluir', 'excluir')).toBe(true);
  });

  it('aceita palavra-chave com pontuação', () => {
    expect(matched('1', '1!')).toBe(true);
    expect(matched('sim', 'Sim,')).toBe(true);
  });

  it('aceita palavra-chave em qualquer posição da frase', () => {
    expect(matched('1', 'OI!! 1')).toBe(true);
    expect(matched('excluir', 'quero excluir')).toBe(true);
  });

  it('não confunde substring dentro de outra palavra', () => {
    expect(matched('sim', 'simples')).toBe(false);
    expect(matched('1', '10')).toBe(false);
  });

  it('modo numeric_exact', () => {
    expect(matched('1', '1', 'numeric_exact')).toBe(true);
    expect(matched('1', '10', 'numeric_exact')).toBe(false);
    expect(matched('1', 'opção 1', 'numeric_exact')).toBe(false);
  });

  it('modo contains', () => {
    expect(matched('excluir', 'eu quero excluir agora', 'contains')).toBe(true);
    expect(matched('nao quero', 'eu nao quero mais', 'contains')).toBe(true);
  });
});

describe('expandNumericReplyAliases', () => {
  it('converte um/dois e emoji numérico', () => {
    expect(expandNumericReplyAliases('um')).toBe('1');
    expect(expandNumericReplyAliases('dois')).toBe('2');
    expect(expandNumericReplyAliases('1️⃣')).toBe('1');
  });
});

describe('detectGlobalOptOut', () => {
  it('reconhece palavras de descadastro', () => {
    expect(detectGlobalOptOut('quero sair').matched).toBe(true);
    expect(detectGlobalOptOut('EXCLUIR').matched).toBe(true);
    expect(detectGlobalOptOut('sim quero').matched).toBe(false);
  });
});

describe('findBestMatchingOption', () => {
  it('prioriza gatilho com maior priority', () => {
    const hit = findBestMatchingOption(
      [
        { tokens: ['sim'], priority: 0, reply: 'a' },
        { tokens: ['excluir'], priority: 10, reply: 'b' },
      ],
      'quero excluir'
    );
    expect(hit?.optionIndex).toBe(1);
    expect(hit?.matchedToken).toBe('excluir');
  });

  it('prefere gatilho mais longo em empate de priority', () => {
    const hit = findBestMatchingOption(
      [
        { tokens: ['nao'], priority: 0, reply: 'a' },
        { tokens: ['nao quero'], priority: 0, reply: 'b' },
      ],
      'eu nao quero receber'
    );
    expect(hit?.matchedToken).toBe('nao quero');
  });
});

describe('replyMatchesGate', () => {
  const step = {
    body: 'test',
    acceptAnyReply: false,
    validTokens: ['excluir', '1'],
    invalidReplyBody: '',
  };

  it('dispara com qualquer token válido na frase', () => {
    expect(replyMatchesGate(step, 'quero excluir')).toBe(true);
    expect(replyMatchesGate(step, 'ok 1')).toBe(true);
  });
});

describe('simulateReplyFlowMatch', () => {
  it('simula rota do menu', () => {
    const r = simulateReplyFlowMatch({
      bodyText: 'OI 1',
      options: [{ tokens: ['1', 'sim'], reply: 'Opção A' }],
      invalidReplyBody: 'Invalido',
    });
    expect(r.kind).toBe('option');
    expect(r.optionIndex).toBe(0);
  });

  it('simula fallback', () => {
    const r = simulateReplyFlowMatch({
      bodyText: 'xyz',
      options: [{ tokens: ['1'], reply: 'A' }],
      invalidReplyBody: 'Tente de novo',
    });
    expect(r.kind).toBe('invalid');
    expect(r.message).toContain('Tente de novo');
  });
});

describe('ReplyFlowEngine resume', () => {
  it('mantém sessão após match de menu até envio confirmado', async () => {
    const enqueued: Array<{ message: string; replyFlowDisposeAfterSend?: boolean }> = [];
    const engine = new ReplyFlowEngine({
      enqueue: (item) => {
        enqueued.push(item);
      },
    });
    engine.registerDef('camp1', [
      {
        body: 'Escolha',
        acceptAnyReply: false,
        validTokens: [],
        invalidReplyBody: '',
        options: [{ tokens: ['quero'], reply: 'Ótimo!' }],
      },
    ]);
    engine.openSession({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      campaignId: 'camp1',
      vars: {},
      toRaw: '5548999999999',
    });

    await engine.handleIncoming({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      bodyText: 'quero',
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].replyFlowDisposeAfterSend).toBe(true);
    expect(engine.hasSession('conn1', '5548999999999')).toBe(true);

    engine.confirmReplyFlowOutboundDelivered('conn1', '5548999999999', true);
    expect(engine.hasSession('conn1', '5548999999999')).toBe(false);
  });

  it('rollback libera nova tentativa após falha de envio', async () => {
    const enqueued: string[] = [];
    const engine = new ReplyFlowEngine({
      enqueue: (item) => {
        enqueued.push(item.message);
      },
    });
    engine.registerDef('camp1', [
      {
        body: 'Escolha',
        acceptAnyReply: false,
        validTokens: [],
        invalidReplyBody: '',
        options: [{ tokens: ['1'], reply: 'Opção A' }],
      },
    ]);
    engine.openSession({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      campaignId: 'camp1',
      vars: {},
      toRaw: '5548999999999',
    });

    await engine.handleIncoming({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      bodyText: '1',
    });
    expect(enqueued).toHaveLength(1);

    engine.rollbackPendingOutbound('conn1', '5548999999999');

    await engine.handleIncoming({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      bodyText: '1',
    });
    expect(enqueued).toHaveLength(2);
  });
});
