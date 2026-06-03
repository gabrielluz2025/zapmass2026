import { describe, expect, it } from 'vitest';
import {
  extractEvolutionMessageBody,
  normalizeEvolutionWebhookMessages,
  resolvePhoneDigitsFromEvolutionMessage
} from './evolutionWebhookMessages.js';

describe('normalizeEvolutionWebhookMessages', () => {
  it('aceita array direto', () => {
    const rows = [{ key: { remoteJid: '5511999999999@s.whatsapp.net' } }];
    expect(normalizeEvolutionWebhookMessages(rows)).toHaveLength(1);
  });

  it('aceita objeto com messages[]', () => {
    const data = { messages: [{ key: { remoteJid: '5511888888888@s.whatsapp.net' } }] };
    expect(normalizeEvolutionWebhookMessages(data)).toHaveLength(1);
  });

  it('aceita mensagem unica na raiz', () => {
    const data = { key: { remoteJid: '5511777777777@s.whatsapp.net' } };
    expect(normalizeEvolutionWebhookMessages(data)).toHaveLength(1);
  });
});

describe('resolvePhoneDigitsFromEvolutionMessage', () => {
  it('usa remoteJidAlt quando remoteJid e @lid', () => {
    const digits = resolvePhoneDigitsFromEvolutionMessage({
      key: {
        remoteJid: '123456789012345@lid',
        remoteJidAlt: '5511999887766@s.whatsapp.net'
      }
    });
    expect(digits).toBe('5511999887766');
  });

  it('não usa dígitos longos de @lid como telefone', () => {
    const digits = resolvePhoneDigitsFromEvolutionMessage({
      key: { remoteJid: '251174049550446@lid' }
    });
    expect(digits).toBe('');
  });
});

describe('extractEvolutionMessageBody', () => {
  it('le botoes de resposta', () => {
    const r = extractEvolutionMessageBody({
      buttonsResponseMessage: { selectedDisplayText: 'Sim' }
    });
    expect(r.bodyText).toBe('Sim');
  });

  it('desembrulha ephemeralMessage', () => {
    const r = extractEvolutionMessageBody({
      ephemeralMessage: { message: { conversation: 'oi' } }
    });
    expect(r.bodyText).toBe('oi');
  });
});
