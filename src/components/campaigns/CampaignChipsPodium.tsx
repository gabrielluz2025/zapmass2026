import React, { useMemo } from 'react';
import { Crown, Medal, Smartphone, Trophy } from 'lucide-react';
import { ConnectionStatus, WhatsAppConnection } from '../../types';

interface ChipPerfRow {
  id: string;
  name: string;
  sent: number;
  replied: number;
  failed: number;
  replyRate: number;
}

interface CampaignChipsPodiumProps {
  selectedConnectionIds: string[];
  connections: WhatsAppConnection[];
  chipBreakdown: Array<{ id: string; name: string; sent: number; replied: number; replyRate: number }>;
  failedPerChip?: Map<string, number>;
}

export const CampaignChipsPodium: React.FC<CampaignChipsPodiumProps> = ({
  selectedConnectionIds,
  connections,
  chipBreakdown,
  failedPerChip
}) => {
  const rows = useMemo<ChipPerfRow[]>(() => {
    const byId = new Map(chipBreakdown.map((c) => [c.id, c]));
    const out: ChipPerfRow[] = selectedConnectionIds.map((id) => {
      const conn = connections.find((c) => c.id === id);
      const bd = byId.get(id);
      return {
        id,
        name: conn?.name || id.slice(0, 8),
        sent: bd?.sent || 0,
        replied: bd?.replied || 0,
        failed: failedPerChip?.get(id) || 0,
        replyRate: bd?.replyRate || 0
      };
    });
    return out.sort((a, b) => {
      if (b.sent !== a.sent) return b.sent - a.sent;
      return b.replyRate - a.replyRate;
    });
  }, [selectedConnectionIds, connections, chipBreakdown, failedPerChip]);

  const totalSent = rows.reduce((a, r) => a + r.sent, 0);
  const onlineCount = selectedConnectionIds.filter((id) => {
    const c = connections.find((x) => x.id === id);
    return c?.status === ConnectionStatus.CONNECTED;
  }).length;

  return (
    <div
      className="rounded-2xl p-4 h-full flex flex-col"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(59,130,246,0.08))',
              border: '1px solid rgba(59,130,246,0.3)'
            }}
          >
            <Smartphone className="w-4 h-4 text-blue-500" />
          </div>
          <div className="min-w-0">
            <h3 className="ui-title text-[14px]">Desempenho da frota</h3>
            <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              {onlineCount}/{selectedConnectionIds.length} online • {totalSent.toLocaleString('pt-BR')} envios
            </p>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-[12px] py-6"
          style={{ color: 'var(--text-3)' }}
        >
          Nenhum chip atrelado a esta campanha.
        </div>
      ) : (
        <div className="space-y-2 flex-1 overflow-y-auto pr-1" style={{ maxHeight: 320 }}>
          {rows.map((row, idx) => {
            const conn = connections.find((c) => c.id === row.id);
            const isOnline = conn?.status === ConnectionStatus.CONNECTED;
            const share = totalSent > 0 ? (row.sent / totalSent) * 100 : 0;
            const isTop = idx === 0 && row.sent > 0;
            const isRunnerUp = idx === 1 && row.sent > 0;
            const isThird = idx === 2 && row.sent > 0;

            let medalIcon: React.ReactNode = null;
            let medalColor = 'var(--text-3)';
            if (isTop) {
              medalIcon = <Crown className="w-3.5 h-3.5" />;
              medalColor = '#f59e0b';
            } else if (isRunnerUp) {
              medalIcon = <Medal className="w-3.5 h-3.5" />;
              medalColor = '#94a3b8';
            } else if (isThird) {
              medalIcon = <Trophy className="w-3.5 h-3.5" />;
              medalColor = '#d97706';
            }

            return (
              <div
                key={row.id}
                className="rounded-xl p-3 relative transition-colors"
                style={{
                  background: isTop
                    ? 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))'
                    : 'var(--surface-1)',
                  border: `1px solid ${isTop ? 'rgba(245,158,11,0.25)' : 'var(--border-subtle)'}`
                }}
              >
                <div className="flex items-start gap-2.5">
                  {/* Ranking number */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-black text-[14px]"
                    style={{
                      background: isTop
                        ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                        : 'var(--surface-2)',
                      color: isTop ? 'white' : 'var(--text-2)',
                      boxShadow: isTop ? '0 2px 8px rgba(245,158,11,0.4)' : 'none'
                    }}
                  >
                    {idx + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {medalIcon && <span style={{ color: medalColor }}>{medalIcon}</span>}
                      <span
                        className="text-[12.5px] font-bold truncate"
                        style={{ color: 'var(--text-1)' }}
                      >
                        {row.name}
                      </span>
                      <span
                        className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider"
                        style={{ color: isOnline ? '#10b981' : '#ef4444' }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            background: isOnline ? '#10b981' : '#ef4444',
                            boxShadow: isOnline ? '0 0 6px rgba(16,185,129,0.6)' : 'none'
                          }}
                        />
                        {isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>

                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-[10.5px]">
                      <div>
                        <div
                          className="font-extrabold tabular-nums text-[13.5px]"
                          style={{ color: 'var(--text-1)' }}
                        >
                          {row.sent.toLocaleString('pt-BR')}
                        </div>
                        <div style={{ color: 'var(--text-3)' }}>envios</div>
                      </div>
                      <div>
                        <div
                          className="font-extrabold tabular-nums text-[13.5px]"
                          style={{ color: row.replied > 0 ? '#10b981' : 'var(--text-1)' }}
                        >
                          {row.replied}
                        </div>
                        <div style={{ color: 'var(--text-3)' }}>
                          respostas{row.sent > 0 && ` · ${row.replyRate}%`}
                        </div>
                      </div>
                      <div>
                        <div
                          className="font-extrabold tabular-nums text-[13.5px]"
                          style={{ color: row.failed > 0 ? '#ef4444' : 'var(--text-1)' }}
                        >
                          {row.failed}
                        </div>
                        <div style={{ color: 'var(--text-3)' }}>falhas</div>
                      </div>
                    </div>

                    {/* Share bar */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[9.5px] mb-1">
                        <span style={{ color: 'var(--text-3)' }}>Participação na campanha</span>
                        <span
                          className="font-mono font-bold tabular-nums"
                          style={{ color: 'var(--text-2)' }}
                        >
                          {Math.round(share)}%
                        </span>
                      </div>
                      <div
                        className="h-1 rounded-full overflow-hidden"
                        style={{ background: 'var(--surface-2)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${share}%`,
                            background: isTop
                              ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                              : 'linear-gradient(90deg, #3b82f6, #1d4ed8)'
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
