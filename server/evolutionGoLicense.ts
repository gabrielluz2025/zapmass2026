import axios from 'axios';
import { evolutionEngineConfig, isEvolutionGoEngine } from './evolutionEngineConfig.js';

export const EVOLUTION_GO_LICENSE_HINT =
    'Evolution Go exige licença Foundation ativa. Na VPS: abra http://127.0.0.1:8081/manager (túnel SSH), faça login e conclua a ativação. Depois use Forçar QR novamente.';

/** Resposta 503 / LICENSE_REQUIRED ou mensagem contendo "license". */
export function isEvolutionGoLicenseError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const row = error as {
        response?: { status?: number; data?: unknown };
        message?: string;
    };
    if (row.response?.status === 503) return true;
    const data = row.response?.data;
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        const code = String(d.code || (d.error as Record<string, unknown> | undefined)?.code || '').toUpperCase();
        if (code.includes('LICENSE')) return true;
    }
    const blob = JSON.stringify(data ?? row.message ?? '').toLowerCase();
    return blob.includes('license') || blob.includes('licença') || blob.includes('licenca');
}

export function evolutionGoLicenseUserMessage(error?: unknown): string {
    if (error && typeof error === 'object') {
        const data = (error as { response?: { data?: unknown } }).response?.data;
        if (data && typeof data === 'object') {
            const d = data as Record<string, unknown>;
            const registerUrl = d.register_url || d.registerUrl;
            if (typeof registerUrl === 'string' && registerUrl.trim()) {
                return `${EVOLUTION_GO_LICENSE_HINT} Link: ${registerUrl.trim()}`;
            }
        }
    }
    return EVOLUTION_GO_LICENSE_HINT;
}

export async function probeEvolutionGoLicenseActive(): Promise<{
    active: boolean;
    registerUrl?: string;
    raw?: unknown;
}> {
    if (!isEvolutionGoEngine()) return { active: true };
    try {
        const base = evolutionEngineConfig.go.url.replace(/\/$/, '');
        const r = await axios.get(`${base}/license/status`, {
            headers: { apikey: evolutionEngineConfig.go.globalKey },
            timeout: 8_000,
            validateStatus: () => true,
        });
        const data = r.data as Record<string, unknown> | undefined;
        const inner = (data?.data && typeof data.data === 'object' ? data.data : data) as
            | Record<string, unknown>
            | undefined;
        const active =
            inner?.active === true ||
            inner?.licensed === true ||
            inner?.status === 'active' ||
            (r.status === 200 && inner?.active !== false && !String(inner?.message || '').toLowerCase().includes('license'));
        const registerUrl =
            typeof inner?.register_url === 'string'
                ? inner.register_url
                : typeof data?.register_url === 'string'
                  ? data.register_url
                  : undefined;
        if (r.status === 503 || isEvolutionGoLicenseError({ response: { status: r.status, data } })) {
            return { active: false, registerUrl, raw: data };
        }
        return { active: Boolean(active), registerUrl, raw: data };
    } catch {
        return { active: false };
    }
}

export async function assertEvolutionGoLicensed(operation: string): Promise<void> {
    if (!isEvolutionGoEngine()) return;
    const lic = await probeEvolutionGoLicenseActive();
    if (!lic.active) {
        throw new Error(
            lic.registerUrl
                ? `${EVOLUTION_GO_LICENSE_HINT} (${operation})`
                : `${EVOLUTION_GO_LICENSE_HINT} (${operation})`
        );
    }
}
