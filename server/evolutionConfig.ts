import {
    activeEvolutionBaseUrl,
    evolutionEngineConfig,
    isEvolutionGoEngine,
    resolveWhatsAppEngine,
} from './evolutionEngineConfig.js';

/** Config legada — apiUrl reflete o motor ativo. */
export const evolutionConfig = {
    get apiUrl() {
        return activeEvolutionBaseUrl();
    },
    get apiKey() {
        return isEvolutionGoEngine()
            ? evolutionEngineConfig.go.globalKey
            : evolutionEngineConfig.api.key;
    },
    webhookUrl: evolutionEngineConfig.webhookUrl,
    timeout: evolutionEngineConfig.timeout,
    mediaUploadTimeout: evolutionEngineConfig.mediaUploadTimeout,
    maxRetries: evolutionEngineConfig.maxRetries,
    retryDelay: evolutionEngineConfig.retryDelay,
    engine: resolveWhatsAppEngine(),
    isGo: isEvolutionGoEngine(),
};

export { evolutionEngineConfig, isEvolutionGoEngine, resolveWhatsAppEngine };
