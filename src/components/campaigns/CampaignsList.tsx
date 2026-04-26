import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckSquare,
  ChevronDown,
  Copy,
  FileDown,
  LayoutGrid,
  List,
  Pause,
  Play,
  Rows3,
  Search,
  Smartphone,
  Square,
  Trash2,
  Users
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign, CampaignStatus } from '../../types';
import { getCampaignProgressMetrics } from '../../utils/campaignMetrics';
import { appendAudit } from '../../utils/campaignMissionStorage';
import { Badge, Button, Card, EmptyState, Input, Modal, Tabs } from '../ui';
import { Sparkline, fmtInt } from './CampaignVisuals';

interface CampaignsListProps {
  campaigns: Campaign[];
  onOpenDetails: (id: string) => void;
  onTogglePause: (id: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  onDeleteMany?: (ids: string[]) => Promise<void> | void;
  onClone?: (campaign: Campaign) => void;
}

type StatusFilter = 'ALL' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
type ViewMode = 'cards' | 'compact' | 'table';
type SortKey = 'recent' | 'name' | 'progress' | 'success' | 'volume';

const LS_VIEW = 'zapmass.campaigns.list.view';
const LS_SORT = 'zapmass.campaigns.list.sort';

function downloadCampaignsCsv(rows: Campaign[], filename: string) {
  const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const header = [
    'id',
    'nome',
    'status',
    'total',
    'processados',
    'entregues',
    'falhas',
    'taxa_sucesso',
    'criada',
    'lista'
  ];
  const lines = [
    header.join(','),
    ...rows.map((c) => {
      const m = getCampaignProgressMetrics(c);
      return [
        c.id,
        c.name,
        c.status,
        c.totalContacts,
        m.effectiveProcessed,
        c.successCount,
        c.failedCount,
        `${m.successRatePct}%`,
        c.createdAt,
        c.contactListName || ''
      ]
        .map((x) => esc(String(x)))
        .join(',');
    })
  ].join('\n');
  const blob = new Blob(['\ufeff' + lines], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Sparkline derivada: se houver logs SUCCESS suficientes, bucketa. Caso contrário, sintetiza.
const buildSpark = (camp: Campaign, buckets = 10): number[] => {
  const values = new Array(buckets).fill(0) as number[];
  const successLogs = (camp.logs ?? []).filter((l) => l.type === 'SUCCESS');
  if (successLogs.length >= buckets) {
    const timestamps = successLogs
      .map((l) => new Date(l.timestamp).getTime())
      .sort((a, b) => a - b);
    const start = timestamps[0];
    const end = timestamps[timestamps.length - 1];
    const range = Math.max(1, end - start);
    timestamps.forEach((t) => {
      const idx = Math.min(buckets - 1, Math.floor(((t - start) / range) * buckets));
      values[idx]++;
    });
    return values;
  }
  // Sintético suave baseado em progresso
  const total = camp.successCount;
  if (total === 0) return values;
  for (let i = 0; i < buckets; i++) {
    const t = (i + 1) / buckets;
    values[i] = Math.round((total / buckets) * (1 + 0.35 * Math.sin(i * 0.9) + 0.18 * Math.cos(i * 1.6)));
  }
  return values.map((v) => Math.max(0, v));
};

// ETA em segundos para uma campanha ativa
const etaForCampaign = (camp: Campaign): number | null => {
  if (camp.status !== CampaignStatus.RUNNING) return null;
  const pending = getCampaignProgressMetrics(camp).pending;
  const delay = camp.delaySeconds ?? 30;
  const chips = Math.max(1, camp.selectedConnectionIds.length);
  return (pending * delay) / chips;
};

const formatEta = (seconds: number | null): string => {
  if (seconds === null) return '—';
  if (seconds <= 0) return 'Finalizando';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) return `~${h}h ${m}m`;
  if (m >= 1) return `~${m} min`;
  return `~${Math.max(1, Math.round(seconds))}s`;
};

export const CampaignsList: React.FC<CampaignsListProps> = ({
  campaigns,
  onOpenDetails,
  onTogglePause,
  onDelete,
  onDeleteMany,
  onClone
}) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<{ open: boolean; ids: string[] }>({
    open: false,
    ids: []
  });
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    const v = localStorage.getItem(LS_VIEW) as ViewMode | null;
    return v || 'cards';
  });
  const [sort, setSort] = useState<SortKey>(() => {
    const v = localStorage.getItem(LS_SORT) as SortKey | null;
    return v || 'recent';
  });

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    localStorage.setItem(LS_VIEW, view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem(LS_SORT, sort);
  }, [sort]);

  // Atalho / pra focar busca
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    let list = campaigns;
    if (status !== 'ALL') list = list.filter((c) => c.status === status);
    if (search)
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.contactListName || '').toLowerCase().includes(search.toLowerCase())
      );

    const sortFn = (a: Campaign, b: Campaign) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR');
      if (sort === 'progress') {
        const pa =
          a.totalContacts > 0 ? getCampaignProgressMetrics(a).effectiveProcessed / a.totalContacts : 0;
        const pb =
          b.totalContacts > 0 ? getCampaignProgressMetrics(b).effectiveProcessed / b.totalContacts : 0;
        return pb - pa;
      }
      if (sort === 'success') {
        const ra = getCampaignProgressMetrics(a).successRatePct;
        const rb = getCampaignProgressMetrics(b).successRatePct;
        return rb - ra;
      }
      if (sort === 'volume') return b.totalContacts - a.totalContacts;
      // recent
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    };
    return list.slice().sort(sortFn);
  }, [campaigns, status, search, sort]);

  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
  const someSelected = filtered.some((c) => selectedIds.has(c.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((c) => c.id)));
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const askDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    setConfirmState({ open: true, ids });
  };

  const confirmDelete = async () => {
    const { ids } = confirmState;
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      if (ids.length === 1 && onDelete) await onDelete(ids[0]);
      else if (onDeleteMany) await onDeleteMany(ids);
      else if (onDelete) for (const id of ids) await onDelete(id);
      exitSelection();
    } catch (err) {
      toast.error('Não foi possível remover. Tente novamente.');
      console.error(err);
    } finally {
      setDeleting(false);
      setConfirmState({ open: false, ids: [] });
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0">
            <Input
              ref={searchInputRef}
              placeholder="Buscar por nome ou lista... (pressione /)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>
          <Tabs
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            items={[
              { id: 'ALL', label: `Todas (${campaigns.length})` },
              {
                id: 'RUNNING',
                label: `Ativas (${campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length})`
              },
              {
                id: 'PAUSED',
                label: `Pausadas (${campaigns.filter((c) => c.status === CampaignStatus.PAUSED).length})`
              },
              {
                id: 'COMPLETED',
                label: `Concluídas (${campaigns.filter((c) => c.status === CampaignStatus.COMPLETED).length})`
              }
            ]}
          />
        </div>

        <div
          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl flex-wrap"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 text-[11.5px] font-semibold" style={{ color: 'var(--text-3)' }}>
            {selectionMode ? (
              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
                style={{
                  background: allSelected ? 'rgba(16,185,129,0.14)' : 'transparent',
                  color: allSelected ? 'var(--brand-600)' : 'var(--text-2)'
                }}
              >
                {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
                <span className="tabular-nums">({selectedIds.size})</span>
              </button>
            ) : (
              <>
                <span className="tabular-nums">{filtered.length}</span>
                <span>resultado{filtered.length === 1 ? '' : 's'}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Ordenação */}
            <div
              className="relative inline-flex items-center text-[11.5px] font-semibold rounded-lg overflow-hidden"
              style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
            >
              <label className="pl-2.5 pr-1 py-1" style={{ color: 'var(--text-3)' }}>
                Ordenar
              </label>
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="appearance-none bg-transparent pr-7 pl-1 py-1 focus:outline-none cursor-pointer font-bold"
                  style={{ color: 'var(--text-1)' }}
                >
                  <option value="recent">Mais recentes</option>
                  <option value="name">Nome (A–Z)</option>
                  <option value="progress">Progresso</option>
                  <option value="success">Taxa de sucesso</option>
                  <option value="volume">Volume</option>
                </select>
                <ChevronDown
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                  style={{ color: 'var(--text-3)' }}
                />
              </div>
            </div>

            {/* View toggle */}
            <div
              className="inline-flex rounded-lg overflow-hidden"
              style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
              role="tablist"
            >
              {(
                [
                  { id: 'cards', icon: <LayoutGrid className="w-3.5 h-3.5" />, label: 'Cards' },
                  { id: 'compact', icon: <Rows3 className="w-3.5 h-3.5" />, label: 'Compacto' },
                  { id: 'table', icon: <List className="w-3.5 h-3.5" />, label: 'Tabela' }
                ] as { id: ViewMode; icon: React.ReactNode; label: string }[]
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  title={v.label}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold transition-colors"
                  style={{
                    background: view === v.id ? 'var(--brand-500)' : 'transparent',
                    color: view === v.id ? '#fff' : 'var(--text-2)'
                  }}
                >
                  {v.icon}
                  <span className="hidden sm:inline">{v.label}</span>
                </button>
              ))}
            </div>

            {/* Seleção */}
            {selectionMode ? (
              <>
                {someSelected && (
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                    onClick={() => askDelete(Array.from(selectedIds))}
                  >
                    Excluir ({selectedIds.size})
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={exitSelection}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<CheckSquare className="w-3.5 h-3.5" />}
                onClick={() => setSelectionMode(true)}
              >
                Selecionar
              </Button>
            )}

            {/* Export */}
            <Button
              variant="secondary"
              size="sm"
              type="button"
              leftIcon={<FileDown className="w-3.5 h-3.5" />}
              onClick={() => {
                downloadCampaignsCsv(
                  filtered,
                  `zapmass-campanhas-${new Date().toISOString().slice(0, 10)}.csv`
                );
                appendAudit({
                  action: 'export_csv',
                  label: `Export CSV (${filtered.length} linhas)`
                });
                toast.success('CSV gerado.');
              }}
            >
              Exportar
            </Button>
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
          title="Nenhuma campanha encontrada"
          description="Tente ajustar os filtros ou crie uma nova campanha para começar."
        />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((camp) => (
            <CampaignCardExtended
              key={camp.id}
              campaign={camp}
              selected={selectedIds.has(camp.id)}
              selectionMode={selectionMode}
              onToggleSelect={() => toggleSelect(camp.id)}
              onOpen={() => {
                if (selectionMode) toggleSelect(camp.id);
                else onOpenDetails(camp.id);
              }}
              onTogglePause={() => onTogglePause(camp.id)}
              onClone={onClone ? () => onClone(camp) : undefined}
              onDelete={onDelete ? () => askDelete([camp.id]) : undefined}
            />
          ))}
        </div>
      ) : view === 'compact' ? (
        <div className="space-y-1.5">
          {filtered.map((camp) => (
            <CampaignCompactRow
              key={camp.id}
              campaign={camp}
              selected={selectedIds.has(camp.id)}
              selectionMode={selectionMode}
              onToggleSelect={() => toggleSelect(camp.id)}
              onOpen={() => {
                if (selectionMode) toggleSelect(camp.id);
                else onOpenDetails(camp.id);
              }}
              onTogglePause={() => onTogglePause(camp.id)}
              onClone={onClone ? () => onClone(camp) : undefined}
              onDelete={onDelete ? () => askDelete([camp.id]) : undefined}
            />
          ))}
        </div>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr
                  className="uppercase font-bold tracking-wider"
                  style={{
                    color: 'var(--text-3)',
                    background: 'var(--surface-1)',
                    borderBottom: '1px solid var(--border-subtle)'
                  }}
                >
                  <th className="px-3 py-2.5 text-[10px]">Campanha</th>
                  <th className="px-3 py-2.5 text-[10px]">Status</th>
                  <th className="px-3 py-2.5 text-[10px] text-right">Progresso</th>
                  <th className="px-3 py-2.5 text-[10px] text-right">Entregues</th>
                  <th className="px-3 py-2.5 text-[10px] text-right">Falhas</th>
                  <th className="px-3 py-2.5 text-[10px] text-right">Sucesso</th>
                  <th className="px-3 py-2.5 text-[10px] text-right">ETA</th>
                  <th className="px-3 py-2.5 text-[10px]"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((camp) => {
                  const m = getCampaignProgressMetrics(camp);
                  const progress = m.progressPct;
                  const rate = m.successRatePct;
                  const isRunning = camp.status === CampaignStatus.RUNNING;
                  const isPaused = camp.status === CampaignStatus.PAUSED;
                  const isDone = camp.status === CampaignStatus.COMPLETED;
                  const eta = etaForCampaign(camp);
                  return (
                    <tr
                      key={camp.id}
                      className="transition-colors hover:bg-[var(--surface-1)] cursor-pointer"
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      onClick={() => onOpenDetails(camp.id)}
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-bold truncate max-w-[280px]" style={{ color: 'var(--text-1)' }}>
                          {camp.name}
                        </p>
                        <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                          {camp.contactListName || 'Manual'} · {fmtInt(camp.totalContacts)} contatos
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant={isRunning ? 'success' : isPaused ? 'warning' : isDone ? 'info' : 'neutral'}
                          dot={isRunning}
                        >
                          {isRunning ? 'Ativa' : isPaused ? 'Pausada' : isDone ? 'Concluída' : 'Pendente'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="tabular-nums font-bold" style={{ color: 'var(--text-1)' }}>
                          {progress}%
                        </span>
                      </td>
                      <td
                        className="px-3 py-2.5 text-right tabular-nums font-bold"
                        style={{ color: '#059669' }}
                      >
                        {fmtInt(camp.successCount)}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right tabular-nums font-bold"
                        style={{ color: '#dc2626' }}
                      >
                        {fmtInt(camp.failedCount)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className="tabular-nums font-bold px-1.5 py-0.5 rounded-md"
                          style={{
                            background:
                              rate >= 85
                                ? 'rgba(16,185,129,0.12)'
                                : rate >= 60
                                ? 'rgba(245,158,11,0.12)'
                                : 'rgba(239,68,68,0.12)',
                            color: rate >= 85 ? '#059669' : rate >= 60 ? '#d97706' : '#dc2626'
                          }}
                        >
                          {rate}%
                        </span>
                      </td>
                      <td
                        className="px-3 py-2.5 text-right tabular-nums"
                        style={{ color: 'var(--text-3)' }}
                      >
                        {formatEta(eta)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {!isDone && (
                            <button
                              type="button"
                              onClick={() => onTogglePause(camp.id)}
                              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-2)]"
                              style={{ color: isRunning ? '#d97706' : 'var(--brand-600)' }}
                              title={isRunning ? 'Pausar' : 'Retomar'}
                            >
                              {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {onClone && (
                            <button
                              type="button"
                              onClick={() => onClone(camp)}
                              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-2)]"
                              style={{ color: '#2563eb' }}
                              title="Clonar"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onDelete && (
                            <button
                              type="button"
                              onClick={() => askDelete([camp.id])}
                              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-2)]"
                              style={{ color: 'var(--danger)' }}
                              title="Excluir"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal confirmar deleção */}
      {confirmState.open && (
        <Modal
          isOpen={confirmState.open}
          onClose={() => !deleting && setConfirmState({ open: false, ids: [] })}
          title="Excluir campanha"
          icon={<Trash2 className="w-5 h-5" style={{ color: 'var(--danger)' }} />}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
              {confirmState.ids.length === 1
                ? 'Tem certeza que deseja excluir esta campanha? Esta ação não pode ser desfeita.'
                : `Tem certeza que deseja excluir ${confirmState.ids.length} campanhas? Esta ação não pode ser desfeita.`}
            </p>
            <div
              className="rounded-lg px-3 py-2 text-[12px]"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: 'var(--danger)'
              }}
            >
              Campanhas em execução serão pausadas antes da remoção.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmState({ open: false, ids: [] })}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Excluindo...' : 'Excluir'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ─── Card estendido (view=cards) ───
const CampaignCardExtended: React.FC<{
  campaign: Campaign;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onTogglePause: () => void;
  onClone?: () => void;
  onDelete?: () => void;
}> = ({ campaign, selected, selectionMode, onToggleSelect, onOpen, onTogglePause, onClone, onDelete }) => {
  const m = getCampaignProgressMetrics(campaign);
  const progress = m.progressPct;
  const rate = m.successRatePct;
  const isRunning = campaign.status === CampaignStatus.RUNNING;
  const isPaused = campaign.status === CampaignStatus.PAUSED;
  const isDone = campaign.status === CampaignStatus.COMPLETED;
  const spark = useMemo(() => buildSpark(campaign), [campaign]);
  const eta = etaForCampaign(campaign);

  const accent = isRunning
    ? 'var(--brand-500)'
    : isPaused
    ? '#f59e0b'
    : isDone
    ? '#3b82f6'
    : '#94a3b8';

  const pending = m.pending;

  return (
    <div
      onClick={onOpen}
      className="relative rounded-2xl p-3.5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        background: 'var(--surface-0)',
        border: selected
          ? `1px solid ${accent}`
          : '1px solid var(--border-subtle)',
        boxShadow: selected ? `0 0 0 2px ${accent}40, 0 6px 16px -8px ${accent}66` : undefined
      }}
    >
      {/* Faixa superior de status */}
      <div
        className="absolute top-0 left-3 right-3 h-[3px] rounded-full"
        style={{
          background: isRunning
            ? `linear-gradient(90deg, ${accent}, #34d399)`
            : accent
        }}
      />

      {/* Header */}
      <div className="flex items-start gap-2.5 mb-3">
        {selectionMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-all"
            style={{
              background: selected ? accent : 'transparent',
              border: selected ? `1.5px solid ${accent}` : '1.5px solid var(--border-strong)',
              color: '#fff'
            }}
          >
            {selected && <CheckSquare className="w-3 h-3" />}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="text-[14.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
              {campaign.name}
            </h3>
          </div>
          <div
            className="flex items-center gap-2 text-[10.5px] flex-wrap"
            style={{ color: 'var(--text-3)' }}
          >
            <Badge
              variant={isRunning ? 'success' : isPaused ? 'warning' : isDone ? 'info' : 'neutral'}
              dot={isRunning}
            >
              {isRunning ? 'Executando' : isPaused ? 'Pausada' : isDone ? 'Concluída' : 'Pendente'}
            </Badge>
            <span className="flex items-center gap-1">
              <Smartphone className="w-3 h-3" />
              {campaign.selectedConnectionIds.length}
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {fmtInt(campaign.totalContacts)}
            </span>
            <span>·</span>
            <span>{campaign.contactListName || 'Manual'}</span>
          </div>
        </div>

        {!selectionMode && (
          <div
            className="flex items-center gap-1 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            {!isDone && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePause();
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                style={{
                  background: isRunning ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.12)',
                  color: isRunning ? '#d97706' : 'var(--brand-600)'
                }}
                title={isRunning ? 'Pausar' : 'Retomar'}
              >
                {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            )}
            {onClone && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClone();
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}
                title="Clonar"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}
                title="Excluir"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div
        className="grid grid-cols-4 gap-1.5 mb-2.5 rounded-lg p-1.5"
        style={{ background: 'var(--surface-1)' }}
      >
        <Metric label="Entregues" value={fmtInt(campaign.successCount)} tone="#059669" />
        <Metric label="Falhas" value={fmtInt(campaign.failedCount)} tone="#dc2626" />
        <Metric label="Pendentes" value={fmtInt(pending)} tone="#6b7280" />
        <Metric label="Sucesso" value={`${rate}%`} tone={rate >= 85 ? '#059669' : rate >= 60 ? '#d97706' : '#dc2626'} />
      </div>

      {/* Progresso + sparkline */}
      <div className="flex items-end justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span
              className="text-[9.5px] font-extrabold uppercase tracking-[0.14em]"
              style={{ color: 'var(--text-3)' }}
            >
              Progresso
            </span>
            <span className="text-[12px] font-black tabular-nums" style={{ color: accent }}>
              {progress}%
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: isRunning
                  ? `linear-gradient(90deg, ${accent}, #34d399)`
                  : accent
              }}
            />
          </div>
        </div>
        <div className="shrink-0 opacity-80">
          <Sparkline
            values={spark}
            width={70}
            height={28}
            stroke={accent}
            fill={`${accent}22`}
            showDot={isRunning}
          />
        </div>
      </div>

      {/* Rodapé: ETA / criado em */}
      <div
        className="flex items-center justify-between text-[10.5px]"
        style={{ color: 'var(--text-3)' }}
      >
        <span className="tabular-nums">
          {new Date(campaign.createdAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
          })}
        </span>
        {isRunning && eta !== null && (
          <span
            className="inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-md"
            style={{
              background: 'rgba(16,185,129,0.1)',
              color: 'var(--brand-600)',
              border: '1px solid rgba(16,185,129,0.25)'
            }}
          >
            ETA {formatEta(eta)}
          </span>
        )}
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <div className="rounded-md px-1.5 py-1 text-center" style={{ background: 'var(--surface-0)' }}>
    <p className="text-[13px] font-black tabular-nums leading-none" style={{ color: tone }}>
      {value}
    </p>
    <p
      className="text-[8.5px] font-bold uppercase tracking-wider leading-none mt-1"
      style={{ color: 'var(--text-3)' }}
    >
      {label}
    </p>
  </div>
);

// ─── Linha compacta (view=compact) ───
const CampaignCompactRow: React.FC<{
  campaign: Campaign;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onTogglePause: () => void;
  onClone?: () => void;
  onDelete?: () => void;
}> = ({ campaign, selected, selectionMode, onToggleSelect, onOpen, onTogglePause, onClone, onDelete }) => {
  const m = getCampaignProgressMetrics(campaign);
  const progress = m.progressPct;
  const rate = m.successRatePct;
  const isRunning = campaign.status === CampaignStatus.RUNNING;
  const isPaused = campaign.status === CampaignStatus.PAUSED;
  const isDone = campaign.status === CampaignStatus.COMPLETED;
  const accent = isRunning
    ? 'var(--brand-500)'
    : isPaused
    ? '#f59e0b'
    : isDone
    ? '#3b82f6'
    : '#94a3b8';
  const spark = useMemo(() => buildSpark(campaign, 8), [campaign]);
  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all hover:bg-[var(--surface-1)]"
      style={{
        background: selected ? `${accent}12` : 'var(--surface-0)',
        border: `1px solid ${selected ? accent : 'var(--border-subtle)'}`
      }}
    >
      {selectionMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
          style={{
            background: selected ? accent : 'transparent',
            border: selected ? `1.5px solid ${accent}` : '1.5px solid var(--border-strong)',
            color: '#fff'
          }}
        >
          {selected && <CheckSquare className="w-2.5 h-2.5" />}
        </button>
      )}
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
          {campaign.name}
        </p>
        <p className="text-[10.5px] tabular-nums" style={{ color: 'var(--text-3)' }}>
          {fmtInt(m.effectiveProcessed)}/{fmtInt(campaign.totalContacts)} · {rate}% sucesso
        </p>
      </div>
      <div className="hidden sm:block opacity-75">
        <Sparkline values={spark} width={50} height={18} stroke={accent} fill={`${accent}22`} showDot={false} />
      </div>
      <div className="w-[80px] shrink-0">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full transition-all duration-500" style={{ width: `${progress}%`, background: accent }} />
        </div>
        <p
          className="text-[10px] tabular-nums font-bold text-right mt-0.5"
          style={{ color: accent }}
        >
          {progress}%
        </p>
      </div>
      {!selectionMode && (
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isDone && (
            <button
              type="button"
              onClick={onTogglePause}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: isRunning ? '#d97706' : 'var(--brand-600)' }}
              title={isRunning ? 'Pausar' : 'Retomar'}
            >
              {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
          )}
          {onClone && (
            <button
              type="button"
              onClick={onClone}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: '#2563eb' }}
              title="Clonar"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: 'var(--danger)' }}
              title="Excluir"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <ArrowRight className="w-3.5 h-3.5 ml-1" style={{ color: 'var(--text-3)' }} />
        </div>
      )}
    </div>
  );
};
