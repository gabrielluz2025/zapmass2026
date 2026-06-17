import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import {
  buildCampaignSendTimestampsFromLogs,
  firstReplyAfterCampaignSend,
  hasCampaignSendLogForPhone,
  latestCampaignSendTimestampMs
} from './campaignReplyScope';

const mk = (partial: Partial<ChatMessage> & { sender: 'me' | 'them' }): ChatMessage =>
  ({
    id: '1',
    text: 'x',
    timestamp: '',
    type: 'text',
    ...partial
  }) as ChatMessage;

describe('campaignReplyScope', () => {
  it('ignora envio manual ao buscar sendTs da campanha', () => {
    const msgs = [
      mk({ sender: 'me', timestampMs: 1000, text: 'manual' }),
      mk({ sender: 'me', timestampMs: 2000, fromCampaign: true, campaignId: 'c-a', text: 'campanha' })
    ];
    expect(latestCampaignSendTimestampMs(msgs, 'c-a')).toBe(2000);
    expect(latestCampaignSendTimestampMs(msgs, 'c-b')).toBe(0);
  });

  it('não pega resposta anterior ao envio da campanha', () => {
    const msgs = [
      mk({ sender: 'them', timestampMs: 1000, text: 'antiga' }),
      mk({ sender: 'me', timestampMs: 5000, fromCampaign: true, campaignId: 'c1' }),
      mk({ sender: 'them', timestampMs: 6000, text: 'depois' })
    ];
    expect(firstReplyAfterCampaignSend(msgs, 5000)?.text).toBe('depois');
  });

  it('buildCampaignSendTimestampsFromLogs usa último envio por telefone', () => {
    const logs = [
      {
        timestamp: '2026-01-01T10:00:00Z',
        payload: { campaignId: 'c1', message: 'Mensagem enviada', to: '5511999999999' }
      },
      {
        timestamp: '2026-01-01T10:05:00Z',
        payload: { campaignId: 'c1', message: 'Mensagem enviada', to: '5511999999999' }
      }
    ];
    const map = buildCampaignSendTimestampsFromLogs(logs, 'c1');
    expect(map.get('5511999999999')).toBe(new Date('2026-01-01T10:05:00Z').getTime());
  });

  it('hasCampaignSendLogForPhone exige log de envio da mesma campanha', () => {
    const logs = [
      {
        timestamp: '2026-01-01T10:00:00Z',
        payload: { campaignId: 'c1', message: 'Mensagem enviada', to: '5511999999999' }
      },
      {
        timestamp: '2026-01-01T11:00:00Z',
        payload: { campaignId: 'c2', message: 'Resposta do contato', to: '5511999999999' }
      }
    ];
    expect(hasCampaignSendLogForPhone(logs, 'c1', '5511999999999')).toBe(true);
    expect(hasCampaignSendLogForPhone(logs, 'c2', '5511999999999')).toBe(false);
  });
});
