import { describe, expect, it, vi } from 'vitest';
import {
  detectGlobalOptOut,
  expandNumericReplyAliases,
  findBestMatchingOption,
  matchReplyTriggerToken,
  replyMatchesGate,
  simulateReplyFlowMatch,
  isGreetingMessage,
  buildPoliteGreeting,
  formatPoliteGreetingInvalidReply,
  getBrazilHour,
} from '../shared/replyFlowMatch.js';
import { applyMessageVars, findConfiguredOptOutReply, ReplyFlowEngine } from './replyFlowEngine.js';

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

  it('deferClock mantém {horario} até o envio', () => {
    const deferred = applyMessageVars(
      '{Olá|Oi} {horario}, tudo bem?',
      '5548999999999',
      {},
      0,
      { deferClock: true }
    );
    expect(deferred).toContain('{horario}');
    expect(deferred.startsWith('Olá ')).toBe(true);

    const sent = applyMessageVars(deferred, '5548999999999', {}, 0);
    expect(sent).not.toContain('{horario}');
    expect(['Bom dia', 'Boa tarde', 'Boa noite'].some((g) => sent.includes(g))).toBe(true);
  });

  it('coluna horario do contato não sobrescreve o relógio da campanha', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T15:00:00.000Z'));
    try {
      const result = applyMessageVars(
        'Oi {horario}',
        '5548999999999',
        { horario: 'Bom dia' },
        0
      );
      expect(result).toBe('Oi Boa tarde');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('refreshCampaignGreetingInText', () => {
  it('corrige saudação no início da mensagem', async () => {
    const { refreshCampaignGreetingInText } = await import('./replyFlowEngine.js');
    const { campaignClockVars } = await import('../src/utils/campaignClockVars.js');
    const expected = campaignClockVars().horario;
    const out = refreshCampaignGreetingInText('Olá Boa tarde, como vai? Texto longo depois.');
    expect(out.startsWith(`Olá ${expected}`)).toBe(true);
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

  it('mantém a sessão se a definição ainda não carregou (não mata o gatilho)', async () => {
    const engine = new ReplyFlowEngine({
      enqueue: () => undefined,
    });
    engine.openSession({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      campaignId: 'camp-sem-def',
      vars: {},
      toRaw: '5548999999999',
    });
    const result = await engine.handleIncoming({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      bodyText: '1',
    });
    expect(result.handled).toBe(false);
    expect(engine.hasSession('conn1', '5548999999999')).toBe(true);
  });

  it('responde gatilho mesmo com a campanha pausada', async () => {
    const enqueued: string[] = [];
    const engine = new ReplyFlowEngine({
      enqueue: (item) => {
        enqueued.push(item.message);
      },
      isCampaignPaused: () => true,
    });
    engine.registerDef('camp1', [
      {
        body: 'Escolha',
        acceptAnyReply: false,
        validTokens: [],
        invalidReplyBody: '',
        options: [{ tokens: ['1'], reply: 'Beleza!' }],
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
    expect(enqueued).toEqual(['Beleza!']);
  });
});

describe('findConfiguredOptOutReply', () => {
  const steps = [
    {
      body: 'Abertura',
      acceptAnyReply: false,
      validTokens: [],
      invalidReplyBody: '',
      options: [
        { tokens: ['quero'], reply: 'Bora!', marketingEffect: 'opt_in' as const },
        { tokens: ['sair'], reply: 'Tudo bem, removemos você da lista.', marketingEffect: 'opt_out' as const },
      ],
    },
  ];

  it('devolve o texto do gatilho SAIR, não a confirmação genérica', () => {
    expect(findConfiguredOptOutReply(steps, 'SAir')).toBe('Tudo bem, removemos você da lista.');
    expect(findConfiguredOptOutReply(steps, 'quero')).toBeNull();
  });
});

describe('parseReplyFlowDefFromCampaignDoc', () => {
  it('usa o snapshot se o doc principal veio vazio', async () => {
    const { parseReplyFlowDefFromCampaignDoc } = await import('./replyFlowEngine.js');
    const parsed = parseReplyFlowDefFromCampaignDoc({
      scheduleStartSnapshot: {
        replyFlow: {
          enabled: true,
          steps: [{ body: 'Oi', acceptAnyReply: true, validTokens: [], invalidReplyBody: '' }],
        },
      },
    });
    expect(parsed?.steps[0]?.body).toBe('Oi');
  });
});

describe('ReplyFlowEngine opt-out', () => {
  it('SAIR usa a resposta do gatilho da campanha', async () => {
    const enqueued: string[] = [];
    const engine = new ReplyFlowEngine({
      enqueue: (item) => {
        enqueued.push(item.message);
      },
    });
    engine.registerDef('camp1', [
      {
        body: 'Abertura',
        acceptAnyReply: false,
        validTokens: [],
        invalidReplyBody: '',
        options: [
          { tokens: ['sair'], reply: 'Tudo bem, removemos você da lista.', marketingEffect: 'opt_out' },
        ],
      },
    ]);
    engine.openSession({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      campaignId: 'camp1',
      vars: {},
      toRaw: '5548999999999',
    });

    const result = await engine.handleIncoming({
      connectionId: 'conn1',
      phoneDigits: '5548999999999',
      bodyText: 'SAir',
    });

    expect(result.handled).toBe(true);
    expect(result.marketingEffect).toBe('opt_out');
    expect(enqueued).toEqual(['Tudo bem, removemos você da lista.']);
    expect(enqueued[0]).not.toContain('mensagens promocionais');
  });
});

describe('Detecção e retribuição de saudações educadas', () => {
  describe('isGreetingMessage', () => {
    it('detecta saudações comuns em português', () => {
      expect(isGreetingMessage('bom dia')).toBe(true);
      expect(isGreetingMessage('Bom dia!')).toBe(true);
      expect(isGreetingMessage('boa tarde')).toBe(true);
      expect(isGreetingMessage('Boa tarde!')).toBe(true);
      expect(isGreetingMessage('boa noite')).toBe(true);
      expect(isGreetingMessage('olá')).toBe(true);
      expect(isGreetingMessage('ola')).toBe(true);
      expect(isGreetingMessage('oi')).toBe(true);
      expect(isGreetingMessage('oii')).toBe(true);
      expect(isGreetingMessage('oie')).toBe(true);
      expect(isGreetingMessage('opa')).toBe(true);
      expect(isGreetingMessage('tudo bem')).toBe(true);
      expect(isGreetingMessage('tudo bom')).toBe(true);
      expect(isGreetingMessage('tudo joia')).toBe(true);
      expect(isGreetingMessage('tudo certo')).toBe(true);
      expect(isGreetingMessage('como vai')).toBe(true);
      expect(isGreetingMessage('como você está')).toBe(true);
      expect(isGreetingMessage('como vc ta')).toBe(true);
      expect(isGreetingMessage('e aí')).toBe(true);
      expect(isGreetingMessage('salve')).toBe(true);
      expect(isGreetingMessage('fala aí')).toBe(true);
      expect(isGreetingMessage('beleza')).toBe(true);
    });

    it('detecta saudações compostas e com conectivos neutros', () => {
      expect(isGreetingMessage('Olá, bom dia! Tudo bem com você?')).toBe(true);
      expect(isGreetingMessage('Oi bom dia tudo bem')).toBe(true);
      expect(isGreetingMessage('Opa, e aí amigo, tudo bem por aí?')).toBe(true);
      expect(isGreetingMessage('Boa tarde amigo')).toBe(true);
      expect(isGreetingMessage('Ola pessoal tudo bom')).toBe(true);
    });

    it('não considera como saudação pura quando houver outro conteúdo ou tokens de opção', () => {
      expect(isGreetingMessage('1')).toBe(false);
      expect(isGreetingMessage('sim')).toBe(false);
      expect(isGreetingMessage('quero')).toBe(false);
      expect(isGreetingMessage('sair')).toBe(false);
      expect(isGreetingMessage('amigo')).toBe(false);
      expect(isGreetingMessage('bom dia quero a opcao 1')).toBe(false);
      expect(isGreetingMessage('olá 1')).toBe(false);
      expect(isGreetingMessage('boa tarde qual o preco')).toBe(false);
      expect(isGreetingMessage('')).toBe(false);
    });
  });

  describe('buildPoliteGreeting e cálculo de horário', () => {
    it('manhã (05:00 às 11:59): Bom dia! Tudo bem?', () => {
      const morningDate = new Date('2026-06-15T12:00:00.000Z'); // 12:00 UTC = 09:00 BRT
      expect(getBrazilHour(morningDate)).toBe(9);
      expect(buildPoliteGreeting('Bom dia', morningDate)).toBe('Bom dia! Tudo bem?');
      expect(buildPoliteGreeting('Olá', morningDate)).toBe('Bom dia! Tudo bem?');
      expect(buildPoliteGreeting('Tudo bem', morningDate)).toBe('Bom dia! Tudo bem?');
    });

    it('tarde (12:00 às 17:59): Boa tarde! Tudo bem?', () => {
      const afternoonDate = new Date('2026-06-15T17:00:00.000Z'); // 17:00 UTC = 14:00 BRT
      expect(getBrazilHour(afternoonDate)).toBe(14);
      expect(buildPoliteGreeting('Boa tarde', afternoonDate)).toBe('Boa tarde! Tudo bem?');
      expect(buildPoliteGreeting('Olá', afternoonDate)).toBe('Boa tarde! Tudo bem?');
    });

    it('noite (18:00 às 04:59): Boa noite! Tudo bem?', () => {
      const nightDate = new Date('2026-06-15T23:00:00.000Z'); // 23:00 UTC = 20:00 BRT
      expect(getBrazilHour(nightDate)).toBe(20);
      expect(buildPoliteGreeting('Boa noite', nightDate)).toBe('Boa noite! Tudo bem?');
      expect(buildPoliteGreeting('Oi', nightDate)).toBe('Boa noite! Tudo bem?');

      const dawnDate = new Date('2026-06-15T06:00:00.000Z'); // 06:00 UTC = 03:00 BRT
      expect(getBrazilHour(dawnDate)).toBe(3);
      expect(buildPoliteGreeting('Boa noite', dawnDate)).toBe('Boa noite! Tudo bem?');
    });

    it('se mandar "Bom dia" à tarde, retribui cordialmente no horário correto', () => {
      const afternoonDate = new Date('2026-06-15T18:00:00.000Z'); // 18:00 UTC = 15:00 BRT
      expect(buildPoliteGreeting('Bom dia', afternoonDate)).toBe('Olá, boa tarde! Tudo bem?');
    });

    it('se mandar "Boa tarde" de manhã, retribui cordialmente no horário correto', () => {
      const morningDate = new Date('2026-06-15T13:00:00.000Z'); // 13:00 UTC = 10:00 BRT
      expect(buildPoliteGreeting('Boa tarde', morningDate)).toBe('Olá, bom dia! Tudo bem?');
    });
  });

  describe('formatPoliteGreetingInvalidReply', () => {
    it('suaviza o "Não entendi" padrão para uma mensagem acolhedora', () => {
      const formatted = formatPoliteGreetingInvalidReply(
        'Não entendi. Responda com uma das opções válidas.',
        'Bom dia! Tudo bem?'
      );
      expect(formatted).toBe('Bom dia! Tudo bem? Para eu te ajudar da melhor forma, por favor responda com uma das opções válidas.');
    });

    it('suaviza quando já começa com Por favor', () => {
      const formatted = formatPoliteGreetingInvalidReply(
        'Não entendi! Por favor escolha uma das opções.',
        'Boa tarde! Tudo bem?'
      );
      expect(formatted).toBe('Boa tarde! Tudo bem? Para eu te ajudar da melhor forma, por favor escolha uma das opções.');
    });

    it('lida com texto vazio fornecendo instrução padrão acolhedora', () => {
      const formatted = formatPoliteGreetingInvalidReply('', 'Boa noite! Tudo bem?');
      expect(formatted).toBe('Boa noite! Tudo bem? Para eu te ajudar da melhor forma, por favor escolha uma das opções acima.');
    });
  });

  describe('ReplyFlowEngine com saudações educadas', () => {
    it('retribui saudação amigavelmente e não penaliza invalidReplyCount quando ativado', async () => {
      const enqueued: string[] = [];
      const engine = new ReplyFlowEngine({
        enqueue: (item) => {
          enqueued.push(item.message);
        },
      });

      engine.registerDef(
        'camp-greeting',
        [
          {
            body: 'Qual o seu setor? 1 - Vendas, 2 - Suporte',
            acceptAnyReply: false,
            validTokens: [],
            invalidReplyBody: 'Não entendi. Responda com uma das opções válidas.',
            options: [
              { tokens: ['1'], reply: 'Você escolheu Vendas!' },
              { tokens: ['2'], reply: 'Você escolheu Suporte!' },
            ],
          },
        ],
        { politeGreetingEnabled: true, maxInvalidReplyAttempts: 3 }
      );

      engine.openSession({
        connectionId: 'conn1',
        phoneDigits: '5548999999999',
        campaignId: 'camp-greeting',
        vars: {},
        toRaw: '5548999999999',
      });

      // 1ª saudação do contato
      await engine.handleIncoming({
        connectionId: 'conn1',
        phoneDigits: '5548999999999',
        bodyText: 'Bom dia',
      });

      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toContain('Tudo bem? Para eu te ajudar da melhor forma, por favor responda com uma das opções válidas.');
      expect(enqueued[0]).not.toMatch(/^Não entendi\./);

      const sess = (engine as any).findSession('conn1', '5548999999999')?.session;
      expect(sess?.invalidReplyCount ?? 0).toBe(0);
      expect(sess?.greetingReplyCount).toBe(1);

      // 2ª saudação do contato
      await engine.handleIncoming({
        connectionId: 'conn1',
        phoneDigits: '5548999999999',
        bodyText: 'Tudo bem',
      });

      expect(enqueued).toHaveLength(2);
      expect(sess?.invalidReplyCount ?? 0).toBe(0);
      expect(sess?.greetingReplyCount).toBe(2);

      // Agora o contato responde com a opção '1'
      await engine.handleIncoming({
        connectionId: 'conn1',
        phoneDigits: '5548999999999',
        bodyText: '1',
      });

      expect(enqueued).toHaveLength(3);
      expect(enqueued[2]).toBe('Você escolheu Vendas!');
    });

    it('dispara diretamente a mensagem de inválida e incrementa invalidReplyCount quando desativado', async () => {
      const enqueued: string[] = [];
      const engine = new ReplyFlowEngine({
        enqueue: (item) => {
          enqueued.push(item.message);
        },
      });

      engine.registerDef(
        'camp-no-greeting',
        [
          {
            body: 'Escolha 1 ou 2',
            acceptAnyReply: false,
            validTokens: [],
            invalidReplyBody: 'Não entendi. Responda com uma das opções válidas.',
            options: [
              { tokens: ['1'], reply: 'Opção 1' },
            ],
          },
        ],
        { politeGreetingEnabled: false, maxInvalidReplyAttempts: 3 }
      );

      engine.openSession({
        connectionId: 'conn1',
        phoneDigits: '5548999999999',
        campaignId: 'camp-no-greeting',
        vars: {},
        toRaw: '5548999999999',
      });

      await engine.handleIncoming({
        connectionId: 'conn1',
        phoneDigits: '5548999999999',
        bodyText: 'Bom dia',
      });

      expect(enqueued).toEqual(['Não entendi. Responda com uma das opções válidas.']);
      const sess = (engine as any).findSession('conn1', '5548999999999')?.session;
      expect(sess?.invalidReplyCount).toBe(1);
    });

    it('simula saudação educada no simulateReplyFlowMatch', () => {
      const simGreeting = simulateReplyFlowMatch({
        bodyText: 'Bom dia',
        options: [{ tokens: ['1'], reply: 'Sim' }],
        invalidReplyBody: 'Não entendi. Responda com uma das opções válidas.',
        politeGreetingEnabled: true,
      });

      expect(simGreeting.kind).toBe('greeting');
      expect(simGreeting.message).toContain('Tudo bem? Para eu te ajudar da melhor forma');

      const simDisabled = simulateReplyFlowMatch({
        bodyText: 'Bom dia',
        options: [{ tokens: ['1'], reply: 'Sim' }],
        invalidReplyBody: 'Não entendi. Responda com uma das opções válidas.',
        politeGreetingEnabled: false,
      });

      expect(simDisabled.kind).toBe('invalid');
      expect(simDisabled.message).toBe('Não entendi. Responda com uma das opções válidas.');
    });
  });
});
