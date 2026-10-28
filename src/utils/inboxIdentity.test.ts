import { describe, expect, it } from 'vitest';
import {
  canonicalizeInboxList,
  collapseConversationsByPhone,
  collapseConversationsByPhoneDetailed,
  filterPgStubsShadowedByRam,
  findCanonicalConversationIdForPhone,
  isJunkInboxConversation,
  isJunkInboxJid,
  sanitizeInboxConversationDisplay,
} from './collapseConversationsByPhone';
import { canonicalizeInboxList as canonicalizeFromJs } from './collapseConversationsByPhone.js';
import type { Conversation } from '../types';

const CONN = 'uid1__conn_chipA';
const GABRIEL_PHONE = '5547999127001';

const conv = (over: Partial<Conversation> & { id: string }): Conversation => ({
  contactName: 'Contato',
  contactPhone: '',
  connectionId: CONN,
  unreadCount: 0,
  lastMessage: '',
  lastMessageTime: '',
  lastMessageTimestamp: 0,
  messages: [],
  tags: [],
  ...over,
});

const msg = (id: string, ts: number, text: string, sender: 'me' | 'them' = 'me') => ({
  id,
  text,
  timestamp: '10:33',
  sender,
  timestampMs: ts,
  status: 'sent' as const,
  type: 'text' as const,
});

