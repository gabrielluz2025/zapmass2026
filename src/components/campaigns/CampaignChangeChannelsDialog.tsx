import React from 'react';
import { AlertTriangle, Check, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { ConnectionStatus, WhatsAppConnection } from '../../types';
import { Button, Modal } from '../ui';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  campaignName: string;
  connections: WhatsAppConnection[];
  selectedIds: string[];
  loading?: boolean;
  onConfirm: (connectionIds: string[]) => void;
};

export const CampaignChangeChannelsDialog: React.FC<Props> = ({
  isOpen,
  onClose,
  campaignName,
  connections,
  selectedIds,
  loading = false,
  onConfirm,
}) => {
  const [picked, setPicked] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!isOpen) return;
    const initial = selectedIds.length > 0 ? selectedIds : connections.map((c) => c.id);
    setPicked(initial.filter((id) => connections.some((c) => c.id === id)));
  }, [isOpen, selectedIds, connections]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const onlineCount = picked.filter(
    (id) => connections.find((c) => c.id === id)?.status === ConnectionStatus.CONNECTED
  ).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Trocar chips de disparo" size="md">
      <div className="space-y-4">
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
          Campanha <strong style={{ color: 'var(--text-1)' }}>{campaignName}</strong> — selecione
          quais chips vão enviar as mensagens pendentes. Jobs já na fila serão remapeados para os
          chips online escolhidos.
        </p>

        {onlineCount === 0 && picked.length > 0 && (
          <div
            className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px]"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}
          >
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <span style={{ color: 'var(--text-2)' }}>
              Nenhum chip selecionado está online. A campanha continuará pausada até reconectar — ou
              escolha um chip online (ex.: Disparo 01).
            </span>
          </div>
        )}

        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {connections.map((conn) => {
            const checked = picked.includes(conn.id);
            const online = conn.status === ConnectionStatus.CONNECTED;
            const inQuarantine = (conn.quarantineUntil ?? 0) > Date.now();
            return (
              <button
                key={conn.id}
                type="button"
                onClick={() => toggle(conn.id)}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                style={{
                  background: checked ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
                  border: checked
                    ? '1px solid rgba(16,185,129,0.35)'
                    : '1px solid var(--border-subtle)',
                }}
              >
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{
                    background: checked ? 'var(--brand-600)' : 'transparent',
                    border: checked ? 'none' : '1.5px solid var(--border-strong)',
                  }}
                >
                  {checked && <Check className="w-3 h-3 text-white" />}
                </div>
                <Smartphone className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                    {conn.name}
                  </p>
                  <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-3)' }}>
                    {conn.phoneNumber || 'Sem número'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className="flex items-center gap-1 text-[10px] font-bold"
                    style={{ color: online ? '#10b981' : '#ef4444' }}
                  >
                    {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    {online ? 'Online' : 'Offline'}
                  </span>
                  {inQuarantine && (
                    <span className="text-[9px] font-bold text-red-400">Quarentena</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={picked.length === 0}
            onClick={() => onConfirm(picked)}
          >
            Salvar chips ({picked.length})
          </Button>
        </div>
      </div>
    </Modal>
  );
};
