import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

export type WaSocketStatus = 'online' | 'offline' | 'slow';

/** Reemit inbox do servidor (leve) enquanto a aba está visível. */
const AUTO_LIGHT_SYNC_MS = 90_000;
/** Não re-sincroniza se houve delta/update recente. */
const RECENT_REALTIME_SKIP_MS = 45_000;
/** Acima disso (RTT), considera servidor lento — sync pesado pode atrasar pong sem estar offline. */
const SLOW_RTT_MS = 45_000;
/** Pings consecutivos lentos antes de exibir aviso (evita falso positivo). */
const SLOW_STRIKES_NEEDED = 2;
/** Queda curta do socket não vira “offline” na hora — alinhado ao grace do painel. */
const OFFLINE_STATUS_GRACE_MS = 8_000;

function parsePingTimestamp(ts: unknown): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string' && ts.trim()) {
    const n = Number(ts);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Socket + sync leve; não confundir com chip WhatsApp CONNECTED. */
export function useWaRealtime(
  socket: Socket | null,
  onResync: (opts?: { full?: boolean }) => void,
  _opts?: { chipsConnected?: number }
) {
  const [socketStatus, setSocketStatus] = useState<WaSocketStatus>('offline');
  const [syncing, setSyncing] = useState(false);
  const pingSentAtRef = useRef(0);
  const slowStrikeRef = useRef(0);
  const lastRealtimeActivityRef = useRef(0);
  const syncingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runResync = useCallback(
    (opts?: { full?: boolean }) => {
      if (!socket?.connected) return;
      if (
        !opts?.full &&
        lastRealtimeActivityRef.current > 0 &&
        Date.now() - lastRealtimeActivityRef.current < RECENT_REALTIME_SKIP_MS
      ) {
        return;
      }
      setSyncing(true);
      if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
      syncingTimerRef.current = setTimeout(() => setSyncing(false), opts?.full ? 120_000 : 12_000);
      onResync(opts);
    },
    [socket, onResync]
  );

  useEffect(() => {
    if (!socket) {
      setSocketStatus('offline');
      setSyncing(false);
      return;
    }

    const markRealtimeActivity = () => {
      lastRealtimeActivityRef.current = Date.now();
      slowStrikeRef.current = 0;
      setSocketStatus('online');
    };

    const clearOfflineGrace = () => {
      if (offlineGraceTimerRef.current) {
        clearTimeout(offlineGraceTimerRef.current);
        offlineGraceTimerRef.current = null;
      }
    };

    const onConnect = () => {
      clearOfflineGrace();
      pingSentAtRef.current = Date.now();
      slowStrikeRef.current = 0;
      setSocketStatus('online');
      runResync({ full: false });
    };
    const onDisconnect = () => {
      clearOfflineGrace();
      setSyncing(false);
      slowStrikeRef.current = 0;
      offlineGraceTimerRef.current = setTimeout(() => {
        offlineGraceTimerRef.current = null;
        if (!socket.connected) setSocketStatus('offline');
      }, OFFLINE_STATUS_GRACE_MS);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setSocketStatus(socket.connected ? 'online' : 'offline');

    const pingTimer = setInterval(() => {
      if (!socket.connected) return;
      pingSentAtRef.current = Date.now();
      socket.emit('ping-latency', pingSentAtRef.current);
    }, 20000);

    const onPong = (ts: unknown) => {
      if (!socket.connected) {
        setSocketStatus('offline');
        return;
      }
      const sentAt = parsePingTimestamp(ts);
      const base =
        sentAt > 1e12 ? sentAt : pingSentAtRef.current > 0 ? pingSentAtRef.current : 0;
      if (!base) {
        setSocketStatus('online');
        return;
      }
      const ms = Math.max(0, Date.now() - base);
      if (ms > SLOW_RTT_MS) {
        slowStrikeRef.current += 1;
        if (slowStrikeRef.current >= SLOW_STRIKES_NEEDED) setSocketStatus('slow');
      } else {
        slowStrikeRef.current = 0;
        setSocketStatus('online');
      }
    };
    socket.on('pong-latency', onPong);

    const onVis = () => {
      if (document.visibilityState !== 'visible' || !socket.connected) return;
      if (
        lastRealtimeActivityRef.current > 0 &&
        Date.now() - lastRealtimeActivityRef.current < RECENT_REALTIME_SKIP_MS
      ) {
        return;
      }
      runResync({ full: false });
    };
    document.addEventListener('visibilitychange', onVis);

    const lightSyncTimer = setInterval(() => {
      if (document.visibilityState !== 'visible' || !socket.connected) return;
      if (
        lastRealtimeActivityRef.current > 0 &&
        Date.now() - lastRealtimeActivityRef.current < RECENT_REALTIME_SKIP_MS
      ) {
        return;
      }
      runResync({ full: false });
    }, AUTO_LIGHT_SYNC_MS);

    const onConv = () => {
      markRealtimeActivity();
      if (syncingTimerRef.current) {
        clearTimeout(syncingTimerRef.current);
        syncingTimerRef.current = setTimeout(() => setSyncing(false), 1500);
      }
    };
    socket.on('conversations-update', onConv);
    socket.on('conversation-delta', onConv);
    socket.on('inbox-page', onConv);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('pong-latency', onPong);
      socket.off('conversations-update', onConv);
      socket.off('conversation-delta', onConv);
      socket.off('inbox-page', onConv);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(pingTimer);
      clearInterval(lightSyncTimer);
      if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
      clearOfflineGrace();
    };
  }, [socket, runResync]);

  return { socketStatus, syncing, runResync };
}
