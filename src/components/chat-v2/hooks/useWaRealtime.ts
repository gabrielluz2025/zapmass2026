import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

/** Ping/pong + sync ao focar aba — sensação WhatsApp Web em tempo real. */
export function useWaRealtime(socket: Socket | null, onResync: () => void) {
  const [connected, setConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number>(Date.now());
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bump = useCallback(() => {
    setLastUpdateAt(Date.now());
  }, []);

  useEffect(() => {
    if (!socket) {
      setConnected(false);
      setLatencyMs(null);
      return;
    }

    const onConnect = () => {
      setConnected(true);
      onResync();
    };
    const onDisconnect = () => setConnected(false);

    const onConv = () => bump();

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('conversations-update', onConv);
    setConnected(socket.connected);

    pingRef.current = setInterval(() => {
      if (!socket.connected) return;
      const t0 = Date.now();
      socket.emit('ping-latency', t0);
    }, 8000);

    const onPong = (ts: number) => {
      if (typeof ts === 'number' && ts > 0) {
        setLatencyMs(Math.max(0, Date.now() - ts));
      }
    };
    socket.on('pong-latency', onPong);

    const onVis = () => {
      if (document.visibilityState === 'visible' && socket.connected) {
        onResync();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('conversations-update', onConv);
      socket.off('pong-latency', onPong);
      document.removeEventListener('visibilitychange', onVis);
      if (pingRef.current) clearInterval(pingRef.current);
    };
  }, [socket, onResync, bump]);

  return { connected, latencyMs, lastUpdateAt, bump };
}
