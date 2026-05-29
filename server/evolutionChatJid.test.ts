import { describe, expect, it } from 'vitest';
import { chatRemoteJidFromFindChatsRow, formatChatListTime, isGarbagePersonChatJid, normalizeEvolutionTimestampMs, normalizeChatRemoteJid } from './evolutionChatJid.js';

describe('evolutionChatJid', () => {
  it('normaliza telefone só com dígitos para @s.whatsapp.net', () => {
    expect(normalizeChatRemoteJid('5511999887766')).toBe('5511999887766@s.whatsapp.net');
  });

  it('preserva JID com @', () => {
    expect(normalizeChatRemoteJid('5511999887766@s.whatsapp.net')).toBe('5511999887766@s.whatsapp.net');
    expect(normalizeChatRemoteJid('123456789@lid')).toBe('123456789@lid');
  });

  it('extrai remoteJid de findChats quando id é só número', () => {
    const jid = chatRemoteJidFromFindChatsRow({ id: '5511888776655', name: 'Cliente' });
    expect(jid).toBe('5511888776655@s.whatsapp.net');
  });

  it('ignora grupos na camada superior (mapEvolutionChatToConversation)', () => {
    expect(chatRemoteJidFromFindChatsRow({ id: '120363@g.us' })).toBe('120363@g.us');
  });

  it('detecta JID lixo (0 ou curto)', () => {
    expect(isGarbagePersonChatJid('0@s.whatsapp.net')).toBe(true);
    expect(isGarbagePersonChatJid('5511999887766@s.whatsapp.net')).toBe(false);
    expect(isGarbagePersonChatJid('123456789@lid')).toBe(false);
  });

  it('normaliza timestamp em segundos e milissegundos', () => {
    expect(normalizeEvolutionTimestampMs(1_717_000_000)).toBe(1_717_000_000_000);
    expect(normalizeEvolutionTimestampMs(1_717_000_000_000)).toBe(1_717_000_000_000);
  });

  it('formatChatListTime não retorna Invalid Date', () => {
    expect(formatChatListTime(NaN)).toBe('');
    expect(formatChatListTime(0)).toBe('');
  });
});
