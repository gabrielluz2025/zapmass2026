import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import http from 'node:http';
import https from 'node:https';
import {
    activeEvolutionBaseUrl,
    activeEvolutionGlobalApiKey,
    evolutionEngineConfig,
    isEvolutionGoEngine,
} from '../evolutionEngineConfig.js';
import { attachEvolutionAxiosRetry } from '../evolutionAxiosRetry.js';
import {
    adaptEvolutionApiRequestToGo,
    normalizeGoResponseToApiV2,
    type InstanceTokenStore,
} from './goRouteAdapter.js';

const evolutionHttpAgent = new http.Agent({ family: 4, keepAlive: true });
const evolutionHttpsAgent = new https.Agent({ family: 4, keepAlive: true });

/**
 * Cliente HTTP unificado: Evolution API v2 (pass-through) ou Evolution Go (adapter).
 * O restante do ZapMass continua usando paths v2; o adapter traduz quando engine=go.
 */
export function createEvolutionHttpClient(tokenStore: InstanceTokenStore): AxiosInstance {
    const baseURL = activeEvolutionBaseUrl();
    const apiKey = activeEvolutionGlobalApiKey();

    const client = axios.create({
        baseURL,
        timeout: evolutionEngineConfig.timeout,
        httpAgent: evolutionHttpAgent,
        httpsAgent: evolutionHttpsAgent,
        headers: {
            apikey: apiKey,
            'Content-Type': 'application/json',
        },
    });

    if (isEvolutionGoEngine()) {
        client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
            const adapted = adaptEvolutionApiRequestToGo(config, tokenStore);
            if (adapted.syntheticResponse) {
                (config as InternalAxiosRequestConfig & { __synthetic?: unknown }).__synthetic =
                    adapted.syntheticResponse;
            }
            config.url = adapted.url;
            if (adapted.data !== undefined) config.data = adapted.data;
            if (adapted.methodOverride) config.method = adapted.methodOverride;
            config.headers = { ...config.headers, ...adapted.headers };
            return config;
        });

        client.interceptors.response.use(
            (response) => {
                response.data = normalizeGoResponseToApiV2(String(response.config.url || ''), response.data);
                return response;
            },
            (error) => Promise.reject(error)
        );

        client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
            const syn = (config as InternalAxiosRequestConfig & { __synthetic?: { status: number; data: unknown } })
                .__synthetic;
            if (syn) {
                config.adapter = async () => ({
                    data: syn.data,
                    status: syn.status,
                    statusText: 'OK',
                    headers: {},
                    config,
                });
            }
            return config;
        });
    }

    attachEvolutionAxiosRetry(client);
    return client;
}

export type { InstanceTokenStore };
