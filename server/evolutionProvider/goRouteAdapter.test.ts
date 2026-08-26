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
            getGoInstanceUuid: () => 'uuid-chip1',
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
        expect(r.headers.instanceId).toBe('uuid-chip1');
        expect((r.data as { subscribe?: string[] }).subscribe).toContain('ALL');
    });
});

describe('normalizeGoResponseToApiV2', () => {
    it('normaliza status', () => {
        const out = normalizeGoResponseToApiV2('/instance/status', { data: { connected: true } });
        expect((out as { instance: { state: string } }).instance.state).toBe('open');
    });
});
