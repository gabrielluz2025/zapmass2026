/** Evolution v2 alterna `open` e `connected` para sessão ativa. */
export function isEvolutionOpenState(raw: unknown): boolean {
    const state = String(raw || '').toLowerCase().trim();
    // Canônico Evolution API v2
    if (state === 'open' || state === 'connected') return true;
    // Evolution Go / whatsmeow: PascalCase ou outros aliases
    if (state === 'loggedin' || state === 'online') return true;
    return false;
}

/**
 * Verifica se um payload de instância do Evolution Go indica conexão ativa.
 * Cobre: `connected: true` (Go), `connectionStatus: 'open'|'connected'` (API v2),
 * PascalCase (`Connected`, `LoggedIn`), e envelopes com campo `instance` aninhado.
 */
export function goPayloadLooksConnected(row: Record<string, unknown>): boolean {
    if (!row || typeof row !== 'object') return false;

    // Campo booleano direto (Evolution Go)
    if (row.connected === true) return true;

    // Status do campo principal
    const status = String(row.connectionStatus || row.state || row.status || '').trim();
    if (status) {
        if (isEvolutionOpenState(status)) return true;
        // PascalCase (Connected, LoggedIn, Online)
        if (isEvolutionOpenState(status.toLowerCase())) return true;
    }

    // Envelope com `instance` aninhado (Evolution Go /instance/status)
    if (row.instance && typeof row.instance === 'object') {
        const inst = row.instance as Record<string, unknown>;
        if (inst.connected === true) return true;
        const instStatus = String(inst.state || inst.connectionStatus || inst.status || '').trim();
        if (instStatus && isEvolutionOpenState(instStatus.toLowerCase())) return true;
    }

    // Envelope com `data` aninhado
    if (row.data && typeof row.data === 'object') {
        const d = row.data as Record<string, unknown>;
        if (d.connected === true) return true;
        const dStatus = String(d.connectionStatus || d.state || d.status || '').trim();
        if (dStatus && isEvolutionOpenState(dStatus.toLowerCase())) return true;
    }

    return false;
}

/**
 * Extrai o estado de conexão como string normalizada a partir de um payload
 * (webhook CONNECTION_UPDATE, resposta de /connectionState, etc.).
 * Retorna 'open' para estados ativos, 'close' como fallback.
 */
export function parseConnectionStatePayload(data: unknown): string {
    if (!data || typeof data !== 'object') return 'close';
    const row = data as Record<string, unknown>;

    // Campo booleano direto do Evolution Go
    if (row.connected === true) return 'open';

    // Estado direto no payload
    const state = String(row.state || row.connectionStatus || row.status || '').trim();
    if (state) {
        if (isEvolutionOpenState(state.toLowerCase())) return 'open';
        if (state.toLowerCase() === 'connecting' || state.toLowerCase() === 'disconnecting') return state.toLowerCase();
    }

    // Envelope com `instance` aninhado (Go /instance/status retorna { instance: { state } })
    if (row.instance && typeof row.instance === 'object') {
        const inst = row.instance as Record<string, unknown>;
        if (inst.connected === true) return 'open';
        const s = String(inst.state || inst.connectionStatus || inst.status || '').trim();
        if (s && isEvolutionOpenState(s.toLowerCase())) return 'open';
        if (s) return s.toLowerCase() || 'close';
    }

    // Envelope com `data` aninhado
    if (row.data && typeof row.data === 'object') {
        const d = row.data as Record<string, unknown>;
        if (d.connected === true) return 'open';
        const s = String(d.connectionStatus || d.state || d.status || '').trim();
        if (s && isEvolutionOpenState(s.toLowerCase())) return 'open';
    }

    return state.toLowerCase() || 'close';
}
