import { describe, expect, it } from 'vitest';
import type { Conversation } from '../types';
import {
  extractDisplayDigitSuffix,
  materializeThreadMessages,
  mergeSiblingThreadMessages,
} from './threadMessageMaterialize';

describe('extractDisplayDigitSuffix', () => {
  it('extrai sufixo de Contato - ...7976', () => {
    expect(
      extractDisplayDigitSuffix({
        id: 'c1:251174049550446@lid',
        contactName: 'Contato - ...7976',
        contactPhone: '',
        connectionId: 'c1',
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        messages: [],
        tags: [],
      })
    ).toBe('7976');
  });
});

describe('mergeSiblingThreadMessages', () => {
  it('une @lid pelo sufixo do nome …7976 com stub da campanha', () => {
    const lid: Conversation = {
      id: 'c1:251174049550446@lid',
      contactName: 'Contato - ...7976',
      contactPhone: '',
      connectionId: 'c1',
      unreadCount: 0,
      lastMessage: '',
      lastMessageTime: '',
      lastMessageTimestamp: 1_700_000_000_000,
      messages: [],
      tags: [],
    };
    const phoneStub: Conversation = {
      id: 'c1:551199997976@s.whatsapp.net',
      contactName: '+551199997976',
      contactPhone: '551199997976',
      connectionId: 'c1',
      unreadCount: 0,
      lastMessage: 'Texto campanha',
      lastMessageTime: '10:27',
      lastMessageTimestamp: 1_700_000_000_000,
      messages: [
        {
          id: 'm1',
          text: 'Texto campanha',
          timestamp: '10:27',
          sender: 'me',
          status: 'sent',
          type: 'text',
          timestampMs: 1_700_000_000_000,
          fromCampaign: true,
        },
      ],
      tags: ['Campanha'],
    };
    const merged = mergeSiblingThreadMessages(lid, [lid, phoneStub]);
    expect(materializeThreadMessages(merged)[0]?.text).toBe('Texto campanha');
  });

  it('une stub @s.whatsapp.net com thread @lid pelo sufixo do telefone', () => {
    const lid: Conversation = {
      id: 'c1:551199997976@lid',
      contactName: 'Contato · …7976',
      contactPhone: '',
      connectionId: 'c1',
      unreadCount: 0,
      lastMessage: '',
      lastMessageTime: '',
      lastMessageTimestamp: 1_700_000_000_000,
      messages: [],
      tags: [],
    };
    const phoneStub: Conversation = {
      id: 'c1:551199997976@s.whatsapp.net',
      contactName: '+551199997976',
      contactPhone: '551199997976',
      connectionId: 'c1',
      unreadCount: 0,
      lastMessage: 'Olá campanha',
      lastMessageTime: '10:27',
      lastMessageTimestamp: 1_700_000_000_000,
      messages: [
        {
          id: 'm1',
          text: 'Olá campanha',
          timestamp: '10:27',
          sender: 'me',
          status: 'sent',
          type: 'text',
          timestampMs: 1_700_000_000_000,
          fromCampaign: true,
        },
      ],
      tags: ['Campanha'],
    };
    const merged = mergeSiblingThreadMessages(lid, [lid, phoneStub]);
    const msgs = materializeThreadMessages(merged);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].text).toBe('Olá campanha');
  });
});
