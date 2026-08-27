import React, { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';

function envFromBuild(): string {
  const v = String(import.meta.env.VITE_ZAPMASS_ENV || '').trim().toLowerCase();
  return v || 'production';
}

export const HomologBanner: React.FC = () => {
  const [env, setEnv] = useState<string>(() => envFromBuild());

  useEffect(() => {
    if (envFromBuild() === 'homolog') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { environment?: string };
        const remote = String(data.environment || '').trim().toLowerCase();
        if (!cancelled && remote) setEnv(remote);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (env !== 'homolog') return null;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-950/90 px-3 py-1.5 text-center text-xs font-semibold text-amber-100 backdrop-blur-sm"
        role="status"
        aria-live="polite"
      >
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
        <span>
          Ambiente de homologação — chips e dados de teste. Produção:{' '}
          <a
            href="https://zap-mass.com"
            className="underline decoration-amber-400/60 underline-offset-2 hover:text-white"
            target="_blank"
            rel="noreferrer"
          >
            zap-mass.com
          </a>
        </span>
      </div>
      <div className="h-8 shrink-0" aria-hidden />
    </>
  );
};
