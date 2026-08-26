export type ParityStatus = 'full' | 'partial' | 'adapter' | 'missing' | 'n/a';

export type ParityRow = {
    feature: string;
    zapmassUsage: string;
    evolutionApi: ParityStatus;
    evolutionGo: ParityStatus;
    notes?: string;
};

/** Matriz de paridade ZapMass × Evolution API v2 × Evolution Go. */
export const EVOLUTION_GO_PARITY_MATRIX: ParityRow[] = [
    {
        feature: 'Criar instância',
        zapmassUsage: 'POST /instance/create',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go exige { name, token }; token por chip persiste em connections_settings.json',
    },
    {
        feature: 'QR / pairing',
        zapmassUsage: 'GET/POST /instance/connect/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: GET /instance/qr + POST /instance/connect (auth por token do chip)',
    },
    {
        feature: 'Estado conexão',
        zapmassUsage: 'GET /instance/connectionState/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: GET /instance/status',
    },
    {
        feature: 'Reconectar',
        zapmassUsage: 'POST /instance/restart/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: POST /instance/reconnect',
    },
    {
        feature: 'Logout / delete',
        zapmassUsage: 'DELETE /instance/logout|delete/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go logout usa token do chip; delete usa GLOBAL key',
    },
    {
        feature: 'Listar instâncias',
        zapmassUsage: 'GET /instance/fetchInstances',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: GET /instance/all',
    },
    {
        feature: 'Enviar texto (campanhas)',
        zapmassUsage: 'POST /message/sendText/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: POST /send/text (apikey = token do chip)',
    },
    {
        feature: 'Enviar mídia',
        zapmassUsage: 'POST /message/sendMedia/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: POST /send/media',
    },
    {
        feature: 'Presença composing',
        zapmassUsage: 'POST /chat/sendPresence/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: POST /message/presence',
    },
    {
        feature: 'Validar números WA',
        zapmassUsage: 'POST /chat/whatsappNumbers/{id}',
        evolutionApi: 'full',
        evolutionGo: 'adapter',
        notes: 'Go: POST /user/check',
    },
    {
        feature: 'Webhook por instância',
        zapmassUsage: 'POST /webhook/set/{id}',
        evolutionApi: 'full',
        evolutionGo: 'partial',
        notes: 'Go: WEBHOOK_URL global ou webhook no create',
    },
    {
        feature: 'Sync inbox findChats',
        zapmassUsage: 'POST /chat/findChats/{id}',
        evolutionApi: 'full',
        evolutionGo: 'missing',
        notes: 'Go não expõe findChats — inbox via webhooks',
    },
    {
        feature: 'Histórico findMessages',
        zapmassUsage: 'POST /chat/findMessages/{id}',
        evolutionApi: 'full',
        evolutionGo: 'missing',
        notes: 'Gap para sync pesado de chat',
    },
    {
        feature: 'Agenda findContacts',
        zapmassUsage: 'POST /chat/findContacts/{id}',
        evolutionApi: 'full',
        evolutionGo: 'partial',
        notes: 'Go: GET /user/contacts',
    },
    {
        feature: 'Sessão portável Baileys→Go',
        zapmassUsage: 'volume /evolution/instances',
        evolutionApi: 'n/a',
        evolutionGo: 'missing',
        notes: 'Re-QR obrigatório na migração',
    },
];

export function paritySummaryForGo(): {
    adapter: number;
    partial: number;
    missing: number;
    campaignReady: boolean;
    inboxFullSyncReady: boolean;
} {
    const rows = EVOLUTION_GO_PARITY_MATRIX;
    const campaignRow = rows.find((r) => r.feature.includes('texto'));
    const chatRow = rows.find((r) => r.feature.includes('findChats'));
    return {
        adapter: rows.filter((r) => r.evolutionGo === 'adapter').length,
        partial: rows.filter((r) => r.evolutionGo === 'partial').length,
        missing: rows.filter((r) => r.evolutionGo === 'missing').length,
        campaignReady: campaignRow?.evolutionGo !== 'missing',
        inboxFullSyncReady: chatRow?.evolutionGo !== 'missing',
    };
}
