import { describe, expect, it } from 'vitest';
import { isEvolutionOpenState, goPayloadLooksConnected, parseConnectionStatePayload } from './evolutionOpenState.js';

describe('isEvolutionOpenState', () => {
    it('trata open e connected como sessão ativa', () => {
        expect(isEvolutionOpenState('open')).toBe(true);
        expect(isEvolutionOpenState('connected')).toBe(true);
        expect(isEvolutionOpenState('CONNECTED')).toBe(true);
    });

    it('trata loggedin e online como sessão ativa', () => {
        expect(isEvolutionOpenState('loggedin')).toBe(true);
        expect(isEvolutionOpenState('online')).toBe(true);
        expect(isEvolutionOpenState('LoggedIn')).toBe(true);
        expect(isEvolutionOpenState('Online')).toBe(true);
    });

    it('rejeita connecting, close e vazio', () => {
        expect(isEvolutionOpenState('connecting')).toBe(false);
        expect(isEvolutionOpenState('close')).toBe(false);
        expect(isEvolutionOpenState('')).toBe(false);
    });
});

describe('goPayloadLooksConnected', () => {
    it('detecta connected: true booleano', () => {
        expect(goPayloadLooksConnected({ connected: true })).toBe(true);
        expect(goPayloadLooksConnected({ connected: false })).toBe(false);
    });

    it('detecta connectionStatus open/connected', () => {
        expect(goPayloadLooksConnected({ connectionStatus: 'open' })).toBe(true);
        expect(goPayloadLooksConnected({ connectionStatus: 'connected' })).toBe(true);
        expect(goPayloadLooksConnected({ connectionStatus: 'close' })).toBe(false);
    });

    it('detecta PascalCase Connected / LoggedIn', () => {
        expect(goPayloadLooksConnected({ connectionStatus: 'Connected' })).toBe(true);
        expect(goPayloadLooksConnected({ connectionStatus: 'LoggedIn' })).toBe(true);
        expect(goPayloadLooksConnected({ state: 'Online' })).toBe(true);
    });

    it('detecta envelope instance aninhado', () => {
        expect(goPayloadLooksConnected({ instance: { connected: true } })).toBe(true);
        expect(goPayloadLooksConnected({ instance: { state: 'open' } })).toBe(true);
        expect(goPayloadLooksConnected({ instance: { connectionStatus: 'Connected' } })).toBe(true);
    });

    it('detecta envelope data aninhado', () => {
        expect(goPayloadLooksConnected({ data: { connected: true } })).toBe(true);
        expect(goPayloadLooksConnected({ data: { connectionStatus: 'open' } })).toBe(true);
    });

    it('retorna false para payload vazio ou desconectado', () => {
        expect(goPayloadLooksConnected({})).toBe(false);
        expect(goPayloadLooksConnected({ state: 'close' })).toBe(false);
        expect(goPayloadLooksConnected({ instance: { state: 'close' } })).toBe(false);
    });
});

describe('parseConnectionStatePayload', () => {
    it('retorna open para connected: true', () => {
        expect(parseConnectionStatePayload({ connected: true })).toBe('open');
    });

    it('retorna open para connectionStatus open', () => {
        expect(parseConnectionStatePayload({ connectionStatus: 'open' })).toBe('open');
        expect(parseConnectionStatePayload({ state: 'connected' })).toBe('open');
    });

    it('retorna open para PascalCase Connected / LoggedIn', () => {
        expect(parseConnectionStatePayload({ state: 'Connected' })).toBe('open');
        expect(parseConnectionStatePayload({ connectionStatus: 'LoggedIn' })).toBe('open');
    });

    it('retorna open para envelope instance aninhado', () => {
        expect(parseConnectionStatePayload({ instance: { state: 'open' } })).toBe('open');
        expect(parseConnectionStatePayload({ instance: { connected: true } })).toBe('open');
    });

    it('retorna connecting/disconnecting literais', () => {
        expect(parseConnectionStatePayload({ state: 'connecting' })).toBe('connecting');
        expect(parseConnectionStatePayload({ state: 'disconnecting' })).toBe('disconnecting');
    });

    it('retorna close como fallback', () => {
        expect(parseConnectionStatePayload(null)).toBe('close');
        expect(parseConnectionStatePayload({})).toBe('close');
        expect(parseConnectionStatePayload({ state: 'close' })).toBe('close');
    });
});
