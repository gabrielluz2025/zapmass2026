import { describe, expect, it } from 'vitest';
import {
  mergeLidPeerFields,
  peerFieldsFromEvolutionChatRow,
  pickSendableWaJidAlt
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
