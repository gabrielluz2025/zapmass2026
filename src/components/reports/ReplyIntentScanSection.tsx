import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Download,
  ExternalLink,
  Flame,
  Loader2,
  RefreshCw,
  ScanSearch,
  Snowflake,
  Sparkles,
  Square,
  Sun,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppView } from '../../context/AppViewContext';
import {
  applyLeadClassification,
  applyLeadClassificationBatch,
  downloadReplyIntentScanCsv,
  fetchAllReplyIntentScanItems,
  replyIntentScanToApplyPayload,
  scanReplyIntents,
  type LeadClassification,
  type ReplyIntentScanItem,
  type ReplyIntentScanSummary,
} from '../../services/replyIntentApi';
import { openChatByConversationIdNavigate } from '../../utils/openChatByConversationIdNav';
import { Button } from '../ui';

const CLASS_LABEL: Record<LeadClassification, string> = {
  hot: 'Quente',
  warm: 'Morno',
  cold: 'Frio',
  blacklist: 'Lista negra',
};

const INTENT_COLOR: Record<string, string> = {
  opt_in: '#22c55e',
  opt_out: '#ef4444',
  polite_ack: '#eab308',
  flow_match: '#22c55e',
  flow_invalid: '#f97316',
  neutral: '#94a3b8',
  no_inbound: '#64748b',
};

const BATCH_SIZE = 50;

type IntentFilter = '' | 'opt_in' | 'opt_out' | 'flow_match' | 'neutral' | 'no_inbound';

type ScanFilters = {
  onlyWithInbound: boolean;
  excludeWarmup: boolean;
  intentFilter: IntentFilter;
  debouncedSearch: string;
};

function fmtWhen(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SummaryPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-center min-w-[72px]"
      style={{ background: `${color}14`, border: `1px solid ${color}33` }}
    >
      <p className="text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
    </div>
  );
}

async function applySuggestedInChunks(rows: ReplyIntentScanItem[]): Promise<{
  applied: number;
  skipped: number;
}> {
  let applied = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const result = await applyLeadClassificationBatch(chunk.map(replyIntentScanToApplyPayload));
    applied += result.applied;
    skipped += result.skipped;
  }
  return { applied, skipped };
}

