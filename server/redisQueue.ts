import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

class RedisQueue {
    private client: IORedis | null = null;
    private initialized = false;

    constructor() {
        this.init();
    }

    private init() {
        if (this.initialized) return;
        try {
            this.client = new IORedis(redisUrl, {
                maxRetriesPerRequest: 3,
                reconnectOnError: () => true
            });
            this.initialized = true;
            console.log(`[RedisQueue] Fila persistente conectada ao Redis em: ${redisUrl}`);
        } catch (e) {
            console.error('[RedisQueue] Falha ao conectar ao Redis:', e);
        }
    }

    private getClient(): IORedis {
        if (!this.initialized || !this.client) {
            this.init();
        }
        if (!this.client) {
            throw new Error('[RedisQueue] Redis client não inicializado');
        }
        return this.client;
    }

    /**
     * Enfileira um item na fila (adiciona ao final)
     */
    async enqueue(queueName: string, data: any): Promise<number> {
        try {
            const client = this.getClient();
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
            const rawItems = await client.lrange(`zapmass:queue:${queueName}`, 0, -1);
            return rawItems.map(item => JSON.parse(item) as T);
        } catch (e) {
            console.error(`[RedisQueue] Erro ao buscar todos os itens de ${queueName}:`, e);
            return [];
        }
    }
}

export const redisQueue = new RedisQueue();
