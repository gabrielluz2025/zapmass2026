import React from 'react';
import {
  Battery,
  BatteryLow,
  CheckCircle2,
  Clock,
  ListOrdered,
  Loader2,
  Pin,
  PinOff,
  Power,
  QrCode,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff
} from 'lucide-react';
import { WhatsAppConnection, ConnectionStatus } from '../types';

const formatUptime = (connectedSince?: number): string => {
  if (!connectedSince) return '—';
  const ms = Date.now() - connectedSince;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export interface ConnectionListRowProps {
  connection: WhatsAppConnection;
  isPinned: boolean;
  isSelected: boolean;
  selectMode: boolean;
  onTogglePin: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onReconnect: (id: string) => void;
  onForceQr: (id: string) => void;
  onDisconnect: (id: string) => void;
}

export const ConnectionListRow: React.FC<ConnectionListRowProps> = ({
  connection,
  isPinned,
  isSelected,
  selectMode,
  onTogglePin,
  onToggleSelect,
  onReconnect,
  onForceQr,
  onDisconnect
}) => {
  const isConnected = connection.status === ConnectionStatus.CONNECTED;
  const isConnecting =
    connection.status === ConnectionStatus.CONNECTING || connection.status === ConnectionStatus.QR_READY;
  const isQrReady = connection.status === ConnectionStatus.QR_READY;

  const statusColor = isConnected ? '#10b981' : isConnecting ? '#f59e0b' : '#ef4444';
  const statusLabel = isConnected ? 'Online' : isConnecting ? (isQrReady ? 'QR ativo' : 'Conectando') : 'Offline';
  const healthScore = connection.healthScore ?? 100;
  const battery = connection.batteryLevel ?? null;

  return (
    <div
      className="rounded-xl transition-all duration-200 hover:shadow-md group"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isSelected ? 'var(--brand-600)' : 'var(--border-subtle)'}`,
        boxShadow: isSelected ? '0 0 0 3px var(--brand-100, rgba(16,185,129,0.15))' : undefined
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Select checkbox (modo lote) */}
        {selectMode && (
          <button
            onClick={() => onToggleSelect(connection.id)}
            className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors"
            style={{
              background: isSelected ? 'var(--brand-600)' : 'var(--surface-1)',
              border: `1.5px solid ${isSelected ? 'var(--brand-600)' : 'var(--border)'}`,
              color: '#fff'
            }}
            aria-label="Selecionar"
          >
            {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Pin */}
        <button
          onClick={() => onTogglePin(connection.id)}
          className="p-1 rounded-lg transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          style={{
            opacity: isPinned ? 1 : undefined,
            color: isPinned ? 'var(--brand-600)' : 'var(--text-3)'
          }}
          title={isPinned ? 'Desafixar' : 'Fixar no topo'}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5 fill-current" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>

        {/* Avatar + status */}
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 rounded-xl overflow-hidden"
            style={{ border: `2px solid ${statusColor}44` }}
          >
            {connection.profilePicUrl ? (
              <img src={connection.profilePicUrl} alt={connection.name} className="w-full h-full object-cover" />
            ) : (
              <img
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
                  connection.name
                )}&background=${isConnected ? '10b981' : '64748b'}&color=fff&size=80&bold=true`}
                className="w-full h-full object-cover"
                alt=""
              />
            )}
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center"
            style={{ background: statusColor, border: '2px solid var(--surface)' }}
          >
            {isConnecting && <Loader2 className="w-2 h-2 text-white animate-spin" />}
          </span>
        </div>

        {/* Nome + número */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
              {connection.name}
            </span>
            <span
              className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: `${statusColor}1f`, color: statusColor }}
            >
              {statusLabel}
            </span>
          </div>
          <span className="text-[11px] font-mono truncate block" style={{ color: 'var(--text-3)' }}>
            {connection.phoneNumber || 'Aguardando conexão...'}
          </span>
        </div>

        {/* Métricas em grid */}
        <div className="hidden md:grid grid-cols-4 gap-3 text-center shrink-0">
          <MetricCell
            icon={<Send className="w-3 h-3" style={{ color: '#10b981' }} />}
            label="Hoje"
            value={connection.messagesSentToday.toLocaleString('pt-BR')}
          />
          <MetricCell
            icon={<ListOrdered className="w-3 h-3" style={{ color: '#3b82f6' }} />}
            label="Fila"
            value={String(connection.queueSize)}
            emphasis={connection.queueSize > 50 ? 'warning' : undefined}
          />
          <MetricCell
            icon={<Clock className="w-3 h-3" style={{ color: '#0ea5e9' }} />}
            label="Uptime"
            value={formatUptime(connection.connectedSince)}
          />
          <MetricCell
            icon={
              healthScore >= 70 ? (
                <ShieldCheck className="w-3 h-3" style={{ color: '#10b981' }} />
              ) : (
                <ShieldAlert className="w-3 h-3" style={{ color: '#f59e0b' }} />
              )
            }
            label="Saúde"
            value={`${healthScore}%`}
            emphasis={healthScore < 40 ? 'danger' : healthScore < 70 ? 'warning' : undefined}
          />
        </div>

        {/* Bateria */}
        {battery !== null && (
          <div
            className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-lg shrink-0"
            style={{
              background: battery < 20 ? 'rgba(239,68,68,0.1)' : 'var(--surface-2)',
              border: `1px solid ${battery < 20 ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)'}`
            }}
          >
            {battery < 20 ? (
              <BatteryLow className="w-3.5 h-3.5 text-red-500" />
            ) : (
              <Battery className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
            )}
            <span
              className="text-[10.5px] font-bold tabular-nums"
              style={{ color: battery < 20 ? '#ef4444' : 'var(--text-2)' }}
            >
              {battery}%
            </span>
          </div>
        )}

        {/* Ações */}
        <div className="flex items-center gap-1 shrink-0">
          {!isConnected && !isConnecting && (
            <button
              onClick={() => onReconnect(connection.id)}
              className="p-1.5 rounded-lg transition-colors"
              title="Conectar"
              style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
          )}
          {isConnected && (
            <button
              onClick={() => onReconnect(connection.id)}
              className="p-1.5 rounded-lg transition-colors"
              title="Reiniciar"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {(isConnecting || !isConnected) && (
            <button
              onClick={() => onForceQr(connection.id)}
              className="p-1.5 rounded-lg transition-colors"
              title="Forçar QR"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#d97706' }}
            >
              <QrCode className="w-3.5 h-3.5" />
            </button>
          )}
          {isConnected && (
            <div
              className="hidden sm:flex items-center gap-1 px-1.5"
              style={{ color: 'var(--text-3)' }}
              title="Sinal"
            >
              <Wifi className="w-3.5 h-3.5" />
            </div>
          )}
          {!isConnected && !isConnecting && (
            <div
              className="hidden sm:flex items-center gap-1 px-1.5"
              style={{ color: 'var(--text-3)' }}
            >
              <WifiOff className="w-3.5 h-3.5" />
            </div>
          )}
          <button
            onClick={() => onDisconnect(connection.id)}
            className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10 hover:text-red-500"
            style={{ color: 'var(--text-3)' }}
            title="Remover"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

const MetricCell: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  emphasis?: 'warning' | 'danger';
}> = ({ icon, label, value, emphasis }) => {
  const color =
    emphasis === 'danger' ? '#ef4444' : emphasis === 'warning' ? '#f59e0b' : 'var(--text-1)';
  return (
    <div className="min-w-[3.5rem]">
      <div className="flex items-center justify-center gap-1 mb-0.5">
        {icon}
        <span
          className="text-[9px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-3)' }}
        >
          {label}
        </span>
      </div>
      <span
        className="text-[12.5px] font-extrabold tabular-nums block leading-none"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
};