describe('identidade da inbox (servidor autoritativo)', () => {
  it('Gabriel: ficha "teste diagnóstico" + ficha com nome JID/Video (mesmo telefone, mesmo chip) viram UMA', () => {
    const diag = conv({
      id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`,
      contactName: 'Gabriel Luz Novo',
      contactPhone: `+${GABRIEL_PHONE}`,
      lastMessage: '[ZapMass] teste diagnóstico 15:08',
      lastMessageTimestamp: 2000,
      messages: [msg('d1', 2000, '[ZapMass] teste diagnóstico 15:08')],
      tags: ['Campanha'],
    });
    // Ficha criada pelo bug antigo: nome = JID cru, sem contactPhone, outro formato de id (@c.us)
    const video = conv({
      id: `${CONN}:${GABRIEL_PHONE}@c.us`,
      contactName: `${GABRIEL_PHONE}@s.whatsapp.net`,
      contactPhone: '',
      lastMessage: 'Video',
      lastMessageTimestamp: 1000,
      messages: [msg('v1', 1000, 'Video', 'them')],
    });

    const plain = collapseConversationsByPhone([diag, video]);
    expect(plain).toHaveLength(1);

    const { list, aliases } = canonicalizeInboxList([diag, video]);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(`${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`);
    expect(list[0]!.contactName).toBe('Gabriel Luz Novo');
    expect(list[0]!.messages.map((m) => m.id).sort()).toEqual(['d1', 'v1']);
    expect(aliases.get(`${CONN}:${GABRIEL_PHONE}@c.us`)).toBe(`${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`);
  });

  it('Gabriel: @lid (PN só nas mensagens) + telefone no mesmo chip viram uma, com alias lid → telefone', () => {
    const lid = conv({
      id: `${CONN}:251174049550446@lid`,
      contactName: 'Gabriel Luz Novo',
      lastMessage: 'Video',
      lastMessageTimestamp: 3000,
      messages: [
        {
          ...msg('v1', 3000, 'Video', 'them'),
          waRemoteJidAlt: `${GABRIEL_PHONE}@s.whatsapp.net`,
        },
      ],
    });
    const phone = conv({
      id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`,
      contactName: 'Gabriel Luz Novo',
      contactPhone: `+${GABRIEL_PHONE}`,
      lastMessageTimestamp: 1000,
      messages: [msg('d1', 1000, 'diag')],
    });
    const out = collapseConversationsByPhoneDetailed([lid, phone]);
    expect(out.list).toHaveLength(1);
    expect(out.list[0]!.id).toBe(`${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`);
    expect(out.aliases.get(`${CONN}:251174049550446@lid`)).toBe(out.list[0]!.id);
  });

  it('9º dígito BR (DDD ≤ 27) e formatação do contactPhone não geram ficha dupla', () => {
    const rj1 = conv({ id: `${CONN}:552199912700@s.whatsapp.net`, contactPhone: '+55 21 9991-2700' });
    const rj2 = conv({ id: `${CONN}:5521999912700@s.whatsapp.net`, contactPhone: '+5521999912700' });
    expect(canonicalizeInboxList([rj1, rj2]).list).toHaveLength(1);
  });

  it('mesmo id exato com formatos diferentes de contactPhone (+55 47 99912-7001) = uma ficha', () => {
    const a = conv({ id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`, contactPhone: '+55 47 99912-7001' });
    const b = conv({ id: `${CONN}:${GABRIEL_PHONE}@c.us`, contactPhone: '' });
    expect(canonicalizeInboxList([a, b]).list).toHaveLength(1);
  });

  it('NÃO funde só por nome de exibição (homônimos com telefones diferentes)', () => {
    const a = conv({ id: `${CONN}:5547999127001@s.whatsapp.net`, contactName: 'Maria Silva', contactPhone: '+5547999127001' });
    const b = conv({ id: `${CONN}:5511988776655@s.whatsapp.net`, contactName: 'Maria Silva', contactPhone: '+5511988776655' });
    expect(canonicalizeInboxList([a, b]).list).toHaveLength(2);
  });

  it('chips diferentes continuam separados (identidade por chip + telefone)', () => {
    const a = conv({ id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`, contactPhone: `+${GABRIEL_PHONE}` });
    const b = conv({
      id: `uid1__conn_chipB:${GABRIEL_PHONE}@s.whatsapp.net`,
      connectionId: 'uid1__conn_chipB',
      contactPhone: `+${GABRIEL_PHONE}`,
    });
    expect(canonicalizeInboxList([a, b]).list).toHaveLength(2);
  });
});

describe('lixo da inbox (ficha "0", broadcast, JID curto)', () => {
  it('isJunkInboxJid', () => {
    expect(isJunkInboxJid('0@s.whatsapp.net')).toBe(true);
    expect(isJunkInboxJid('')).toBe(true);
    expect(isJunkInboxJid('123@broadcast')).toBe(true);
    expect(isJunkInboxJid('status@broadcast')).toBe(true);
    expect(isJunkInboxJid('1234567@s.whatsapp.net')).toBe(true);
    expect(isJunkInboxJid('5547999127001@s.whatsapp.net')).toBe(false);
    expect(isJunkInboxJid('251174049550446@lid')).toBe(false);
  });

  it('ficha "0" com badge e data (id 0@s.whatsapp.net) some da lista', () => {
    const zero = conv({
      id: `${CONN}:0@s.whatsapp.net`,
      contactName: '0',
      contactPhone: '',
      unreadCount: 3,
      lastMessageTimestamp: Date.parse('2026-10-26T12:00:00Z'),
      lastMessage: 'x',
    });
    const real = conv({ id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`, contactPhone: `+${GABRIEL_PHONE}` });
    expect(isJunkInboxConversation(zero)).toBe(true);
    const out = canonicalizeInboxList([zero, real]);
    expect(out.list.map((c) => c.id)).toEqual([real.id]);
    expect(out.junkIds).toEqual([zero.id]);
  });

  it('nome "0" sem telefone e sem mensagens é lixo; com telefone resolvido só troca o nome', () => {
    const noPhone = conv({ id: `${CONN}:251174049550446@lid`, contactName: '0', unreadCount: 2, lastMessage: 'x' });
    expect(isJunkInboxConversation(noPhone)).toBe(true);
    const withPhone = conv({
      id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`,
      contactName: '0',
      contactPhone: `+${GABRIEL_PHONE}`,
    });
    expect(isJunkInboxConversation(withPhone)).toBe(false);
    expect(sanitizeInboxConversationDisplay(withPhone).contactName).toBe(`+${GABRIEL_PHONE}`);
  });

  it('nome com JID cru vira +telefone', () => {
    const c = conv({
      id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`,
      contactName: `${GABRIEL_PHONE}@s.whatsapp.net`,
    });
    expect(sanitizeInboxConversationDisplay(c).contactName).toBe(`+${GABRIEL_PHONE}`);
    const ok = conv({ id: c.id, contactName: 'Gabriel' });
    expect(sanitizeInboxConversationDisplay(ok)).toBe(ok);
  });

  it('@lid vazio sem telefone é removido', () => {
    const lid = conv({ id: `${CONN}:251174049550446@lid` });
    expect(canonicalizeInboxList([lid]).list).toHaveLength(0);
  });
});

describe('stubs do arquivo PG vs RAM', () => {
  it('stub do mesmo telefone em OUTRO chip não vira 2ª ficha', () => {
    const ram = conv({
      id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`,
      contactName: 'Gabriel Luz Novo',
      contactPhone: `+${GABRIEL_PHONE}`,
      messages: [msg('d1', 1, 'diag')],
    });
    const stub = conv({
      id: `uid1__conn_chipB:${GABRIEL_PHONE}@s.whatsapp.net`,
      connectionId: 'uid1__conn_chipB',
      contactName: GABRIEL_PHONE,
      contactPhone: `+${GABRIEL_PHONE}`,
      lastMessage: 'Video',
      tags: ['Arquivo'],
    });
    const other = conv({
      id: `${CONN}:5511988776655@s.whatsapp.net`,
      contactPhone: '+5511988776655',
      tags: ['Arquivo'],
    });
    const out = filterPgStubsShadowedByRam([ram], [stub, other]);
    expect(out.map((s) => s.id)).toEqual([other.id]);
  });

  it('stub com mesmo id já na RAM e stub lixo são descartados', () => {
    const ram = conv({ id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`, contactPhone: `+${GABRIEL_PHONE}` });
    const dup = { ...ram };
    const junk = conv({ id: `${CONN}:0@s.whatsapp.net`, contactName: '0' });
    expect(filterPgStubsShadowedByRam([ram], [dup, junk])).toHaveLength(0);
  });
});

describe('findCanonicalConversationIdForPhone', () => {
  it('prefere @s.whatsapp.net sobre @lid/@c.us do mesmo telefone/chip', () => {
    const lid = conv({
      id: `${CONN}:251174049550446@lid`,
      contactPhone: `+${GABRIEL_PHONE}`,
    });
    const cus = conv({ id: `${CONN}:${GABRIEL_PHONE}@c.us`, contactPhone: `+${GABRIEL_PHONE}` });
    const wa = conv({ id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`, contactPhone: `+${GABRIEL_PHONE}` });
    expect(findCanonicalConversationIdForPhone([lid, cus, wa], CONN, GABRIEL_PHONE)).toBe(wa.id);
    expect(findCanonicalConversationIdForPhone([lid, cus], CONN, GABRIEL_PHONE)).toBe(cus.id);
    expect(findCanonicalConversationIdForPhone([lid], CONN, GABRIEL_PHONE)).toBe(lid.id);
  });

  it('ignora outro chip e outro telefone', () => {
    const other = conv({ id: `${CONN}:5511988776655@s.whatsapp.net`, contactPhone: '+5511988776655' });
    const otherChip = conv({
      id: `chipX:${GABRIEL_PHONE}@s.whatsapp.net`,
      connectionId: 'chipX',
      contactPhone: `+${GABRIEL_PHONE}`,
    });
    expect(findCanonicalConversationIdForPhone([other, otherChip], CONN, GABRIEL_PHONE)).toBeNull();
  });
});

describe('espelho JS (runtime do servidor usa o .js)', () => {
  it('canonicalizeInboxList do .js se comporta como o .ts', () => {
    const a = conv({ id: `${CONN}:${GABRIEL_PHONE}@s.whatsapp.net`, contactPhone: `+${GABRIEL_PHONE}` });
    const b = conv({ id: `${CONN}:${GABRIEL_PHONE}@c.us`, contactName: `${GABRIEL_PHONE}@s.whatsapp.net` });
    const zero = conv({ id: `${CONN}:0@s.whatsapp.net`, contactName: '0' });
    const out = canonicalizeFromJs([a, b, zero]);
    expect(out.list).toHaveLength(1);
    expect(out.junkIds).toEqual([zero.id]);
  });
});
