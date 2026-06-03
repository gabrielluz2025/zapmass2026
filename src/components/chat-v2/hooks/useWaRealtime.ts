import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

export type WaConnectionStatus = 'online' | 'offline';

/** Sync ao focar aba + estado conectado (sem exibir ms de ping — evita números absurdos). */
export function useWaRealtime(socket: Socket | null, onResync: () => void) {
  const [status, setStatus] = useState<WaConnectionStatus>('offline');
  const pingSentAtRef = useRef(0);

  const bump = useCallback(() => {
    /* reservado para animações futuras */
  }, []);

  useEffect(() => {
    if (!socket) {
      setStatus('offline');
      return;
    }

    const onConnect = () => {
      setStatus('online');
      onResync();
    };
    const onDisconnect = () => setStatus('offline');
    const onConv = () => bump();

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('conversations-update', onConv);
    setStatus(socket.connected ? 'online' : 'offline');

    const pingTimer = setInterval(() => {
      if (!socket.connected) return;
      pingSentAtRef.current = Date.now();
      socket.emit('ping-latency', pingSentAtRef.current);
    }, 15000);

    const onPong = (ts: number) => {
      const base = typeof ts === 'number' && ts > 1e12 ? ts : pingSentAtRef.current;
      const ms = Date.now() - base;
      if (ms > 8000) setStatus('offline');
      else if (socket.connected) setStatus('online');
    };
    socket.on('pong-latency', onPong);

    const onVis = () => {
      if (document.visibilityState === 'visible' && socket.connected) onResync();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('conversations-update', onConv);
      socket.off('pong-latency', onPong);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(pingTimer);
    };
  }, [socket, onResync, bump]);

  return { status, bump };
}
