/** Evolution v2 alterna `open` e `connected` para sessão ativa. */
export function isEvolutionOpenState(raw: unknown): boolean {
    const state = String(raw || '').toLowerCase();
    return state === 'open' || state === 'connected';
}

/**
 * Verifica se um payload de instância do Evolution Go indica conexão ativa.
 * Cobre tanto `connected: true` (Go) quanto `connectionStatus: 'open'|'connected'` (API v2).
 */
export function goPayloadLooksConnected(row: Record<string, unknown>): boolean {
    if (!row || typeof row !== 'object') return false;
    if (row.connected === true) return true;
    const status = String(row.connectionStatus || row.state || row.status || '').toLowerCase();
    return isEvolutionOpenState(status);
}

/**
 * Extrai o estado de conexão como string normalizada a partir de um payload
 * (webhook CONNECTION_UPDATE, resposta de /connectionState, etc.).
 * Retorna 'open' para estados ativos, 'close' como fallback.
 */
export function parseConnectionStatePayload(data: unknown): string {
    if (!data || typeof data !== 'object') return 'close';
    const row = data as Record<string, unknown>;
    // Evolution Go: campo connected booleano
    if (row.connected === true) return 'open';
    const state = String(row.state || row.connectionStatus || row.status || '').toLowerCase();
    if (isEvolutionOpenState(state)) return 'open';
    if (state === 'connecting' || state === 'disconnecting') return state;
    return state || 'close';
}
