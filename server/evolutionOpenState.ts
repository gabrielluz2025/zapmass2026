/** Evolution v2 alterna `open` e `connected` para sessão ativa. */
export function isEvolutionOpenState(raw: unknown): boolean {
    const state = String(raw || '').toLowerCase();
    return state === 'open' || state === 'connected';
}
