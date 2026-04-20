import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Trash2, Smartphone, RefreshCw, Send, ListOrdered, QrCode, Loader2, Clock, Zap, ShieldCheck, ShieldAlert, Power, RotateCcw } from 'lucide-react';
import { WhatsAppConnection, ConnectionStatus } from '../types';

const formatUptime = (connectedSince?: number): string => {
  if (!connectedSince) return '—';
  const ms = Date.now() - connectedSince;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

interface ConnectionCardProps {
  connection: WhatsAppConnection;
  onDisconnect: (id: string) => void;
  onReconnect: (id: string) => void;
  onForceQr: (id: string) => void;
}

export const ConnectionCardNew: React.FC<ConnectionCardProps> = ({ 
  connection, 
  onDisconnect, 
  onReconnect,
  onForceQr
}) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const isConnected = connection.status === ConnectionStatus.CONNECTED;
  const isConnecting = connection.status === ConnectionStatus.CONNECTING || connection.status === ConnectionStatus.QR_READY;
  const isQrReady = connection.status === ConnectionStatus.QR_READY;
  const isAuthenticating = connection.status === ConnectionStatus.CONNECTING && !isQrReady && connection.lastActivity?.includes('Autenticado');

  const [qrSeconds, setQrSeconds] = useState(60);
  useEffect(() => {
    if (!isQrReady || !connection.qrCode) return;
    setQrSeconds(60);
    const interval = setInterval(() => {
      setQrSeconds(s => {
        if (s <= 1) { clearInterval(interval); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [connection.qrCode]);

  const statusColor = isConnected ? '#10b981' : isConnecting ? '#f59e0b' : '#ef4444';
  const statusLabel = isConnected ? 'Online' : isConnecting ? 'Conectando' : 'Offline';
  const healthScore = connection.healthScore ?? 100;

  return (
    <div className="relative group rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-2xl"
      style={{
        background: 'var(--surface)',
        border: `2px solid ${isConnected ? 'rgba(16,185,129,0.25)' : isConnecting ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.15)'}`,
      }}
    >
      {/* Animated top bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${statusColor}88, ${statusColor})` }}>
        {isConnecting && <div className="h-full w-1/3 bg-white/50 animate-[shimmer_1.5s_infinite] rounded-full" />}
      </div>

      {/* Glow effect when connected */}
      {isConnected && (
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
          style={{ background: `radial-gradient(ellipse at top, ${statusColor}, transparent 70%)` }} />
      )}

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-center gap-4 mb-5">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-lg" style={{ border: `3px solid ${statusColor}40` }}>
              {connection.profilePicUrl ? (
                <img src={connection.profilePicUrl} alt={connection.name} className="w-full h-full object-cover" />
              ) : (
                <img
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(connection.name)}&background=${isConnected ? '10b981' : '64748b'}&color=fff&size=112&bold=true`}
                  className="w-full h-full object-cover" alt=""
                />
              )}
            </div>
            {/* Status dot */}
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}60`, border: '2.5px solid var(--surface)' }}>
              {isConnected ? <Wifi className="w-2.5 h-2.5 text-white" /> :
               isConnecting ? <RefreshCw className="w-2.5 h-2.5 text-white animate-spin" /> :
               <WifiOff className="w-2.5 h-2.5 text-white" />}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-black text-slate-900 dark:text-white truncate">{connection.name}</h3>
              <span className="text-[9px] font-black px-2.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: `${statusColor}18`, color: statusColor }}>
                {statusLabel}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono truncate">{connection.phoneNumber || 'Aguardando conexão...'}</p>
          </div>
        </div>

        {/* QR / Auth / Connecting state */}
        {isAuthenticating ? (
          <div className="mb-4 p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)' }}>
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
            <div>
              <p className="text-xs font-black text-slate-900 dark:text-white">QR Escaneado!</p>
              <p className="text-[10px] text-slate-400 font-semibold">Autenticando sessão...</p>
            </div>
          </div>
        ) : isQrReady && connection.qrCode ? (
          <div className="mb-4 flex flex-col items-center gap-3">
            <div className="bg-white p-3 rounded-2xl shadow-xl ring-1 ring-slate-100">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(connection.qrCode)}`}
                alt="QR" className="w-44 h-44"
              />
            </div>
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-400">Escaneie com o WhatsApp</span>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-2)' }}>
                <div className={`w-2 h-2 rounded-full ${qrSeconds > 20 ? 'bg-emerald-500' : qrSeconds > 10 ? 'bg-amber-500 animate-pulse' : 'bg-red-500 animate-pulse'}`} />
                <span className="text-[10px] font-black text-slate-500 tabular-nums">{qrSeconds}s</span>
              </div>
            </div>
            <button onClick={() => onForceQr(connection.id)}
              className="text-[10px] font-bold text-slate-400 hover:text-orange-500 transition-colors underline underline-offset-2">
              Gerar novo QR Code
            </button>
          </div>
        ) : isConnecting && !isQrReady ? (
          <div className="mb-4 p-4 rounded-xl flex items-center gap-3" style={{ background: 'var(--surface-2)' }}>
            <div className="relative">
              <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Inicializando...</p>
              <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{connection.lastActivity || 'Carregando WhatsApp Web...'}</p>
            </div>
          </div>
        ) : isConnected ? (
          /* Stats grid for connected */
          <div className="space-y-2.5 mb-4">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Send className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[9px] font-black text-slate-400 uppercase">Hoje</span>
                </div>
                <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{connection.messagesSentToday.toLocaleString()}</span>
              </div>
              <div className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[9px] font-black text-slate-400 uppercase">Fila</span>
                </div>
                <span className={`text-xl font-black tabular-nums ${connection.queueSize > 50 ? 'text-amber-500' : 'text-slate-900 dark:text-white'}`}>
                  {connection.queueSize}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-2.5 rounded-xl text-center" style={{ background: 'var(--surface-2)' }}>
                <Zap className="w-3 h-3 text-purple-500 mx-auto mb-1" />
                <span className="text-xs font-black text-slate-900 dark:text-white tabular-nums block">{(connection.totalMessagesSent || 0).toLocaleString()}</span>
                <span className="text-[8px] font-black text-slate-400 uppercase">Total</span>
              </div>
              <div className="p-2.5 rounded-xl text-center" style={{ background: 'var(--surface-2)' }}>
                <Clock className="w-3 h-3 text-sky-500 mx-auto mb-1" />
                <span className="text-xs font-black text-slate-900 dark:text-white tabular-nums block">{formatUptime(connection.connectedSince)}</span>
                <span className="text-[8px] font-black text-slate-400 uppercase">Uptime</span>
              </div>
              <div className="p-2.5 rounded-xl text-center" style={{ background: 'var(--surface-2)' }}>
                {healthScore >= 70
                  ? <ShieldCheck className="w-3 h-3 text-emerald-500 mx-auto mb-1" />
                  : <ShieldAlert className="w-3 h-3 text-amber-500 mx-auto mb-1" />}
                <span className="text-xs font-black tabular-nums block"
                  style={{ color: healthScore >= 70 ? '#10b981' : healthScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                  {healthScore}%
                </span>
                <span className="text-[8px] font-black text-slate-400 uppercase">Saúde</span>
              </div>
            </div>
          </div>
        ) : (
          /* Offline prompt */
          <div className="mb-4 p-5 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}>
            <WifiOff className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500">Canal desconectado</p>
            <p className="text-[10px] text-slate-400 mt-1">Clique em Conectar para iniciar</p>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* Battery */}
          {connection.batteryLevel !== undefined ? (
            <div className="flex items-center gap-1.5">
              <div className={`w-6 h-3 rounded-sm border p-px ${connection.batteryLevel < 20 ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'}`}>
                <div className={`h-full rounded-[1px] ${connection.batteryLevel < 20 ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${connection.batteryLevel}%` }} />
              </div>
              <span className="text-[10px] font-black text-slate-400 tabular-nums">{connection.batteryLevel}%</span>
            </div>
          ) : <div />}

          <div className="flex items-center gap-2">
            {!isConnected && !isConnecting && (
              <>
                <button onClick={() => onReconnect(connection.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95 hover:shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 2px 12px rgba(16,185,129,0.3)' }}>
                  <Power className="w-3.5 h-3.5" />
                  Conectar
                </button>
                <button onClick={() => onForceQr(connection.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95"
                  style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <QrCode className="w-3.5 h-3.5" />
                  QR
                </button>
              </>
            )}
            {isConnected && (
              <button onClick={() => onReconnect(connection.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95"
                style={{ background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                <RotateCcw className="w-3.5 h-3.5" />
                Reiniciar
              </button>
            )}
            {isConnecting && (
              <button onClick={() => onForceQr(connection.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95"
                style={{ background: 'rgba(245,158,11,0.08)', color: '#d97706' }}>
                <QrCode className="w-3.5 h-3.5" />
                Forçar QR
              </button>
            )}
            <button onClick={() => onDisconnect(connection.id)}
              className="p-2 text-slate-400 hover:text-red-500 transition-all rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 active:scale-90">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
