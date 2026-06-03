import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

export type WaSocketStatus = 'online' | 'offline' | 'slow';

/** Socket + sync leve; não confundir com chip WhatsApp CONNECTED. */
export function useWaRealtime(
  socket: Socket | null,
  onResync: (opts?: { full?: boolean }) => void
) {
  const [socketStatus, setSocketStatus] = useState<WaSocketStatus>('offline');
  const [syncing, setSyncing] = useState(false);
  const pingSentAtRef = useRef(0);
  const syncingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runResync = useCallback(
    (opts?: { full?: boolean }) => {
      if (!socket?.connected) return;
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

    const onConnect = () => {
      setSocketStatus('online');
      runResync({ full: false });
    };
    const onDisconnect = () => {
      setSocketStatus('offline');
      setSyncing(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setSocketStatus(socket.connected ? 'online' : 'offline');

    const pingTimer = setInterval(() => {
      if (!socket.connected) return;
      pingSentAtRef.current = Date.now();
      socket.emit('ping-latency', pingSentAtRef.current);
    }, 20000);

    const onPong = (ts: number) => {
      if (!socket.connected) {
        setSocketStatus('offline');
        return;
      }
      const base = typeof ts === 'number' && ts > 1e12 ? ts : pingSentAtRef.current;
      const ms = Date.now() - base;
      if (ms > 25_000) setSocketStatus('slow');
      else setSocketStatus('online');
    };
    socket.on('pong-latency', onPong);

    const onVis = () => {
      if (document.visibilityState === 'visible' && socket.connected) {
        runResync({ full: false });
      }
    };
    document.addEventListener('visibilitychange', onVis);

    const onConv = () => {
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
      if (syncingTimerRef.current) clearTimeout(syncingTimerRef.current);
    };
  }, [socket, runResync]);

  return { socketStatus, syncing, runResync };
}
