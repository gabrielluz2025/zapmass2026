import React, { useMemo, useState } from 'react';
import { CheckSquare, Copy, FileDown, Pause, Play, Search, Smartphone, Square, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign, CampaignStatus } from '../../types';
import { appendAudit } from '../../utils/campaignMissionStorage';
import { Badge, Button, Card, EmptyState, Input, Modal, Tabs } from '../ui';

interface CampaignsListProps {
  campaigns: Campaign[];
  onOpenDetails: (id: string) => void;
  onTogglePause: (id: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  onDeleteMany?: (ids: string[]) => Promise<void> | void;
  /** Abre o assistente com mensagem/chips copiados; o público deve ser escolhido de novo. */
  onClone?: (campaign: Campaign) => void;
}

type StatusFilter = 'ALL' | 'RUNNING' | 'PAUSED' | 'COMPLETED';

function downloadCampaignsCsv(rows: Campaign[], filename: string) {
  const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'nome', 'status', 'total', 'processados', 'entregues', 'falhas', 'criada', 'lista'];
  const lines = [
    header.join(','),
    ...rows.map((c) =>
      [
        c.id,
        c.name,
        c.status,
        c.totalContacts,
        c.processedCount,
        c.successCount,
        c.failedCount,
        c.createdAt,
        c.contactListName || ''
      ]
        .map((x) => esc(String(x)))
        .join(',')
    )
  ].join('\n');
  const blob = new Blob(['\ufeff' + lines], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

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
  const [confirmState, setConfirmState] = useState<{ open: boolean; ids: string[] }>({ open: false, ids: [] });
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    let list = campaigns;
    if (status !== 'ALL') list = list.filter((c) => c.status === status);
    if (search) list = list.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [campaigns, status, search]);

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
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
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
      if (ids.length === 1 && onDelete) {
        await onDelete(ids[0]);
      } else if (onDeleteMany) {
        await onDeleteMany(ids);
      } else if (onDelete) {
        for (const id of ids) await onDelete(id);
      }
      exitSelection();
    } catch (err) {
      toast.error('Nao foi possivel remover. Tente novamente.');
      console.error(err);
    } finally {
      setDeleting(false);
      setConfirmState({ open: false, ids: [] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Buscar campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <Tabs
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          items={[
            { id: 'ALL', label: 'Todas' },
            { id: 'RUNNING', label: 'Ativas' },
            { id: 'PAUSED', label: 'Pausadas' },
            { id: 'COMPLETED', label: 'Concluidas' }
          ]}
        />
      </div>

      {/* Selection toolbar */}
      {campaigns.length > 0 && (
        <div
          className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {selectionMode ? (
              <>
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
                  style={{
                    background: allSelected ? 'var(--brand-50)' : 'transparent',
                    color: allSelected ? 'var(--brand-700)' : 'var(--text-2)'
                  }}
                >
                  {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
                <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  {selectedIds.size} selecionada{selectedIds.size === 1 ? '' : 's'}
                </span>
              </>
            ) : (
              <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {filtered.length} campanha{filtered.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectionMode && someSelected && (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => askDelete(Array.from(selectedIds))}
              >
                Excluir ({selectedIds.size})
              </Button>
            )}
            {selectionMode ? (
              <Button variant="ghost" size="sm" onClick={exitSelection}>
                Cancelar
              </Button>
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
            <Button
              variant="secondary"
              size="sm"
              type="button"
              leftIcon={<FileDown className="w-3.5 h-3.5" />}
              onClick={() => {
                downloadCampaignsCsv(filtered, `zapmass-campanhas-${new Date().toISOString().slice(0, 10)}.csv`);
                appendAudit({
                  action: 'export_csv',
                  label: `Export CSV (${filtered.length} linhas)`
                });
                toast.success('CSV gerado.');
              }}
            >
              Exportar CSV
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
          title="Nenhuma campanha encontrada"
          description="Tente ajustar os filtros ou crie uma nova campanha para comecar."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((camp) => {
            const progress =
              camp.totalContacts > 0 ? Math.round((camp.processedCount / camp.totalContacts) * 100) : 0;
            const successRate =
              camp.processedCount > 0 ? Math.round((camp.successCount / camp.processedCount) * 100) : 0;
            const isRunning = camp.status === CampaignStatus.RUNNING;
            const isPaused = camp.status === CampaignStatus.PAUSED;
            const isDone = camp.status === CampaignStatus.COMPLETED;
            const isSelected = selectedIds.has(camp.id);
            const statusVariant: 'success' | 'warning' | 'info' | 'neutral' = isRunning
              ? 'success'
              : isPaused
              ? 'warning'
              : isDone
              ? 'info'
              : 'neutral';
            const accent = isRunning
              ? 'var(--brand-500)'
              : isPaused
              ? '#f59e0b'
              : isDone
              ? '#3b82f6'
              : 'var(--text-3)';

            return (
              <Card
                key={camp.id}
                onClick={() => {
                  if (selectionMode) {
                    toggleSelect(camp.id);
                  } else {
                    onOpenDetails(camp.id);
                  }
                }}
                className="cursor-pointer hover:-translate-y-0.5 transition-transform"
                style={
                  isSelected
                    ? { borderColor: 'rgba(16,185,129,0.4)', boxShadow: '0 0 0 1px rgba(16,185,129,0.25)' }
                    : undefined
                }
              >
                <div className="h-[3px] rounded-full mb-3 -mx-4 -mt-4" style={{ background: accent }} />
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {selectionMode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(camp.id);
                        }}
                        className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                        style={{
                          background: isSelected ? 'var(--brand-500)' : 'transparent',
                          border: isSelected ? '1.5px solid var(--brand-500)' : '1.5px solid var(--border-strong)',
                          color: '#fff'
                        }}
                        aria-label={isSelected ? 'Desmarcar' : 'Selecionar'}
                      >
                        {isSelected && <CheckSquare className="w-3 h-3" />}
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-[15px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {camp.name}
                        </h3>
                        <Badge variant={statusVariant} dot={isRunning}>
                          {isRunning ? 'Executando' : isPaused ? 'Pausada' : isDone ? 'Concluida' : 'Pendente'}
                        </Badge>
                      </div>
                      <div
                        className="flex items-center gap-2 text-[11.5px] flex-wrap"
                        style={{ color: 'var(--text-3)' }}
                      >
                        <span className="flex items-center gap-1">
                          <Smartphone className="w-3 h-3" />
                          {camp.selectedConnectionIds.length} chip
                          {camp.selectedConnectionIds.length > 1 ? 's' : ''}
                        </span>
                        <span>·</span>
                        <span>{camp.contactListName || 'Manual'}</span>
                        <span>·</span>
                        <span>{camp.createdAt}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1.5 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    {!isDone && !selectionMode && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onTogglePause(camp.id);
                        }}
                        className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                        style={{
                          background: isRunning ? 'rgba(245,158,11,0.12)' : 'var(--brand-50)',
                          color: isRunning ? '#f59e0b' : 'var(--brand-600)'
                        }}
                        title={isRunning ? 'Pausar' : 'Retomar'}
                      >
                        {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                    )}
                    {!selectionMode && onClone && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onClone(camp);
                        }}
                        className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                        style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}
                        title="Clonar como novo rascunho"
                        aria-label="Clonar campanha"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                    {!selectionMode && onDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          askDelete([camp.id]);
                        }}
                        className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                        style={{ background: 'rgba(239,68,68,0.10)', color: 'var(--danger)' }}
                        title="Excluir campanha"
                        aria-label="Excluir campanha"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-[11.5px] mb-1.5" style={{ color: 'var(--text-3)' }}>
                    <span>
                      {camp.processedCount.toLocaleString()} de {camp.totalContacts.toLocaleString()}
                    </span>
                    <span className="font-semibold tabular-nums" style={{ color: accent }}>
                      {progress}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${progress}%`, background: accent }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[12px] flex-wrap">
                  <span style={{ color: 'var(--brand-600)' }}>
                    <strong className="tabular-nums">{camp.successCount.toLocaleString()}</strong> entregues
                  </span>
                  <span style={{ color: 'var(--danger)' }}>
                    <strong className="tabular-nums">{camp.failedCount.toLocaleString()}</strong> falhas
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>
                    <strong className="tabular-nums">
                      {(camp.totalContacts - camp.processedCount).toLocaleString()}
                    </strong>{' '}
                    pendentes
                  </span>
                  {camp.processedCount > 0 && (
                    <span
                      className="ml-auto font-semibold tabular-nums"
                      style={{ color: successRate >= 85 ? 'var(--brand-600)' : '#f59e0b' }}
                    >
                      {successRate}% sucesso
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
                ? 'Tem certeza que deseja excluir esta campanha? Esta acao nao pode ser desfeita.'
                : `Tem certeza que deseja excluir ${confirmState.ids.length} campanhas? Esta acao nao pode ser desfeita.`}
            </p>
            <div
              className="rounded-lg px-3 py-2 text-[12px]"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: 'var(--danger)'
              }}
            >
              Campanhas em execucao serao pausadas antes da remocao.
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
