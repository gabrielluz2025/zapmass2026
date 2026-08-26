import type { Express, Request, Response } from 'express';
import { assertAdminFromBearer } from './adminAuth.js';
import {
    EVOLUTION_GO_PARITY_MATRIX,
    paritySummaryForGo,
} from './evolutionProvider/parityMatrix.js';
import {
    activeEvolutionBaseUrl,
    evolutionEngineConfig,
    isEvolutionGoEngine,
    resolveWhatsAppEngine,
} from './evolutionEngineConfig.js';
import { probeEvolutionGoLicenseActive } from './evolutionGoLicense.js';

export function registerEvolutionEngineRoutes(app: Express): void {
    app.get('/api/admin/evolution-engine', async (req: Request, res: Response) => {
        const auth = await assertAdminFromBearer(req, res);
        if (!auth) return;

        let goReachable: boolean | null = null;
        let goLicense: { active: boolean; registerUrl?: string } | null = null;
        if (isEvolutionGoEngine() || req.query.probeGo === '1') {
            try {
                const url = `${evolutionEngineConfig.go.url.replace(/\/$/, '')}/server/ok`;
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 5_000);
                const r = await fetch(url, {
                    headers: { apikey: evolutionEngineConfig.go.globalKey },
                    signal: ctrl.signal,
                });
                clearTimeout(t);
                goReachable = r.ok;
            } catch {
                goReachable = false;
            }
            goLicense = await probeEvolutionGoLicenseActive();
        }

        return res.json({
            ok: true,
            engine: resolveWhatsAppEngine(),
            activeBaseUrl: activeEvolutionBaseUrl(),
            api: evolutionEngineConfig.api,
            go: {
                url: evolutionEngineConfig.go.url,
                image: evolutionEngineConfig.go.image,
                reachable: goReachable,
                licenseActive: goLicense?.active ?? null,
                licenseRegisterUrl: goLicense?.registerUrl ?? null,
            },
            parity: paritySummaryForGo(),
            matrix: EVOLUTION_GO_PARITY_MATRIX,
        });
    });
}
