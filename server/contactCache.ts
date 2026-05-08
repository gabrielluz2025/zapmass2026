/**
 * Cache de contatos WhatsApp — evita consultas repetidas a getNumberId().
 * Chave composta "connectionId:phone" para isolar chips/tenants no mesmo processo.
 */

const CONTACT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

interface CacheEntry {
    numberId: string;
    timestamp: number;
}

const contactCache = new Map<string, CacheEntry>();

const cacheKey = (connectionId: string, phoneNumber: string): string =>
    `${connectionId}:${phoneNumber}`;

export const getCachedNumberId = (connectionId: string, phoneNumber: string): string | null => {
    const entry = contactCache.get(cacheKey(connectionId, phoneNumber));
    if (entry && Date.now() - entry.timestamp < CONTACT_CACHE_TTL) return entry.numberId;
    return null;
};

export const setCachedNumberId = (connectionId: string, phoneNumber: string, numberId: string): void => {
    contactCache.set(cacheKey(connectionId, phoneNumber), { numberId, timestamp: Date.now() });
};

export const invalidateCachedNumber = (connectionId: string, phoneNumber: string): void => {
    contactCache.delete(cacheKey(connectionId, phoneNumber));
};

/** Remove todas as entradas do canal especificado (ex.: reconexão ou reset). */
export const clearCacheForConnection = (connectionId: string): void => {
    const prefix = `${connectionId}:`;
    let cleared = 0;
    for (const key of [...contactCache.keys()]) {
        if (key.startsWith(prefix)) {
            contactCache.delete(key);
            cleared++;
        }
    }
    if (cleared > 0) {
        console.log(`[ContactCache] 🧹 Limpou ${cleared} entradas (canal ${connectionId} reiniciado)`);
    }
};

/** Estatísticas para diagnóstico (admin). */
export const getContactCacheStats = () => ({
    size: contactCache.size,
    ttlMs: CONTACT_CACHE_TTL,
});
