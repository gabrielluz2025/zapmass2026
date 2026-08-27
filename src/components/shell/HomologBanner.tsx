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
    <div
      className="homolog-banner flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/35 bg-amber-950/92 px-3 py-1.5 text-center text-[11px] font-medium text-amber-100/95"
      role="status"
      aria-live="polite"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
      <span className="truncate">
        Homologação — dados de teste. Produção:{' '}
        <a
          href="https://zap-mass.com"
          className="underline decoration-amber-400/50 underline-offset-2 hover:text-white"
          target="_blank"
          rel="noreferrer"
        >
          zap-mass.com
        </a>
      </span>
    </div>
  );
};
