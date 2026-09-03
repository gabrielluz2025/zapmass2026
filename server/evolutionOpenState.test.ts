import { describe, expect, it } from 'vitest';
import { isEvolutionOpenState } from './evolutionOpenState.js';

describe('isEvolutionOpenState', () => {
    it('trata open e connected como sessão ativa', () => {
        expect(isEvolutionOpenState('open')).toBe(true);
        expect(isEvolutionOpenState('connected')).toBe(true);
        expect(isEvolutionOpenState('CONNECTED')).toBe(true);
    });

    it('rejeita connecting, close e vazio', () => {
        expect(isEvolutionOpenState('connecting')).toBe(false);
        expect(isEvolutionOpenState('close')).toBe(false);
        expect(isEvolutionOpenState('')).toBe(false);
    });
});
