import { describe, expect, it } from 'vitest';
import { normalizeEvolutionGoWebhookIfNeeded } from './evolutionGoWebhookAdapter.js';

describe('normalizeEvolutionGoWebhookIfNeeded', () => {
    const lookup = (hint: { instanceToken?: string }) =>
        hint.instanceToken === 'tok-chip1' ? 'conn_chip1' : undefined;

    it('pass-through evento Evolution API v2', () => {
        const raw = { event: 'messages.upsert', instance: 'chip1', data: { key: { id: '1' } } };
        expect(normalizeEvolutionGoWebhookIfNeeded(raw, lookup)).toBe(raw);
    });

    it('Message Go → MESSAGES_UPSERT', () => {
        const out = normalizeEvolutionGoWebhookIfNeeded(
            {
                event: 'Message',
                instanceId: 'uuid-1',
                instanceToken: 'tok-chip1',
                data: {
                    Info: {
                        Chat: '5511999999999@s.whatsapp.net',
                        IsFromMe: false,
                        ID: 'ABC',
                        PushName: 'João',
                        Timestamp: '2024-10-10T17:17:44-03:00',
                    },
                    Message: { conversation: 'oi' },
                },
            },
            lookup
        ) as Record<string, unknown>;

        expect(out.event).toBe('MESSAGES_UPSERT');
        expect(out.instance).toBe('conn_chip1');
        const data = out.data as { key: { remoteJid: string }; message: { conversation: string } };
        expect(data.key.remoteJid).toBe('5511999999999@s.whatsapp.net');
        expect(data.message.conversation).toBe('oi');
    });

    it('QRCode Go → QRCODE_UPDATED', () => {
        const out = normalizeEvolutionGoWebhookIfNeeded(
            {
                event: 'QRCode',
                instanceToken: 'tok-chip1',
                data: { code: '2@abc', qrcode: 'data:image/png;base64,xxx' },
            },
            lookup
        ) as Record<string, unknown>;
        expect(out.event).toBe('QRCODE_UPDATED');
        const data = out.data as { qrcode: { base64: string; code: string } };
        expect(data.qrcode.base64).toContain('base64');
    });

    it('Connected Go → CONNECTION_UPDATE open', () => {
        const out = normalizeEvolutionGoWebhookIfNeeded(
            {
                event: 'Connected',
                instanceToken: 'tok-chip1',
                data: { status: 'open', jid: '5511@s.whatsapp.net' },
            },
            lookup
        ) as Record<string, unknown>;
        expect(out.event).toBe('CONNECTION_UPDATE');
        expect((out.data as { state: string }).state).toBe('open');
    });

    it('OfflineSyncCompleted Go → CONNECTION_UPDATE open', () => {
        const out = normalizeEvolutionGoWebhookIfNeeded(
            {
                event: 'OfflineSyncCompleted',
                instanceToken: 'tok-chip1',
                data: { jid: '5511@s.whatsapp.net' },
            },
            lookup
        ) as Record<string, unknown>;
        expect(out.event).toBe('CONNECTION_UPDATE');
        expect((out.data as { state: string }).state).toBe('open');
    });

    it('HistorySync Go (Info/Message batch) → MESSAGES_UPSERT', () => {
        const out = normalizeEvolutionGoWebhookIfNeeded(
            {
                event: 'HistorySync',
                instanceToken: 'tok-chip1',
                data: {
                    Messages: [
                        {
                            Info: {
                                Chat: '5511888888888@s.whatsapp.net',
                                IsFromMe: false,
                                ID: 'HIST1',
                                PushName: 'Maria',
                                Timestamp: '2024-10-10T17:17:44-03:00',
                            },
                            Message: { conversation: 'mensagem antiga' },
                        },
                        {
                            Info: {
                                Chat: '5511888888888@s.whatsapp.net',
                                IsFromMe: true,
                                ID: 'HIST2',
                                Timestamp: '2024-10-11T10:00:00-03:00',
                            },
                            Message: { conversation: 'resposta' },
                        },
                    ],
                },
            },
            lookup
        ) as Record<string, unknown>;

        expect(out.event).toBe('MESSAGES_UPSERT');
        expect(out.instance).toBe('conn_chip1');
        const data = out.data as { messages: Array<{ key: { id: string }; message: { conversation: string } }> };
        expect(Array.isArray(data.messages)).toBe(true);
        expect(data.messages).toHaveLength(2);
        expect(data.messages[0]!.key.id).toBe('HIST1');
        expect(data.messages[0]!.message.conversation).toBe('mensagem antiga');
    });

    it('HistorySync Go (Conversations) → MESSAGES_UPSERT', () => {
        const out = normalizeEvolutionGoWebhookIfNeeded(
            {
                event: 'HistorySync',
                instanceToken: 'tok-chip1',
                data: {
                    Conversations: [
                        {
                            ID: '5511777777777@s.whatsapp.net',
                            Messages: [
                                {
                                    message: {
                                        key: {
                                            remoteJid: '5511777777777@s.whatsapp.net',
                                            fromMe: false,
                                            id: 'WM1',
                                        },
                                        message: { conversation: 'sync via web' },
                                        messageTimestamp: 1699999999,
                                        pushName: 'Pedro',
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
            lookup
        ) as Record<string, unknown>;

        expect(out.event).toBe('MESSAGES_UPSERT');
        const data = out.data as { messages: Array<{ key: { id: string }; pushName: string }> };
        expect(data.messages).toHaveLength(1);
        expect(data.messages[0]!.key.id).toBe('WM1');
        expect(data.messages[0]!.pushName).toBe('Pedro');
    });
});
