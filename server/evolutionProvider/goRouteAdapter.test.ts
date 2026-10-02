import { describe, expect, it } from 'vitest';
import {
    adaptEvolutionApiRequestToGo,
    extractInstanceIdFromApiPath,
    normalizeGoResponseToApiV2,
} from './goRouteAdapter.js';

const tokenStore = {
    getToken: () => 'tok-test',
    ensureToken: (id: string) => `tok-${id}`,
};

describe('extractInstanceIdFromApiPath', () => {
    it('extrai id de sendText', () => {
        expect(extractInstanceIdFromApiPath('/message/sendText/conn_1_2')).toBe('conn_1_2');
    });
    it('extrai id encoded', () => {
        expect(extractInstanceIdFromApiPath('/instance/connect/conn%201')).toBe('conn 1');
    });
});

describe('adaptEvolutionApiRequestToGo', () => {
    it('mapeia fetchInstances → /instance/all', () => {
        const r = adaptEvolutionApiRequestToGo(
            { method: 'get', url: '/instance/fetchInstances', headers: {} },
            tokenStore
        );
        expect(r.url).toBe('/instance/all');
    });

    it('mapeia create com token', () => {
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'post',
                url: '/instance/create',
                data: { instanceName: 'conn_abc' },
                headers: {},
            },
            tokenStore
        );
        expect(r.url).toBe('/instance/create');
        expect((r.data as { token?: string }).token).toBe('tok-conn_abc');
    });

    it('mapeia sendText', () => {
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'post',
                url: '/message/sendText/chip1',
                data: { number: '5511999999999', textMessage: { text: 'oi' } },
                headers: {},
            },
            tokenStore
        );
        expect(r.url).toBe('/send/text');
        expect(r.headers.apikey).toBe('tok-test');
    });

    it('mapeia sendMedia com base64 e instanceId Go', () => {
        const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const store = {
            ...tokenStore,
            getGoInstanceUuid: () => validUuid,
        };
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'post',
                url: '/message/sendMedia/chip1',
                data: {
                    number: '5511999999999',
                    base64: 'data:image/jpeg;base64,QUJD',
                    mediatype: 'image',
                    mimetype: 'image/jpeg',
                    fileName: 'foto.jpg',
                },
                headers: {},
            },
            store
        );
        expect(r.url).toBe('/send/media');
        expect(r.headers.instanceId).toBe(validUuid);
        expect((r.data as { url?: string }).url).toBe('QUJD');
        expect((r.data as { base64?: string }).base64).toBe('QUJD');
    });

    it('POST connect → /instance/connect com webhook', () => {
        const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const store = {
            ...tokenStore,
            getGoInstanceUuid: () => validUuid,
        };
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'post',
                url: '/instance/connect/chip1',
                data: {},
                headers: {},
            },
            store
        );
        expect(r.url).toBe('/instance/connect');
        expect(r.headers.instanceId).toBe(validUuid);
        expect(r.headers.apikey).toBe('tok-test');
        expect((r.data as { subscribe?: string[] }).subscribe).toContain('ALL');
    });

    it('GET connect → /instance/qr com instanceId UUID', () => {
        const validUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const store = {
            ...tokenStore,
            getGoInstanceUuid: () => validUuid,
        };
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'get',
                url: '/instance/connect/chip1',
                headers: {},
            },
            store
        );
        expect(r.url).toBe('/instance/qr');
        expect(r.headers.instanceId).toBe(validUuid);
        expect(r.syntheticResponse).toBeUndefined();
    });

    it('findMessages → resposta sintética vazia (Go não expõe histórico)', () => {
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'post',
                url: '/chat/findMessages/conn_abc',
                data: { where: { key: { remoteJid: '5511999999999@s.whatsapp.net' } } },
                headers: {},
            },
            tokenStore
        );
        expect(r.syntheticResponse?.status).toBe(200);
        expect(r.syntheticResponse?.data).toEqual([]);
    });

    it('extrai id de findMessages em /chat/', () => {
        expect(extractInstanceIdFromApiPath('/chat/findMessages/conn_1_2')).toBe('conn_1_2');
    });
});

describe('normalizeGoResponseToApiV2', () => {
    it('normaliza status', () => {
        const out = normalizeGoResponseToApiV2('/instance/status', { data: { connected: true } });
        expect((out as { instance: { state: string } }).instance.state).toBe('open');
    });

    it('separa código de pareamento de imagem QR', () => {
        const out = normalizeGoResponseToApiV2('/instance/qr', {
            data: {
                code: '2@abc,def',
                qrcode: 'data:image/png;base64,iVBORw0KGgo=',
            },
        }) as { qrcode: { base64?: string; code?: string }; count: number };
        expect(out.qrcode.code).toBe('2@abc,def');
        expect(out.qrcode.base64).toContain('data:image/png');
        expect(out.count).toBe(1);
    });

    it('não trata código de pareamento como base64', () => {
        const out = normalizeGoResponseToApiV2('/instance/connect', {
            data: { code: '2@abc,def' },
        }) as { qrcode: { base64?: string; code?: string } };
        expect(out.qrcode.code).toBe('2@abc,def');
        expect(out.qrcode.base64).toBeUndefined();
    });

    it('normaliza avatar Go (base64) para profilePictureUrl', () => {
        const out = normalizeGoResponseToApiV2('/user/avatar', {
            success: true,
            avatar: 'iVBORw0KGgoAAAANSUhEUgAA',
        }) as { profilePictureUrl: string };
        expect(out.profilePictureUrl).toContain('data:image/jpeg;base64,');
    });

    it('send/media com success:true sem id → key go-queued', () => {
        const out = normalizeGoResponseToApiV2('/send/media', {
            success: true,
            message: 'queued',
        }) as { key?: { id?: string }; status?: string };
        expect(out.key?.id).toBe('go-queued');
        expect(out.status).toBe('PENDING');
    });

    it('send/media com success:false expõe erro', () => {
        const out = normalizeGoResponseToApiV2('/send/media', {
            success: false,
            message: 'URL is required',
        }) as { error?: string; key?: { id?: string } };
        expect(out.error).toContain('URL is required');
        expect(out.key?.id).toBeUndefined();
    });

    it('preserva token e jid em /instance/all', () => {
        const out = normalizeGoResponseToApiV2('/instance/all', {
            data: [{ id: 'uuid-1', name: 'chip1', token: 'tok-1', jid: '554796317344:19@s.whatsapp.net', connected: true }],
        }) as Array<{ token?: string; jid?: string; connectionStatus?: string }>;
        expect(out[0]?.token).toBe('tok-1');
        expect(out[0]?.jid).toContain('554796317344');
        expect(out[0]?.connectionStatus).toBe('open');
    });
});
