import { useCallback, useEffect, useState } from 'react';
import { fetchDispatchHealth, type DispatchHealth } from '../../services/campaignsApi';

export type DispatchHealthUi = 'checking' | 'ok' | 'error';

export function useDispatchHealth(pollMs = 25_000) {
  const [health, setHealth] = useState<DispatchHealth | null>(null);
  const [ui, setUi] = useState<DispatchHealthUi>('checking');

  const check = useCallback(async () => {
    setUi('checking');
    const h = await fetchDispatchHealth();
    setHealth(h);
    setUi(h.ok ? 'ok' : 'error');
    return h;
  }, []);

  useEffect(() => {
    void check();
    const t = setInterval(() => void check(), pollMs);
    return () => clearInterval(t);
  }, [check, pollMs]);

  return { health, ui, check };
}
