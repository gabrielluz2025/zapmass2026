import { describe, expect, it } from 'vitest';
import {
  canonicalizeInboxList,
  collapseConversationsByPhone,
  filterPgStubsShadowedByRam,
} from './collapseConversationsByPhone';
import { canonicalizeInboxList as canonicalizeFromJs } from './collapseConversationsByPhone.js';
import type { Conversation } from '../types';

const conn = 'conn_twin';
const TS = 1_760_000_000_000;

function conv(partial: Partial<Conversation> & { id: string }): Conversation {
  return {
    connectionId: conn,
    contactName: 'Gabriel Luz Novo',
    contactPhone: '',
    unreadCount: 0,
    lastMessage: 'oioo',
    lastMessageTime: '13:16',
    lastMessageTimestamp: TS,
    messages: [],
    tags: [],
    ...partial,
  } as Conversation;
}

describe('gêmeas idênticas na inbox (2.3.369)', () => {
  it('@lid sem telefone + @s.whatsapp.net com mesmo nome/prévia viram 1 linha', () => {
    const lid = conv({ id: `${conn}:251174049550446@lid` });
    const phone = conv({
      id: `${conn}:554799127801@s.whatsapp.net`,
      contactPhone: '+554799127801',
    });
    const out = collapseConversationsByPhone([lid, phone]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(`${conn}:554799127801@s.whatsapp.net`);
    expect(out[0].lastMessage).toBe('oioo');
  });

  it('canonicalizeInboxList (servidor e cliente .js) também funde as gêmeas e registra alias', () => {
    const lid = conv({ id: `${conn}:251174049550446@lid` });
    const phone = conv({
      id: `${conn}:554799127801@s.whatsapp.net`,
      contactPhone: '+554799127801',
    });
    for (const fn of [canonicalizeInboxList, canonicalizeFromJs]) {
      const res = fn([lid, phone]);
      expect(res.list).toHaveLength(1);
      expect(res.aliases.get(lid.id)).toBe(phone.id);
    }
  });

  it('mesmo id repetido no payload vira 1 linha (mesmo sem telefone resolvido)', () => {
    const a = conv({ id: `${conn}:251174049550446@lid`, lastMessage: 'oioo' });
    const b = conv({ id: `${conn}:251174049550446@lid`, lastMessage: 'oioo' });
    // @lid cru sem mensagens/prévia seria descartado; com prévia permanece
    const res = canonicalizeInboxList([a, b]);
    expect(res.list).toHaveLength(1);
  });

  it('nao funde dois telefones diferentes com mesmo nome e prévia', () => {
    const a = conv({ id: `${conn}:5511988887777@s.whatsapp.net`, contactPhone: '+5511988887777' });
    const b = conv({ id: `${conn}:5521977776666@s.whatsapp.net`, contactPhone: '+5521977776666' });
    expect(collapseConversationsByPhone([a, b])).toHaveLength(2);
  });

  it('nao funde dois @lid crus distintos só por nome/prévia', () => {
    const a = conv({ id: `${conn}:251174049550446@lid` });
    const b = conv({ id: `${conn}:299999999999999@lid` });
    expect(collapseConversationsByPhone([a, b])).toHaveLength(2);
  });

  it('nao funde por nome genérico (+telefone / Contato)', () => {
    const lid = conv({ id: `${conn}:251174049550446@lid`, contactName: 'Contato' });
    const phone = conv({
      id: `${conn}:554799127801@s.whatsapp.net`,
      contactPhone: '+554799127801',
      contactName: 'Contato',
    });
    expect(collapseConversationsByPhone([lid, phone])).toHaveLength(2);
  });

  it('nao funde com atividade distante (>12h) mesmo com nome/prévia iguais', () => {
    const lid = conv({
      id: `${conn}:251174049550446@lid`,
      lastMessageTime: '01:00',
      lastMessageTimestamp: TS - 30 * 60 * 60 * 1000,
    });
    const phone = conv({
      id: `${conn}:554799127801@s.whatsapp.net`,
      contactPhone: '+554799127801',
    });
    expect(collapseConversationsByPhone([lid, phone])).toHaveLength(2);
  });

  it('nao funde chips diferentes', () => {
    const a = conv({ id: `conn_a:251174049550446@lid`, connectionId: 'conn_a' });
    const b = conv({
      id: `conn_b:554799127801@s.whatsapp.net`,
      connectionId: 'conn_b',
      contactPhone: '+554799127801',
    });
    expect(collapseConversationsByPhone([a, b])).toHaveLength(2);
  });

  it('stub do arquivo PG gêmeo de @lid na RAM não vira 2ª ficha', () => {
    const ramLid = conv({ id: `${conn}:251174049550446@lid` });
    const stub = conv({
      id: `${conn}:554799127801@s.whatsapp.net`,
      contactPhone: '+554799127801',
      tags: ['Arquivo'],
    });
    expect(filterPgStubsShadowedByRam([ramLid], [stub])).toHaveLength(0);
  });
});
