import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { evolutionConfig } from './evolutionConfig.js';

type RetryConfig = InternalAxiosRequestConfig & { __evoRetry?: number };

/** Falha de rede/DNS sem resposta HTTP — seguro retentar (o pedido não chegou). */
export function isTransientEvolutionNetworkError(err: unknown): boolean {
  const ax = err as { code?: string; message?: string; response?: unknown };
  if (ax?.response) return false;
  const blob = `${ax?.code || ''} ${ax?.message || ''}`;
  return /EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|EPIPE|getaddrinfo|socket hang up|Network Error|ECONNABORTED/i.test(
    blob
  );
}

export function evolutionNetworkUserMessage(): string {
  return 'WhatsApp está reiniciando ou indisponível no momento. Espere alguns segundos e envie de novo.';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry em EAI_AGAIN / DNS / conexão recusada — cobre envio de aniversário no meio do deploy. */
export function attachEvolutionAxiosRetry(api: AxiosInstance): void {
  api.interceptors.response.use(
    (res) => res,
    async (error: unknown) => {
      const cfg = (error as { config?: RetryConfig })?.config;
      if (!cfg || !isTransientEvolutionNetworkError(error)) {
        return Promise.reject(error);
      }
      const n = cfg.__evoRetry ?? 0;
      const max = Math.max(1, Number(evolutionConfig.maxRetries) || 3);
      if (n >= max) return Promise.reject(error);
      cfg.__evoRetry = n + 1;
      const delay = Math.max(400, Number(evolutionConfig.retryDelay) || 2000) * cfg.__evoRetry;
      await sleep(delay);
      return api.request(cfg);
    }
  );
}
