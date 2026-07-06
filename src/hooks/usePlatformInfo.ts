import { useEffect, useState } from 'react';
import type { PlatformLegalInfo } from '../../shared/platformLegal';
import { apiUrl } from '../utils/apiBase';

let cache: PlatformLegalInfo | null = null;
let inflight: Promise<PlatformLegalInfo | null> | null = null;

async function fetchPlatformInfo(): Promise<PlatformLegalInfo | null> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch(apiUrl('/api/platform-info'))
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && typeof data === 'object' && data.legalName !== undefined) {
        cache = data as PlatformLegalInfo;
        return cache;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function usePlatformInfo(): {
  info: PlatformLegalInfo | null;
  loading: boolean;
} {
  const [info, setInfo] = useState<PlatformLegalInfo | null>(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) {
      setInfo(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetchPlatformInfo().then((data) => {
      if (!cancelled) {
        setInfo(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { info, loading };
}
