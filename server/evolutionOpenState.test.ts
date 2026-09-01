import { describe, expect, it } from 'vitest';
import {
    goPayloadLooksConnected,
    isEvolutionOpenState,
    parseConnectionStatePayload,
} from './evolutionOpenState.js';

describe('isEvolutionOpenState', () => {
    it('trata open, connected, online e loggedIn como sessão ativa', () => {
        expect(isEvolutionOpenState('open')).toBe(true);
        expect(isEvolutionOpenState('connected')).toBe(true);
        expect(isEvolutionOpenState('CONNECTED')).toBe(true);
        expect(isEvolutionOpenState('online')).toBe(true);
        expect(isEvolutionOpenState('available')).toBe(true);
        expect(isEvolutionOpenState('loggedIn')).toBe(true);
    });

    it('rejeita connecting, close, success e vazio', () => {
        expect(isEvolutionOpenState('connecting')).toBe(false);
        expect(isEvolutionOpenState('close')).toBe(false);
        expect(isEvolutionOpenState('success')).toBe(false);
        expect(isEvolutionOpenState('')).toBe(false);
    });
});

describe('goPayloadLooksConnected', () => {
    it('aceita connected camelCase e PascalCase', () => {
        expect(goPayloadLooksConnected({ connected: true })).toBe(true);
        expect(goPayloadLooksConnected({ Connected: true })).toBe(true);
        expect(goPayloadLooksConnected({ LoggedIn: true })).toBe(true);
    });

    it('não trata envelope success como sessão', () => {
        expect(goPayloadLooksConnected({ status: 'success' })).toBe(false);
    });
});

describe('parseConnectionStatePayload', () => {
    it('ignora status:success e lê nested data.Connected', () => {
        expect(parseConnectionStatePayload({ status: 'success', data: { Connected: true } })).toBe(
            'open'
        );
    });

    it('lê instance.state quando o envelope tem status ok', () => {
        expect(
            parseConnectionStatePayload({
                status: 'success',
                instance: { state: 'open' },
            })
        ).toBe('open');
    });

    it('retorna close quando não há evidência de sessão', () => {
        expect(parseConnectionStatePayload({ status: 'success' })).toBe('close');
        expect(parseConnectionStatePayload(null)).toBe('close');
    });
});
