import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONN = 'uid1__conn_chipA';
const PHONE = '5547999127001';

let tmpDir = '';

async function makeStore() {
  vi.resetModules();
  process.env.DATA_DIR = tmpDir;
  const { createEvolutionChat } = await import('./evolutionChat.js');
  return createEvolutionChat({} as AxiosInstance);
}

const rawMsg = (
  remoteJid: string,
  id: string,
  text: string,
  opts?: { fromMe?: boolean; pushName?: string; remoteJidAlt?: string }
) => ({
  key: {
    remoteJid,
    id,
    fromMe: opts?.fromMe === true,
    ...(opts?.remoteJidAlt ? { remoteJidAlt: opts.remoteJidAlt } : {}),
  },
  pushName: opts?.pushName,
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
});

describe('evolutionChat — identidade canônica (chip + telefone)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapmass-inbox-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  it('webhook com remoteJid 0@s.whatsapp.net (ficha "0") é ignorado', async () => {
    const store = await makeStore();
    store.handleWebhookMessage(CONN, { messages: [rawMsg('0@s.whatsapp.net', 'z1', 'x', { pushName: '0' })] });
    store.handleWebhookMessage(CONN, { messages: [rawMsg('123456@s.whatsapp.net', 'z2', 'x')] });
    store.handleWebhookMessage(CONN, { messages: [rawMsg('120363@broadcast', 'z3', 'x')] });
    expect(store.getConversations()).toHaveLength(0);
  });

  it('mensagem enviada por nós (fromMe) não usa pushName do chip como nome do contato', async () => {
    const store = await makeStore();
    store.handleWebhookMessage(CONN, {
      messages: [rawMsg(`${PHONE}@s.whatsapp.net`, 'o1', 'oi', { fromMe: true, pushName: 'Dono do Chip' })],
    });
    const [c] = store.getConversations();
    expect(c).toBeTruthy();
    expect(c!.contactName).not.toBe('Dono do Chip');
    expect(c!.contactName).not.toContain('@');
  });

  it('nome da ficha nunca é o JID cru', async () => {
    const store = await makeStore();
    store.handleWebhookMessage(CONN, {
      messages: [rawMsg(`${PHONE}@s.whatsapp.net`, 'o1', 'Video', { fromMe: true })],
    });
    for (const c of store.getConversations()) {
      expect(c.contactName.includes('@')).toBe(false);
    }
  });

  it('@lid com PN em remoteJidAlt + @s.whatsapp.net do mesmo telefone → uma thread só (dedupeInboxRam)', async () => {
    const store = await makeStore();
    store.handleWebhookMessage(CONN, {
      messages: [rawMsg(`${PHONE}@s.whatsapp.net`, 'a1', '[ZapMass] teste diagnóstico 15:08', { fromMe: true })],
    });
    store.handleWebhookMessage(CONN, {
      messages: [
        rawMsg('251174049550446@lid', 'b1', 'Video', {
          pushName: 'Gabriel Luz Novo',
          remoteJidAlt: `${PHONE}@s.whatsapp.net`,
        }),
      ],
    });
    const stats = store.dedupeInboxRam();
    const list = store.getConversations();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(`${CONN}:${PHONE}@s.whatsapp.net`);
    expect(list[0]!.messages.map((m) => m.id).sort()).toEqual(['a1', 'b1']);
    expect(stats.after).toBe(1);
  });

  it('dedupeInboxRam remove lixo e funde duplicata herdada do cache em disco', async () => {
    const waId = `${CONN}:${PHONE}@s.whatsapp.net`;
    const base = {
      connectionId: CONN,
      unreadCount: 0,
      lastMessageTime: '',
      tags: [] as string[],
    };
    fs.writeFileSync(
      path.join(tmpDir, 'conversations_cache.json'),
      JSON.stringify([
        {
          ...base,
          id: waId,
          contactName: 'Gabriel Luz Novo',
          contactPhone: `+${PHONE}`,
          lastMessage: 'diag',
          lastMessageTimestamp: 2000,
          messages: [],
        },
        {
          ...base,
          id: `${CONN}:${PHONE}@c.us`,
          contactName: `${PHONE}@s.whatsapp.net`,
          contactPhone: '',
          lastMessage: 'Video',
          lastMessageTimestamp: 1000,
          messages: [],
        },
        {
          ...base,
          id: `${CONN}:0@s.whatsapp.net`,
          contactName: '0',
          contactPhone: '',
          unreadCount: 2,
          lastMessage: 'x',
          lastMessageTimestamp: 500,
          messages: [],
        },
      ])
    );
    const store = await makeStore();
    // Boot já canonicaliza o cache legado.
    const ids = store.getConversations().map((c) => c.id);
    expect(ids).toEqual([waId]);
    const dry = store.dedupeInboxRam({ dryRun: true });
    expect(dry.before).toBe(1);
    expect(dry.removedIds).toHaveLength(0);
  });
});
