import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  MessageCircleReply,
  Radio,
  Search,
  Send,
  Terminal
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SystemLog } from '../../types';
import { Button, Input } from '../ui';
import {
  countDispatchLogs,
  DISPATCH_LOG_STYLES,
  filterDispatchLogs,
  type LogFilterTab,
  parseDispatchLog,
  searchDispatchLogs
} from '../../utils/campaignDispatchLogUi';

type Props = {
  logs: SystemLog[];
  filter: LogFilterTab;
  onFilterChange: (f: LogFilterTab) => void;
  variant?: 'compact' | 'full';
  isRunning?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  maxItems?: number;
};

const KIND_ICON: Record<string, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  sent: Send,
  reply: MessageCircleReply,
  error: AlertCircle,
  warn: AlertTriangle,
  info: Terminal
};

function LogStatPill({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2 min-w-0 flex-1"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      <p className="text-lg font-black tabular-nums leading-tight" style={{ color: tone }}>
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  );
}

function DispatchLogRow({
  log,
  showDate,
  onCopyPhone
}: {
  log: SystemLog;
  showDate?: boolean;
  onCopyPhone: (phone: string) => void;
}) {
  const p = parseDispatchLog(log);
  const style = DISPATCH_LOG_STYLES[p.kind];
  const Icon = KIND_ICON[style.IconName] || Terminal;
  const timeStr = p.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = p.timestamp.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

  return (
    <div
      className="group flex gap-3 px-3 py-3 rounded-xl transition-colors hover:bg-[var(--surface-1)]"
      style={{ borderLeft: `3px solid ${style.accent}` }}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center mt-0.5"
        style={{ background: style.bg, border: `1px solid ${style.border}` }}
      >
        <Icon className="w-4 h-4" style={{ color: style.accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
              {p.label}
            </p>
            {p.phoneDisplay && (
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                >
                  {p.phoneDisplay}
                </span>
                <button
                  type="button"
                  onClick={() => onCopyPhone(p.phone)}
                  className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--surface-2)]"
                  title="Copiar número"
                >
                  <Copy className="w-3 h-3" style={{ color: 'var(--text-3)' }} />
                </button>
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-2)' }}>
              {timeStr}
            </p>
            {showDate && (
              <p className="text-[10px] capitalize" style={{ color: 'var(--text-3)' }}>
                {dateStr}
              </p>
            )}
          </div>
        </div>
        <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {p.detail}
        </p>
      </div>
    </div>
  );
}

export const CampaignDispatchLogs: React.FC<Props> = ({
  logs,
  filter,
  onFilterChange,
  variant = 'full',
  isRunning = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  maxItems
}) => {
  const [search, setSearch] = useState('');
  const counts = useMemo(() => countDispatchLogs(logs), [logs]);

  const filtered = useMemo(() => {
    const byTab = filterDispatchLogs(logs, filter);
    const bySearch = searchDispatchLogs(byTab, search);
    if (maxItems && maxItems > 0) return bySearch.slice(-maxItems).reverse();
    return bySearch.slice().reverse();
  }, [logs, filter, search, maxItems]);

  const successCount = counts.sent + counts.reply;
  const failCount = counts.error + counts.warn;

  const copyPhone = (phone: string) => {
    if (!phone) return;
    void navigator.clipboard.writeText(phone);
    toast.success('Número copiado.');
  };

  const tabItems: { id: LogFilterTab; label: string; count: number }[] = [
    { id: 'ALL', label: 'Todos', count: counts.all },
    { id: 'SENT', label: 'Sucessos', count: successCount },
    { id: 'FAILED', label: 'Falhas', count: failCount }
  ];

  return (
    <div className="flex flex-col gap-3">
      {variant === 'full' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <LogStatPill label="Total" value={counts.all} tone="var(--text-1)" />
          <LogStatPill label="Envios" value={counts.sent} tone="#10b981" />
          <LogStatPill label="Respostas" value={counts.reply} tone="#3b82f6" />
          <LogStatPill label="Falhas" value={failCount} tone="#ef4444" />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div
          className="inline-flex p-1 rounded-xl gap-1 flex-wrap"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          {tabItems.map((t) => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onFilterChange(t.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={{
                  background: active ? 'var(--brand-500)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-2)'
                }}
              >
                {t.label}
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
                  style={{
                    background: active ? 'rgba(255,255,255,0.2)' : 'var(--surface-2)',
                    color: active ? '#fff' : 'var(--text-3)'
                  }}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {variant === 'full' && (
          <div className="flex-1 min-w-[180px]">
            <Input
              placeholder="Buscar número ou evento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="w-3.5 h-3.5" />}
            />
          </div>
        )}

        {isRunning && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold shrink-0" style={{ color: '#10b981' }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Ao vivo
          </span>
        )}
      </div>

      <div
        className={`overflow-y-auto rounded-xl ${variant === 'compact' ? 'min-h-[200px] max-h-[300px]' : 'min-h-[280px] max-h-[min(58vh,520px)]'}`}
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
              style={{ background: 'var(--surface-1)' }}
            >
              {isRunning ? (
                <Radio className="w-5 h-5 animate-pulse" style={{ color: 'var(--brand-500)' }} />
              ) : (
                <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--text-3)' }} />
              )}
            </div>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              {search
                ? 'Nenhum evento corresponde à busca'
                : isRunning
                  ? 'Aguardando eventos do disparo'
                  : 'Nenhum log nesta categoria'}
            </p>
            <p className="text-[12px] mt-1 max-w-xs" style={{ color: 'var(--text-3)' }}>
              {search
                ? 'Tente outro termo ou limpe o filtro.'
                : isRunning
                  ? 'Os envios e respostas aparecerão aqui em tempo real.'
                  : 'Quando a campanha rodar, cada envio e resposta ficará registrado.'}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {filtered.map((log, idx) => (
              <DispatchLogRow
                key={`${log.timestamp}-${log.event}-${idx}`}
                log={log}
                showDate={variant === 'full'}
                onCopyPhone={copyPhone}
              />
            ))}
          </div>
        )}
      </div>

      {variant === 'full' && hasMore && onLoadMore && (
        <div className="flex justify-center pt-1">
          <Button variant="secondary" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Carregando…' : 'Carregar eventos anteriores'}
          </Button>
        </div>
      )}
    </div>
  );
};
