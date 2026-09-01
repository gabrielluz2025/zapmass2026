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

    it('POST connect → /instance/connect com webhook', () => {
        const store = {
            ...tokenStore,
            getGoInstanceUuid: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
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
        expect(r.headers.instanceId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        expect(r.headers.apikey).toBe('tok-test');
        expect((r.data as { subscribe?: string[] }).subscribe).toContain('ALL');
    });

    it('POST connect sem UUID Go não envia conn_* no header instanceId', () => {
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'post',
                url: '/instance/connect/conn_1787847087384_1',
                data: {},
                headers: {},
            },
            tokenStore
        );
        expect(r.headers.instanceId).toBeUndefined();
        expect(r.syntheticResponse?.status).toBe(400);
        expect(String((r.syntheticResponse?.data as { error?: string })?.error)).toBe('missing-go-uuid');
    });

    it('DELETE instance usa UUID Go, não o conn_*', () => {
        const store = {
            ...tokenStore,
            getGoInstanceUuid: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        };
        const r = adaptEvolutionApiRequestToGo(
            {
                method: 'delete',
                url: '/instance/delete/conn_1787847087384_1',
                headers: {},
            },
            store
        );
        expect(r.url).toBe('/instance/delete/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });
});

describe('normalizeGoResponseToApiV2', () => {
    it('normaliza status', () => {
        const out = normalizeGoResponseToApiV2('/instance/status', { data: { connected: true } });
        expect((out as { instance: { state: string } }).instance.state).toBe('open');
    });

    it('normaliza status PascalCase Connected do whatsmeow', () => {
        const out = normalizeGoResponseToApiV2('/instance/status', {
            success: true,
            data: { Connected: true, JID: '5547999:1@s.whatsapp.net' },
        });
        expect((out as { state: string }).state).toBe('open');
    });

    it('não trata envelope success sem evidência de sessão como open', () => {
        const out = normalizeGoResponseToApiV2('/instance/status', { status: 'success' });
        expect((out as { state: string }).state).toBe('close');
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

    it('marca Connected PascalCase como open em /instance/all', () => {
        const out = normalizeGoResponseToApiV2('/instance/all', {
            data: [{ id: 'uuid-2', name: 'conn_1', Connected: true }],
        }) as Array<{ connectionStatus?: string }>;
        expect(out[0]?.connectionStatus).toBe('open');
    });
});
