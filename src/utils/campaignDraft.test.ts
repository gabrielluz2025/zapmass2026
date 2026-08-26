import { describe, expect, it } from 'vitest';
import { CampaignStatus, type Campaign } from '../types';
import { buildDraftFromCampaign } from './campaignDraft';

const baseCampaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: 'c1',
  name: 'Teste fluxo',
  message: 'Ola {nome}',
  totalContacts: 10,
  processedCount: 0,
  successCount: 0,
  failedCount: 0,
  status: CampaignStatus.COMPLETED,
  selectedConnectionIds: ['chip-1'],
  createdAt: new Date().toISOString(),
  ...over
});

describe('buildDraftFromCampaign', () => {
  it('clona fluxo por resposta com gatilhos, opções e timeout', () => {
    const draft = buildDraftFromCampaign(
      baseCampaign({
        replyFlow: {
          enabled: true,
          globalOptOutEnabled: true,
          globalOptOutKeywords: ['pare', 'stop'],
          steps: [
            {
              body: 'Quer saber mais? Responda 1 ou 2',
              acceptAnyReply: false,
              validTokens: ['1', '2'],
              invalidReplyBody: 'Opcao invalida',
              marketingEffect: 'none',
              matchMode: 'numeric_exact',
              timeoutHours: 24,
              timeoutMessage: 'Encerramos por falta de resposta.',
              options: [
                {
                  tokens: ['1', 'quero'],
                  reply: 'Otimo! Segue o link.',
                  marketingEffect: 'opt_in',
                  priority: 2,
                  matchMode: 'word'
                },
                {
                  tokens: ['2', 'sair'],
                  reply: 'Sem problemas.',
                  marketingEffect: 'opt_out'
                }
              ]
            },
            {
              body: 'Obrigado!',
              acceptAnyReply: true
            }
          ]
        }
      })
    );

    expect(draft.campaignFlowMode).toBe('reply');
    expect(draft.messageStages).toHaveLength(2);
    expect(draft.replyFlowGlobalOptOutEnabled).toBe(true);
    expect(draft.replyFlowGlobalOptOutKeywordsText).toBe('pare, stop');

    const step0 = draft.messageStages[0];
    expect(step0.body).toContain('Quer saber mais');
    expect(step0.optionsMode).toBe('conditional');
    expect(step0.matchMode).toBe('numeric_exact');
    expect(step0.timeoutHours).toBe(24);
    expect(step0.timeoutMessage).toContain('Encerramos');
    expect(step0.options).toHaveLength(2);
    expect(step0.options![0].tokensText).toBe('1, quero');
    expect(step0.options![0].reply).toContain('Otimo');
    expect(step0.options![0].marketingEffect).toBe('opt_in');
    expect(step0.options![1].tokensText).toBe('2, sair');
  });

  it('usa replyFlow do scheduleStartSnapshot quando doc principal nao tem', () => {
    const draft = buildDraftFromCampaign(
      baseCampaign({
        scheduleStartSnapshot: {
          numbers: ['5511999999999'],
          message: 'Oi',
          replyFlow: {
            enabled: true,
            steps: [{ body: 'Menu: 1 sim 2 nao', options: [{ tokens: ['1'], reply: 'Sim!' }] }]
          }
        }
      })
    );

    expect(draft.campaignFlowMode).toBe('reply');
    expect(draft.messageStages[0].options).toHaveLength(1);
    expect(draft.messageStages[0].options![0].reply).toBe('Sim!');
  });

  it('campanha simples vira modo single com uma mensagem', () => {
    const draft = buildDraftFromCampaign(
      baseCampaign({
        message: 'So disparo unico',
        messageStages: ['nao deve aparecer como etapa reply']
      })
    );

    expect(draft.campaignFlowMode).toBe('single');
    expect(draft.messageStages).toHaveLength(1);
    expect(draft.messageStages[0].body).toBe('So disparo unico');
  });
});