export const ReplyIntentScanSection: React.FC = () => {
  const { setCurrentView } = useAppView();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [items, setItems] = useState<ReplyIntentScanItem[]>([]);
  const [summary, setSummary] = useState<ReplyIntentScanSummary | null>(null);
  const [startIndex, setStartIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [excludeWarmup, setExcludeWarmup] = useState(true);
  const [onlyWithInbound, setOnlyWithInbound] = useState(true);
  const [intentFilter, setIntentFilter] = useState<IntentFilter>('');
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filters: ScanFilters = useMemo(
    () => ({ onlyWithInbound, excludeWarmup, intentFilter, debouncedSearch }),
    [onlyWithInbound, excludeWarmup, intentFilter, debouncedSearch]
  );

  const scanParams = useMemo(
    () => ({
      onlyWithInbound: filters.onlyWithInbound,
      excludeWarmup: filters.excludeWarmup,
      intentKind: filters.intentFilter || undefined,
      search: filters.debouncedSearch || undefined,
    }),
    [filters]
  );

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [onlyWithInbound, excludeWarmup, intentFilter, debouncedSearch]);

  const runScan = useCallback(
    async (append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const result = await scanReplyIntents({
          startIndex: append ? startIndex : 0,
          limit: 50,
          ...scanParams,
        });
        setSummary(result.summary);
        setHasMore(result.hasMore);
        setStartIndex(result.nextStartIndex);
        setTotalCandidates(result.totalCandidates);
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        if (!append && result.items.length === 0) {
          toast('Nenhuma conversa encontrada com os filtros atuais.', { icon: 'ℹ️' });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao analisar conversas.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [startIndex, scanParams]
  );

  useEffect(() => {
    void runScan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when filters change
  }, [onlyWithInbound, excludeWarmup, intentFilter, debouncedSearch]);

  const applyClass = async (row: ReplyIntentScanItem, classification: LeadClassification) => {
    if (!row.contactId && !row.phoneDigits) {
      toast.error('Contato não encontrado no CRM — abra o chat para vincular.');
      return;
    }
    setApplyingId(`${row.conversationId}:${classification}`);
    try {
      await applyLeadClassification({
        contactId: row.contactId || undefined,
        phoneDigits: row.phoneDigits,
        connectionId: row.connectionId,
        classification,
        replyText: row.lastInboundText || undefined,
        reprocessFlow: classification === 'hot' || classification === 'warm',
        incomingConvId: row.conversationId,
      });
      toast.success(`${row.contactName}: ${CLASS_LABEL[classification]}`);
      setItems((prev) =>
        prev.map((it) =>
          it.conversationId === row.conversationId
            ? {
                ...it,
                marketingOptIn: classification === 'hot',
                marketingOptOut: classification === 'blacklist',
              }
            : it
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível aplicar.');
    } finally {
      setApplyingId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = items.length > 0 && items.every((r) => selectedIds.has(r.conversationId));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(items.map((r) => r.conversationId)));
  };

  const selectedRows = useMemo(
    () => items.filter((r) => selectedIds.has(r.conversationId)),
    [items, selectedIds]
  );

  const applySuggestedBulk = async (rows: ReplyIntentScanItem[], label: string) => {
    if (rows.length === 0) {
      toast.error('Nenhuma conversa selecionada.');
      return;
    }
    const ok = window.confirm(
      `Aplicar a sugestão automática em ${rows.length} contato(s) (${label})?\n\nQuente, morno, frio ou lista negra conforme a análise de cada resposta.`
    );
    if (!ok) return;

    setBulkApplying(true);
    try {
      const { applied, skipped } = await applySuggestedInChunks(rows);
      if (applied > 0) {
        toast.success(`${applied} classificação(ões) aplicada(s).`);
      }
      if (skipped > 0) {
        toast(`${skipped} contato(s) ignorado(s) — sem cadastro no CRM.`, { icon: '⚠️' });
      }
      setSelectedIds(new Set());
      void runScan(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na classificação em lote.');
    } finally {
      setBulkApplying(false);
    }
  };

  const exportCsv = async (scope: 'visible' | 'all') => {
    setExporting(true);
    try {
      const rows =
        scope === 'visible'
          ? items
          : await fetchAllReplyIntentScanItems(scanParams);
      if (rows.length === 0) {
        toast.error('Nada para exportar.');
        return;
      }
      downloadReplyIntentScanCsv(rows);
      toast.success(`CSV com ${rows.length} linha(s) baixado.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao exportar CSV.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ScanSearch className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
                Análise de intenção em massa
              </h2>
            </div>
            <p className="text-[12.5px] max-w-2xl" style={{ color: 'var(--text-3)' }}>
              Varre todas as conversas do workspace, classifica a última resposta do contato e
              sugere quente, morno, frio ou lista negra. Exporte CSV ou aplique sugestões em lote.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={exporting || items.length === 0}
              leftIcon={exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              onClick={() => void exportCsv('visible')}
            >
              CSV visível
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={exporting}
              leftIcon={exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              onClick={() => void exportCsv('all')}
            >
              CSV completo
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void runScan(false)}
              disabled={loading}
            >
              Atualizar
            </Button>
          </div>
        </div>

        {summary && (
          <div className="flex flex-wrap gap-2 mb-4">
            <SummaryPill label="Conversas" value={summary.total} color="#6366f1" />
            <SummaryPill label="Com resposta" value={summary.withInbound} color="#3b82f6" />
            <SummaryPill label="Quentes" value={summary.hot} color="#f97316" />
            <SummaryPill label="Neutras" value={summary.neutral} color="#94a3b8" />
            <SummaryPill label="Lista negra" value={summary.blacklist} color="#ef4444" />
            {excludeWarmup && (
              <SummaryPill label="Só aquecimento" value={summary.warmupOnly} color="#64748b" />
            )}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-2 lg:items-center mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome ou telefone…"
            className="flex-1 rounded-xl px-3 py-2 text-sm min-w-0"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-1)',
            }}
          />
          <select
            value={intentFilter}
            onChange={(e) => setIntentFilter(e.target.value as IntentFilter)}
            className="rounded-xl px-3 py-2 text-sm"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-1)',
            }}
          >
            <option value="">Todas as intenções</option>
            <option value="opt_in">Interesse (quero/sim)</option>
            <option value="flow_match">Fluxo reconhecido</option>
            <option value="opt_out">Pediu sair</option>
            <option value="neutral">Neutras / cortesia</option>
            <option value="no_inbound">Sem resposta</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-3 text-[12px]" style={{ color: 'var(--text-2)' }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithInbound}
              onChange={(e) => setOnlyWithInbound(e.target.checked)}
            />
            Só conversas com resposta inbound
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeWarmup}
              onChange={(e) => setExcludeWarmup(e.target.checked)}
            />
            Ocultar threads de aquecimento
          </label>
        </div>
      </div>

      {items.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium"
            style={{ color: 'var(--text-2)' }}
            onClick={toggleSelectAllVisible}
          >
            {allVisibleSelected ? (
              <CheckSquare className="w-4 h-4 text-emerald-400" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {selectedIds.size > 0 ? `${selectedIds.size} selecionado(s)` : 'Selecionar visíveis'}
          </button>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button
              variant="primary"
              size="sm"
              disabled={bulkApplying || selectedRows.length === 0}
              leftIcon={
                bulkApplying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )
              }
              onClick={() => void applySuggestedBulk(selectedRows, 'selecionados')}
            >
              Aplicar sugestão nos selecionados
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkApplying || loading}
              leftIcon={
                bulkApplying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )
              }
              onClick={() => {
                void (async () => {
                  const ok = window.confirm(
                    'Aplicar a sugestão automática em TODAS as conversas do filtro atual?\n\nPode levar alguns minutos se houver muitos contatos.'
                  );
                  if (!ok) return;
                  setBulkApplying(true);
                  try {
                    const all = await fetchAllReplyIntentScanItems(scanParams);
                    if (all.length === 0) {
                      toast.error('Nenhuma conversa para aplicar.');
                      return;
                    }
                    const { applied, skipped } = await applySuggestedInChunks(all);
                    if (applied > 0) toast.success(`${applied} classificação(ões) aplicada(s).`);
                    if (skipped > 0) {
                      toast(`${skipped} contato(s) ignorado(s) — sem cadastro no CRM.`, { icon: '⚠️' });
                    }
                    setSelectedIds(new Set());
                    void runScan(false);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Falha na classificação em lote.');
                  } finally {
                    setBulkApplying(false);
                  }
                })();
              }}
            >
              Aplicar sugestão em todas (filtro)
            </Button>
          </div>
        </div>
      )}

      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-0)' }}
      >
        <div
          className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide flex justify-between"
          style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span>
            {loading ? 'Analisando…' : `${items.length} linha(s) · ${totalCandidates} conversas no workspace`}
          </span>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--text-3)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
            Varrendo conversas…
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm" style={{ color: 'var(--text-3)' }}>
            Nenhuma conversa corresponde aos filtros.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {items.map((row) => {
              const selected = selectedIds.has(row.conversationId);
              return (
                <li
                  key={row.conversationId}
                  className="px-4 py-3 hover:bg-white/[0.02]"
                  style={selected ? { background: 'rgba(16,185,129,0.04)' } : undefined}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                    <button
                      type="button"
                      className="mt-0.5 shrink-0"
                      onClick={() => toggleSelect(row.conversationId)}
                      aria-label={selected ? 'Desmarcar' : 'Selecionar'}
                    >
                      {selected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {row.contactName}
                        </p>
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full border"
                          style={{
                            borderColor: `${INTENT_COLOR[row.intentKind] || '#94a3b8'}44`,
                            color: INTENT_COLOR[row.intentKind] || '#94a3b8',
                          }}
                        >
                          Sugestão: {CLASS_LABEL[row.suggestedLeadClass]}
                        </span>
                        {row.warmupThread && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Aquecimento
                          </span>
                        )}
                        {row.hasActiveSession && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Fluxo ativo
                          </span>
                        )}
                        {row.marketingOptOut && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                            Opt-out
                          </span>
                        )}
                      </div>
                      {row.lastInboundText ? (
                        <p
                          className="text-[13px] truncate"
                          style={{ color: 'var(--text-2)' }}
                          title={row.lastInboundText}
                        >
                          «{row.lastInboundText}»
                        </p>
                      ) : (
                        <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                          Sem mensagem inbound
                        </p>
                      )}
                      <p
                        className="text-xs mt-1 font-medium"
                        style={{ color: INTENT_COLOR[row.intentKind] || '#94a3b8' }}
                      >
                        {row.intentLabel}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {fmtWhen(row.lastInboundAt)}
                        {row.campaignName ? ` · ${row.campaignName}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        className="p-2 rounded-lg border border-white/10 hover:bg-white/5"
                        title="Abrir no bate-papo"
                        onClick={() => openChatByConversationIdNavigate(setCurrentView, row.conversationId)}
                      >
                        <ExternalLink className="w-4 h-4" style={{ color: 'var(--text-2)' }} />
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(applyingId) || bulkApplying}
                        title={`Aplicar sugestão (${CLASS_LABEL[row.suggestedLeadClass]})`}
                        onClick={() => void applyClass(row, row.suggestedLeadClass)}
                        className="p-2 rounded-lg border hover:bg-white/5 disabled:opacity-40"
                        style={{ borderColor: '#10b98144' }}
                      >
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                      </button>
                      {(
                        [
                          { id: 'hot' as const, icon: Flame, color: '#f97316' },
                          { id: 'warm' as const, icon: Sun, color: '#eab308' },
                          { id: 'cold' as const, icon: Snowflake, color: '#38bdf8' },
                          { id: 'blacklist' as const, icon: XCircle, color: '#ef4444' },
                        ] as const
                      ).map(({ id, icon: Icon, color }) => {
                        const busy = applyingId === `${row.conversationId}:${id}`;
                        return (
                          <button
                            key={id}
                            type="button"
                            disabled={Boolean(applyingId) || bulkApplying}
                            title={CLASS_LABEL[id]}
                            onClick={() => void applyClass(row, id)}
                            className="p-2 rounded-lg border hover:bg-white/5 disabled:opacity-40"
                            style={{ borderColor: `${color}44` }}
                          >
                            {busy ? (
                              <Loader2 className="w-4 h-4 animate-spin" style={{ color }} />
                            ) : (
                              <Icon className="w-4 h-4" style={{ color }} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <div className="p-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={loadingMore}
              leftIcon={loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
              onClick={() => void runScan(true)}
            >
              Carregar mais
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReplyIntentScanSection;
