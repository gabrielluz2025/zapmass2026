import { describe, expect, it } from 'vitest';
import { chatRemoteJidFromFindChatsRow, normalizeChatRemoteJid } from './evolutionChatJid.js';

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
});
