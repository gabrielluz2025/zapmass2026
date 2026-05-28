import IORedis from 'ioredis';

function getRedisUrl(): string | null {
    const url = process.env.REDIS_URL?.trim();
    return url || null;
}

class RedisQueue {
    private client: IORedis | null = null;

    private getClient(): IORedis | null {
        const url = getRedisUrl();
        if (!url) return null;
        if (!this.client) {
            this.client = new IORedis(url, {
                maxRetriesPerRequest: 3,
                reconnectOnError: () => true,
            });
            console.log(`[RedisQueue] Fila persistente conectada ao Redis em: ${url}`);
        }
        return this.client;
    }

    /**
     * Enfileira um item na fila (adiciona ao final)
     */
    async enqueue(queueName: string, data: any): Promise<number> {
        try {
            const client = this.getClient();
            if (!client) return 0;
            const payload = JSON.stringify(data);
            return await client.rpush(`zapmass:queue:${queueName}`, payload);
        } catch (e) {
            console.error(`[RedisQueue] Erro ao enfileirar em ${queueName}:`, e);
            return 0;
        }
    }

    /**
     * Remove e retorna o próximo item da fila (do início)
     */
    async dequeue<T>(queueName: string): Promise<T | null> {
        try {
            const client = this.getClient();
            if (!client) return null;
            const payload = await client.lpop(`zapmass:queue:${queueName}`);
            if (!payload) return null;
            return JSON.parse(payload) as T;
        } catch (e) {
            console.error(`[RedisQueue] Erro ao desenfileirar de ${queueName}:`, e);
            return null;
        }
    }

    /**
     * Recoloca um item no início da fila para retentar imediatamente
     */
    async requeue(queueName: string, data: any): Promise<number> {
        try {
            const client = this.getClient();
            if (!client) return 0;
            const payload = JSON.stringify(data);
            return await client.lpush(`zapmass:queue:${queueName}`, payload);
        } catch (e) {
            console.error(`[RedisQueue] Erro ao recolocar na fila ${queueName}:`, e);
            return 0;
        }
    }

    /**
     * Retorna o tamanho atual da fila
     */
    async getQueueSize(queueName: string): Promise<number> {
        try {
            const client = this.getClient();
            if (!client) return 0;
            return await client.llen(`zapmass:queue:${queueName}`);
        } catch (e) {
            console.error(`[RedisQueue] Erro ao obter tamanho de ${queueName}:`, e);
            return 0;
        }
    }

    /**
     * Limpa completamente a fila
     */
    async clear(queueName: string): Promise<boolean> {
        try {
            const client = this.getClient();
            if (!client) return false;
            await client.del(`zapmass:queue:${queueName}`);
            return true;
        } catch (e) {
            console.error(`[RedisQueue] Erro ao limpar fila ${queueName}:`, e);
            return false;
        }
    }

    /**
     * Retorna todos os itens da fila (para fins de visualização)
     */
    async getAll<T>(queueName: string): Promise<T[]> {
        try {
            const client = this.getClient();
            if (!client) return [];
            const rawItems = await client.lrange(`zapmass:queue:${queueName}`, 0, -1);
            return rawItems.map(item => JSON.parse(item) as T);
        } catch (e) {
            console.error(`[RedisQueue] Erro ao buscar todos os itens de ${queueName}:`, e);
            return [];
        }
    }
}

export const redisQueue = new RedisQueue();
