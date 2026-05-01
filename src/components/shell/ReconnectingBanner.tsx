import React, { useEffect, useState } from 'react';
import { WifiOff, Loader2 } from 'lucide-react';
import { useZapMass } from '../../context/ZapMassContext';

/**
 * Faixa abaixo da TopBar quando o socket cai por mais de 1.5s.
 * Não aparece em quedas instantâneas, para evitar piscar em renavegação.
 */
export const ReconnectingBanner: React.FC = () => {
  const { isBackendConnected } = useZapMass();
  const [show, setShow] = useState(false);
  const [secondsOffline, setSecondsOffline] = useState(0);

  useEffect(() => {
    if (isBackendConnected) {
      setShow(false);
      setSecondsOffline(0);
      return;
    }
    const startedAt = Date.now();
    const showTimer = setTimeout(() => setShow(true), 1500);
    const interval = setInterval(() => {
      setSecondsOffline(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      clearTimeout(showTimer);
      clearInterval(interval);
    };
  }, [isBackendConnected]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="px-4 py-2 border-b flex items-center gap-3"
      style={{
        background: 'rgba(245, 158, 11, 0.10)',
        borderColor: 'rgba(245, 158, 11, 0.30)'
      }}
    >
      <div className="relative flex items-center justify-center">
        <WifiOff className="w-4 h-4 text-amber-600" />
        <Loader2 className="w-3 h-3 text-amber-600 animate-spin absolute -bottom-1 -right-1" />
      </div>
      <p className="text-[12px] leading-snug flex-1" style={{ color: 'var(--text-1)' }}>
        <span className="font-semibold">Reconectando ao servidor</span>
        {secondsOffline > 0 && (
          <span className="text-amber-700/80 ml-1.5">
            ({secondsOffline}s sem ligação — comandos enviados ficam pendentes até voltar)
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-md text-amber-700 hover:bg-amber-100 transition-colors"
      >
        Recarregar
      </button>
    </div>
  );
};
