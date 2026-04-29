import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';

const TICK_MS = 30_000;

/**
 * Envia heartbeats ao servidor enquanto a aba está visível e o socket ligado.
 * O servidor acumula tempo por conta (dono do workspace) em Firestore.
 */
export function useSessionUsageHeartbeat(socket: Socket | null | undefined): void {
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!socket) return;

    const clearTick = () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };

    const ping = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!socket.connected) return;
      socket.emit('usage-heartbeat');
    };

    const startTick = () => {
      clearTick();
      tickRef.current = setInterval(ping, TICK_MS);
      ping();
    };

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        startTick();
      } else {
        clearTick();
      }
    };

    const onConnect = () => startTick();
    const onDisconnect = () => clearTick();

    onVisibility();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      clearTick();
    };
  }, [socket]);
}
