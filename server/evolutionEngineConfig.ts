const isWin = process.platform === 'win32';

/** Motor WhatsApp: evolution-api (Baileys/Node, default) ou evolution-go (whatsmeow/Go). */
export type WhatsAppEngineKind = 'evolution-api' | 'evolution-go';

export function resolveWhatsAppEngine(): WhatsAppEngineKind {
    const raw = String(
        process.env.ZAPMASS_WHATSAPP_ENGINE ||
            process.env.EVOLUTION_ENGINE ||
            'evolution-api'
    )
        .trim()
        .toLowerCase();
    if (raw === 'evolution-go' || raw === 'go' || raw === 'evogo') {
        return 'evolution-go';
    }
    // docker-compose legacy: ZAPMASS_WHATSAPP_ENGINE=evolution
    if (raw === 'evolution' || raw === 'evolution-api' || raw === 'api' || raw === 'baileys') {
        return 'evolution-api';
    }
    return 'evolution-api';
}

export function isEvolutionGoEngine(): boolean {
    return resolveWhatsAppEngine() === 'evolution-go';
}

/** Evolution API (legacy) ou Evolution Go — ambos usam evolutionService. */
export function usesEvolutionMotor(): boolean {
    const engine = resolveWhatsAppEngine();
    return engine === 'evolution-api' || engine === 'evolution-go';
}

export const evolutionEngineConfig = {
    engine: resolveWhatsAppEngine(),

    /** Evolution API (Node/Baileys) — produção atual. */
    api: {
        url: process.env.EVOLUTION_API_URL || (isWin ? 'http://localhost:8080' : 'http://evolution:8080'),
        key: process.env.EVOLUTION_API_KEY || 'zapmass-secure-key-2026',
    },

    /** Evolution Go (whatsmeow) — piloto / migração. */
    go: {
        url:
            process.env.EVOLUTION_GO_URL ||
            process.env.EVOLUTION_GO_API_URL ||
            (isWin ? 'http://localhost:8081' : 'http://evolution-go:8080'),
        /** GLOBAL_API_KEY no container Go. */
        globalKey:
            process.env.EVOLUTION_GO_KEY ||
            process.env.EVOLUTION_GO_GLOBAL_API_KEY ||
            process.env.EVOLUTION_API_KEY ||
            'zapmass-secure-key-2026',
        image: process.env.EVOLUTION_GO_IMAGE || 'evoapicloud/evolution-go:latest',
    },

    webhookUrl:
        process.env.ZAPMASS_WEBHOOK_URL ||
        (isWin ? 'http://localhost:3001/webhook/evolution' : 'http://api:3001/webhook/evolution'),

    webhookToken: process.env.EVOLUTION_WEBHOOK_TOKEN || '',

    timeout: Number(process.env.EVOLUTION_HTTP_TIMEOUT_MS ?? 30_000),
    mediaUploadTimeout: Number(process.env.EVOLUTION_MEDIA_TIMEOUT_MS ?? 120_000),
    maxRetries: Number(process.env.EVOLUTION_HTTP_MAX_RETRIES ?? 3),
    retryDelay: Number(process.env.EVOLUTION_HTTP_RETRY_DELAY_MS ?? 2000),
};

/** Base URL + apikey ativos conforme o motor selecionado. */
export function activeEvolutionBaseUrl(): string {
    return isEvolutionGoEngine() ? evolutionEngineConfig.go.url : evolutionEngineConfig.api.url;
}

export function activeEvolutionGlobalApiKey(): string {
    return isEvolutionGoEngine() ? evolutionEngineConfig.go.globalKey : evolutionEngineConfig.api.key;
}
