import { describe, expect, it } from 'vitest';
import {
  deepScanPnJidFromRecord,
  mergeLidPeerFields,
  normalizeCanonicalRemoteJid,
  normalizeMessagesUpsertPayloadForThreads,
  peerFieldsFromEvolutionChatRow,
  peerFromStoredMessages,
  pickSendableWaJidAlt,
} from './evolutionLidResolve.js';

describe('pickSendableWaJidAlt', () => {
  it('ignora @lid e aceita @s.whatsapp.net', () => {
    expect(pickSendableWaJidAlt('251174049550446@lid', '5511999887766@s.whatsapp.net')).toBe(
      '5511999887766@s.whatsapp.net'
    );
  });
});

describe('mergeLidPeerFields', () => {
  it('não grava dígitos LID como telefone', () => {
    const peer = mergeLidPeerFields('251174049550446@lid', {
      contactPhone: '+251174049550446'
    });
    expect(peer.contactPhone).toBe('');
  });

  it('usa waJidAlt com telefone real', () => {
    const peer = mergeLidPeerFields('251174049550446@lid', {
      waJidAlt: '5511888777666@s.whatsapp.net'
    });
    expect(peer.contactPhone).toBe('+5511888777666');
  });
});

describe('peerFromStoredMessages', () => {
  it('lê waSenderPn das mensagens em cache', () => {
    const peer = peerFromStoredMessages([
      {
        id: '1',
        text: 'oi',
        timestamp: '10:00',
        sender: 'them',
        status: 'delivered',
        type: 'text',
        waSenderPn: '5511999887766@s.whatsapp.net'
      }
    ]);
    expect(peer?.contactPhone).toBe('+5511999887766');
  });
});

describe('deepScanPnJidFromRecord', () => {
  it('acha JID em objeto aninhado', () => {
    const jid = deepScanPnJidFromRecord({
      payload: { nested: { x: '5511888777666@s.whatsapp.net' } }
    });
    expect(jid).toBe('5511888777666@s.whatsapp.net');
  });
});

describe('peerFieldsFromEvolutionChatRow', () => {
  it('extrai senderPn do lastMessage', () => {
    const peer = peerFieldsFromEvolutionChatRow({
      remoteJid: '251174049550446@lid',
      lastMessage: {
        key: {
          remoteJid: '251174049550446@lid',
          senderPn: '5511999887766@s.whatsapp.net'
        }
      }
    });
    expect(peer.contactPhone).toBe('+5511999887766');
    expect(peer.waJidAlt).toBe('5511999887766@s.whatsapp.net');
  });
});

describe('normalizeCanonicalRemoteJid', () => {
  it('unifica @lid para @s.whatsapp.net com telefone resolvido', () => {
    const r = normalizeCanonicalRemoteJid({
      remoteJid: '251174049550446@lid',
      remoteJidAlt: '5542999870542@s.whatsapp.net',
    });
    expect(r.remoteJid).toBe('5542999870542@s.whatsapp.net');
    expect(r.phoneDigits).toBe('5542999870542');
    expect(r.aliasRemoteJids).toContain('251174049550446@lid');
  });

  it('normaliza 9º dígito BR no JID canônico', () => {
    const r = normalizeCanonicalRemoteJid({
      remoteJid: '554799127001@s.whatsapp.net',
    });
    expect(r.remoteJid).toBe('5547999127001@s.whatsapp.net');
    expect(r.phoneDigits).toBe('5547999127001');
  });

  it('fromMe: remoteJid do chip → destinatário via remoteJidAlt', () => {
    const r = normalizeCanonicalRemoteJid({
      remoteJid: '5547999127001@s.whatsapp.net',
      remoteJidAlt: '5542999870542@s.whatsapp.net',
      fromMe: true,
      instancePhoneDigits: '5547999127001',
    });
    expect(r.remoteJid).toBe('5542999870542@s.whatsapp.net');
    expect(r.phoneDigits).toBe('5542999870542');
  });
});

describe('normalizeMessagesUpsertPayloadForThreads', () => {
  it('reescreve key.remoteJid no payload messages[]', () => {
    const payload = {
      messages: [
        {
          key: {
            remoteJid: '251174049550446@lid',
            remoteJidAlt: '5542999870542@s.whatsapp.net',
            fromMe: false,
            id: 'ABC',
          },
        },
      ],
    };
    normalizeMessagesUpsertPayloadForThreads(payload, '5547999127001');
    expect(payload.messages[0]!.key.remoteJid).toBe('5542999870542@s.whatsapp.net');
  });

  it('corrige fromMe quando remoteJid é o próprio chip', () => {
    const payload = {
      key: {
        remoteJid: '5547999127001@s.whatsapp.net',
        remoteJidAlt: '5542999870542@s.whatsapp.net',
        fromMe: true,
        id: 'OUT1',
      },
    };
    normalizeMessagesUpsertPayloadForThreads(payload, '5547999127001');
    expect(payload.key.remoteJid).toBe('5542999870542@s.whatsapp.net');
  });
});
