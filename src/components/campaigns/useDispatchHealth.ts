import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDispatchHealth, type DispatchHealth } from '../../services/campaignsApi';

export type DispatchHealthUi = 'checking' | 'ok' | 'reconnecting' | 'error';

const SILENT_FAILURES_BEFORE_ERROR = 3;
const POLL_OK_MS = 45_000;
const POLL_RECONNECT_MS = 12_000;
const POLL_ERROR_MS = 20_000;

function resolveUi(
  health: DispatchHealth,
  consecutiveFailures: number,
  hadOk: boolean
): DispatchHealthUi {
  if (health.ok) return 'ok';

  const definiteServerIssue =
    health.reachable && (health.kind === 'redis_down' || health.kind === 'misconfig');

  if (definiteServerIssue) return 'error';

  if (health.kind === 'network' || !health.reachable) {
    if (hadOk && consecutiveFailures < SILENT_FAILURES_BEFORE_ERROR) {
      return consecutiveFailures <= 1 ? 'ok' : 'reconnecting';
    }
    return 'error';
  }

  return 'error';
}

export function useDispatchHealth() {
  const [health, setHealth] = useState<DispatchHealth | null>(null);
  const [ui, setUi] = useState<DispatchHealthUi>('checking');
  const failuresRef = useRef(0);
  const hadOkRef = useRef(false);
  const checkingRef = useRef(false);

  const check = useCallback(async (manual = false) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    if (manual) setUi('checking');

    try {
      const h = await fetchDispatchHealth({ retries: manual ? 1 : 2 });
      setHealth(h);

      if (h.ok) {
        failuresRef.current = 0;
        hadOkRef.current = true;
        setUi('ok');
        return;
      }

      failuresRef.current += 1;
      setUi(resolveUi(h, failuresRef.current, hadOkRef.current));
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const pollMs = ui === 'ok' ? POLL_OK_MS : ui === 'reconnecting' ? POLL_RECONNECT_MS : POLL_ERROR_MS;

  useEffect(() => {
    void check(false);
    const t = setInterval(() => void check(false), pollMs);
    return () => clearInterval(t);
  }, [check, pollMs]);

  return { health, ui, check: () => check(true) };
}
