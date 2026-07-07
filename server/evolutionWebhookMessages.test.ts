import { describe, expect, it } from 'vitest';
import {
  extractEvolutionMessageBody,
  normalizeEvolutionWebhookMessages,
  parseEvolutionChatContent,
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

describe('parseEvolutionChatContent', () => {
  it('figurinha dentro de viewOnceMessage', () => {
    const parsed = parseEvolutionChatContent({
      viewOnceMessage: { message: { stickerMessage: { url: 'https://cdn.example/st.webp' } } },
    });
    expect(parsed.type).toBe('sticker');
    expect(parsed.text).toContain('Figurinha');
  });

  it('mensagem interativa / cartão', () => {
    const parsed = parseEvolutionChatContent({
      interactiveMessage: {
        body: { text: 'Feliz aniversário!' },
        nativeFlowMessage: {
          buttons: [{ name: 'cta_url', buttonParamsJson: '{"display_text":"Abrir presente"}' }],
        },
      },
    });
    expect(parsed.type).toBe('text');
    expect(parsed.text).toContain('Feliz aniversário');
    expect(parsed.text).toContain('Abrir presente');
  });

  it('contato compartilhado', () => {
    const parsed = parseEvolutionChatContent({
      contactMessage: { displayName: 'Maria Silva' },
    });
    expect(parsed.text).toContain('Maria Silva');
  });

  it('tipo desconhecido nunca fica vazio', () => {
    const parsed = parseEvolutionChatContent({
      unknownFutureMessage: { foo: 'bar' } as unknown as Record<string, unknown>,
    });
    expect(parsed.text.length).toBeGreaterThan(0);
  });
});
