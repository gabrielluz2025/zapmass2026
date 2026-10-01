import { describe, expect, it } from 'vitest';
import {
  collapseConversationsByPhone,
  compareConversationsForCanonicalId,
  pickConversationIdForAnchor,
  reconcileConversationSelection,
  resolveStableConversationId,
  selectionAnchorFromConversationId,
} from './collapseConversationsByPhone';
import { collapseConversationsByPhone as collapseFromJs } from './collapseConversationsByPhone.js';
import { buildStrongPhoneMergeKeys } from './contactPhoneLookup';
import type { Conversation } from '../types';

describe('collapseConversationsByPhone', () => {
  it('une @lid e @s.whatsapp.net do mesmo numero no mesmo chip', () => {
    const conn = 'conn_abc';
    const list: Conversation[] = [
      {
        id: `${conn}:251174049550446@lid`,
        connectionId: conn,
        contactName: 'Gabriel',
        contactPhone: '+554799127801',
        waJidAlt: '554799127801@s.whatsapp.net',
        unreadCount: 0,
        lastMessage: '5',
        lastMessageTime: '16:39',
        lastMessageTimestamp: 1000,
        messages: [{ id: 'm1', text: '5', timestamp: '16:39', sender: 'them', timestampMs: 1000, status: 'sent' as const, type: 'text' as const }],
        tags: []
      },
      {
        id: `${conn}:554799127801@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'Gabriel',
        contactPhone: '+554799127801',
        unreadCount: 1,
        lastMessage: 'pdf',
        lastMessageTime: '23:44',
        lastMessageTimestamp: 2000,
        messages: [{ id: 'm2', text: 'pdf', timestamp: '23:44', sender: 'me', timestampMs: 2000, status: 'delivered' as const, type: 'text' as const }],
        tags: []
      }
    ];
    const out = collapseConversationsByPhone(list);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(`${conn}:554799127801@s.whatsapp.net`);
    expect(out[0].messages).toHaveLength(2);
    expect(out[0].unreadCount).toBe(1);
    expect(out[0].lastMessage).toBe('pdf');
  });

  it('nao une contatos diferentes no mesmo chip', () => {
    const conn = 'conn_x';
    const out = collapseConversationsByPhone([
      {
        id: `${conn}:5511999999999@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'A',
        contactPhone: '+5511999999999',
        unreadCount: 0,
        lastMessage: 'a',
        lastMessageTime: '',
        lastMessageTimestamp: 1,
        messages: [],
        tags: []
      },
      {
        id: `${conn}:5521888888888@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'B',
        contactPhone: '+5521888888888',
        unreadCount: 0,
        lastMessage: 'b',
        lastMessageTime: '',
        lastMessageTimestamp: 2,
        messages: [],
        tags: []
      }
    ]);
    expect(out).toHaveLength(2);
  });

  it('nao une so pelo sufixo de 8 digitos (DDDs diferentes)', () => {
    const conn = 'conn_suf';
    const out = collapseConversationsByPhone([
      {
        id: `${conn}:554799127801@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'A',
        contactPhone: '+554799127801',
        unreadCount: 0,
        lastMessage: 'a',
        lastMessageTime: '',
        lastMessageTimestamp: 1,
        messages: [],
        tags: []
      },
      {
        id: `${conn}:554899127801@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'B',
        contactPhone: '+554899127801',
        unreadCount: 0,
        lastMessage: 'b',
        lastMessageTime: '',
        lastMessageTimestamp: 2,
        messages: [],
        tags: []
      }
    ]);
    expect(out).toHaveLength(2);
  });

  it('nao une so pela foto do WhatsApp (pessoas diferentes podem repetir CDN)', () => {
    const conn = 'conn_pic';
    const pic = 'https://pps.whatsapp.net/v/t61.24694-24/abc123/foto.jpg?oe=TOKEN';
    const out = collapseConversationsByPhone([
      {
        id: `${conn}:251174049550446@lid`,
        connectionId: conn,
        contactName: 'Zap-mass',
        contactPhone: '',
        profilePicUrl: pic,
        unreadCount: 0,
        lastMessage: 'teste',
        lastMessageTime: '',
        lastMessageTimestamp: 100,
        messages: [],
        tags: []
      },
      {
        id: `${conn}:554799127801@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'Gabriel Luz',
        contactPhone: '+554799127801',
        profilePicUrl: `${pic}&new=1`,
        unreadCount: 0,
        lastMessage: 'Blz',
        lastMessageTime: '',
        lastMessageTimestamp: 200,
        messages: [],
        tags: []
      }
    ]);
    expect(out).toHaveLength(2);
  });

  it('nao une so pelo nome (homonimos)', () => {
    const conn = 'conn_name';
    const out = collapseConversationsByPhone([
      {
        id: `${conn}:999888777666555@lid`,
        connectionId: conn,
        contactName: 'Gabinete deputado Ismael',
        contactPhone: '',
        unreadCount: 0,
        lastMessage: 'a',
        lastMessageTime: '',
        lastMessageTimestamp: 1,
        messages: [],
        tags: []
      },
      {
        id: `${conn}:5547999999999@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'Gabinete Deputado Ismael',
        contactPhone: '+5547999999999',
        unreadCount: 0,
        lastMessage: 'b',
        lastMessageTime: '',
        lastMessageTimestamp: 2,
        messages: [],
        tags: []
      }
    ]);
    expect(out).toHaveLength(2);
  });

  it('resolveStableConversationId prefere JID com telefone real', () => {
    const conn = 'conn_stable';
    const list = collapseConversationsByPhone([
      {
        id: `${conn}:554799127801@lid`,
        connectionId: conn,
        contactPhone: '554799127801',
        contactName: 'Contato',
        unreadCount: 0,
        lastMessage: 'a',
        lastMessageTime: '',
        lastMessageTimestamp: 100,
        messages: [],
        tags: [],
      },
      {
        id: `${conn}:554799127801@s.whatsapp.net`,
        connectionId: conn,
        contactPhone: '554799127801',
        contactName: 'Contato',
        unreadCount: 0,
        lastMessage: 'b',
        lastMessageTime: '',
        lastMessageTimestamp: 200,
        messages: [],
        tags: [],
      },
    ]);
    expect(list).toHaveLength(1);
    const stable = resolveStableConversationId(list, `${conn}:554799127801@lid`);
    expect(stable).toBe(`${conn}:554799127801@s.whatsapp.net`);
  });

  it('nao rebaixa JID @s.whatsapp.net para @lid (evita loop no Bate-papo)', () => {
    const conn = 'conn_osc';
    const phoneId = `${conn}:554799127801@s.whatsapp.net`;
    const lidOnly: Conversation[] = [
      {
        id: `${conn}:554799127801@lid`,
        connectionId: conn,
        contactPhone: '554799127801',
        contactName: 'Contato',
        unreadCount: 0,
        lastMessage: 'oi',
        lastMessageTime: '',
        lastMessageTimestamp: 100,
        messages: [],
        tags: [],
      },
    ];
    const stable = resolveStableConversationId(lidOnly, phoneId);
    expect(stable).toBeNull();
  });

  it('chaves fortes nao incluem sufixo de 8 digitos', () => {
    const keys = buildStrongPhoneMergeKeys('554799127801');
    expect(keys.some((k) => k.length < 10)).toBe(false);
    expect(keys).not.toContain('99127801');
    expect(keys).not.toContain('4799127801'.slice(-8));
  });

  it('arquivo .js do servidor tambem nao une pelo sufixo de 8 digitos', () => {
    const conn = 'conn_js';
    const out = collapseFromJs([
      {
        id: `${conn}:554799127801@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'A',
        contactPhone: '+554799127801',
        unreadCount: 0,
        lastMessage: 'a',
        lastMessageTime: '',
        lastMessageTimestamp: 1,
        messages: [],
        tags: []
      },
      {
        id: `${conn}:554899127801@s.whatsapp.net`,
        connectionId: conn,
        contactName: 'B',
        contactPhone: '+554899127801',
        unreadCount: 0,
        lastMessage: 'b',
        lastMessageTime: '',
        lastMessageTimestamp: 2,
        messages: [],
        tags: []
      }
    ]);
    expect(out).toHaveLength(2);
  });

  it('id canônico do merge não alterna quando só lastMessageTimestamp oscila', () => {
    const conn = 'conn_tick';
    const phone = '5511999999999';
    const base = (id: string, ts: number): Conversation => ({
      id,
      connectionId: conn,
      contactPhone: phone,
      contactName: 'Contato',
      unreadCount: 0,
      lastMessage: 'x',
      lastMessageTime: '',
      lastMessageTimestamp: ts,
      messages: [],
      tags: [],
    });
    const a = `${conn}:${phone}@host-a`;
    const b = `${conn}:${phone}@host-b`;
    const outLow = collapseConversationsByPhone([base(a, 100), base(b, 500)]);
    const outHigh = collapseConversationsByPhone([base(a, 900), base(b, 100)]);
    expect(outLow).toHaveLength(1);
    expect(outHigh).toHaveLength(1);
    expect(outLow[0].id).toBe(outHigh[0].id);
    expect(outLow[0].id).toBe(a);
  });

  it('reconcileConversationSelection idempotente com lista oscilando @lid ↔ @s', () => {
    const conn = 'conn_reconcile';
    const phone = '554799127801';
    const lidId = `${conn}:${phone}@lid`;
    const phoneId = `${conn}:${phone}@s.whatsapp.net`;
    const mk = (id: string): Conversation => ({
      id,
      connectionId: conn,
      contactPhone: phone,
      contactName: 'Contato',
      unreadCount: 0,
      lastMessage: 'oi',
      lastMessageTime: '',
      lastMessageTimestamp: 100,
      messages: [],
      tags: [],
    });
    const anchor = selectionAnchorFromConversationId(lidId)!;
    const lidOnly = collapseConversationsByPhone([mk(lidId)]);
    const merged = collapseConversationsByPhone([mk(lidId), mk(phoneId)]);

    let selected = lidId;
    const steps: string[] = [selected];
    for (const list of [merged, lidOnly, merged, lidOnly, merged]) {
      const next = reconcileConversationSelection(list, selected, anchor);
      if (next) {
        selected = next;
        steps.push(selected);
      }
    }
    expect(steps).toEqual([lidId, phoneId]);
    expect(reconcileConversationSelection(merged, selected, anchor)).toBeNull();
    expect(reconcileConversationSelection(lidOnly, selected, anchor)).toBeNull();
  });

  it('pickConversationIdForAnchor é determinístico entre JIDs do mesmo rank', () => {
    const conn = 'c';
    const phone = '5511888777666';
    const list: Conversation[] = [
      {
        id: `${conn}:${phone}@zzz`,
        connectionId: conn,
        contactPhone: phone,
        contactName: 'Z',
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        lastMessageTimestamp: 50,
        messages: [],
        tags: [],
      },
      {
        id: `${conn}:${phone}@aaa`,
        connectionId: conn,
        contactPhone: phone,
        contactName: 'A',
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        lastMessageTimestamp: 500,
        messages: [],
        tags: [],
      },
    ];
    const anchor = { connectionId: conn, phoneDigits: phone };
    expect(pickConversationIdForAnchor(list, anchor)).toBe(`${conn}:${phone}@aaa`);
    expect(compareConversationsForCanonicalId(list[1], list[0])).toBeLessThan(0);
  });
});
