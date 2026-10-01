import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Layers,
  Loader2,
  RefreshCw,
  Trash2,
  Zap,
  FastForward,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  buildQueueRemoveConfirmPhrase,
  runtimeCampaignConfirmShortId,
} from '../../../shared/campaignQueueTenantHelpers';
import { useZapMassCore } from '../../context/ZapMassContext';
import { ConnectionStatus } from '../../types';
import { DISPATCH_QUEUE_TAB_INTRO } from '../../utils/campaignQueueMetricCopy';
import {
  apiInspectDispatchQueue,
  apiPromoteDelayedQueue,
  apiPurgeDeadChannelQueue,
  apiPurgeRuntimeCampaign,
  apiPurgeRuntimeOrphans,
  apiRemoveDispatchQueue,
  apiSetCampaignQueuePriority,
  type QueueChannelSummary,
  type QueueInspectGroup,
  type QueueRuntimeCampaign,
} from '../../services/campaignQueueApi';
import { Button } from '../ui/Button';

function stateSummary(byState: QueueInspectGroup['byState']): string {
  const parts: string[] = [];
  if (byState.waiting) parts.push(`${byState.waiting} aguard.`);
  if (byState.delayed) parts.push(`${byState.delayed} atras.`);
  if (byState.active) parts.push(`${byState.active} ativo`);
  if (byState.paused) parts.push(`${byState.paused} paus.`);
  return parts.join(' · ') || '—';
}

export const DispatchQueueTab: React.FC = () => {
  const { campaigns, connections } = useZapMassCore();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<QueueInspectGroup[]>([]);
  const [totals, setTotals] = useState({ jobs: 0, byState: { active: 0, waiting: 0, delayed: 0, paused: 0 } });
  const [channelSummaries, setChannelSummaries] = useState<QueueChannelSummary[]>([]);
  const [deadChannelJobs, setDeadChannelJobs] = useState(0);
  const [runtimeCampaigns, setRuntimeCampaigns] = useState<QueueRuntimeCampaign[]>([]);
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterChannel, setFilterChannel] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const campaignNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c.id, c.name || c.id);
    return m;
  }, [campaigns]);

  const channelNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of connections) m.set(c.id, c.name || c.id);
    return m;
  }, [connections]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiInspectDispatchQueue({
        campaignId: filterCampaign || undefined,
        connectionId: filterChannel || undefined,
      });
      if (!res.ok) throw new Error('Falha ao inspecionar fila.');
      setGroups(res.groups || []);
      setTotals({
        jobs: res.totals?.jobs ?? 0,
        byState: res.totals?.byState ?? { active: 0, waiting: 0, delayed: 0, paused: 0 },
      });
      setChannelSummaries(res.channelSummaries || []);
      setDeadChannelJobs(res.deadChannelJobs ?? 0);
      setRuntimeCampaigns(res.runtimeCampaigns || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar fila.');
    } finally {
      setLoading(false);
    }
  }, [filterCampaign, filterChannel]);

  useEffect(() => {
    void load();
  }, [load]);

  const runRemove = async (
    filters: { campaignId?: string; connectionId?: string; stepIndex?: number },
    label: string
  ) => {
    const scope =
      filters.campaignId && filters.stepIndex != null
        ? 'step'
        : filters.campaignId
          ? 'campaign'
          : filters.connectionId
            ? 'channel'
            : 'all';
    const scopeId =
      scope === 'step'
        ? `${filters.campaignId}:${filters.stepIndex}`
        : scope === 'campaign'
          ? filters.campaignId
          : scope === 'channel'
            ? filters.connectionId
            : undefined;
    const confirmPhrase = buildQueueRemoveConfirmPhrase(scope, scopeId);

    const preview = await apiRemoveDispatchQueue({ ...filters, dryRun: true });
    const n = preview.result?.wouldRemove ?? 0;
    const active = preview.result?.byState?.active ?? 0;
    const ok = window.confirm(
      `${label}\n\nSimulação: ${n.toLocaleString('pt-BR')} job(s) seriam removidos.` +
        (active > 0 ? `\n${active} envio(s) ativo(s) NÃO serão interrompidos.` : '') +
        `\n\nA campanha será pausada antes da limpeza.\n\nDigite OK apenas se concorda. Confirmação exigida: "${confirmPhrase}"`
    );
    if (!ok) return;

    const typed = window.prompt(`Digite exatamente:\n${confirmPhrase}`);
    if (typed?.trim() !== confirmPhrase) {
      toast.error('Confirmação incorreta — operação cancelada.');
      return;
    }

    setBusyKey(label);
    try {
      const res = await apiRemoveDispatchQueue({
        ...filters,
        dryRun: false,
        confirm: confirmPhrase,
        pauseFirst: true,
      });
      if (!res.ok) throw new Error(res.error || 'Falha ao limpar fila.');
      toast.success(
        `Removidos ${res.result.removed.toLocaleString('pt-BR')} job(s).` +
          (res.result.skippedActive ? ` (${res.result.skippedActive} ativos mantidos)` : '')
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao limpar.');
    } finally {
      setBusyKey(null);
    }
  };

  const runPromoteDelayed = async (filters: {
    campaignId?: string;
    connectionId?: string;
    stepIndex?: number;
  }) => {
    const { scope, scopeId } = (() => {
      if (filters.campaignId && filters.stepIndex != null)
        return { scope: 'step' as const, scopeId: `${filters.campaignId}:${filters.stepIndex}` };
      if (filters.campaignId) return { scope: 'campaign' as const, scopeId: filters.campaignId };
      if (filters.connectionId) return { scope: 'channel' as const, scopeId: filters.connectionId };
      return { scope: 'all' as const, scopeId: undefined };
    })();
    const confirmPhrase = buildQueueRemoveConfirmPhrase(scope, scopeId);
    if (!window.confirm(`Antecipar jobs atrasados (delay → agora)? Confirmação: "${confirmPhrase}"`)) return;
    const typed = window.prompt(`Digite:\n${confirmPhrase}`);
    if (typed?.trim() !== confirmPhrase) {
      toast.error('Confirmação incorreta.');
      return;
    }
    setBusyKey('promote');
    try {
      const res = await apiPromoteDelayedQueue({ ...filters, dryRun: false, confirm: confirmPhrase });
      const n = res.result?.promotedDelayed ?? res.result?.wouldRemove ?? 0;
      toast.success(`Antecipados ${n} job(s) atrasados.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusyKey(null);
    }
  };

  const runtimeOrphans = useMemo(
    () => runtimeCampaigns.filter((r) => r.runtimeOnly),
    [runtimeCampaigns]
  );

  const deadJobsOrphanHighlight = useMemo(() => {
    if (deadChannelJobs <= 0) return false;
    const online = connections.filter((c) => c.status === ConnectionStatus.CONNECTED);
    if (online.length === 0) return false;
    const jobsByChip = new Map(channelSummaries.map((s) => [s.connectionId, s.jobs]));
    return online.some((c) => (jobsByChip.get(c.id) ?? 0) === 0);
  }, [deadChannelJobs, connections, channelSummaries]);

  const runPurgeRuntimeOrphans = async () => {
    const confirmPhrase = buildQueueRemoveConfirmPhrase('runtime-orphans');
    const preview = await apiPurgeRuntimeOrphans({ dryRun: true });
    const n = preview.wouldStop ?? preview.orphanCampaignIds?.length ?? 0;
    const jobs = preview.wouldRemoveJobs ?? 0;
    if (
      !window.confirm(
        `Parar ${n} campanha(s) runtime órfã(s) (sem cadastro) e limpar filas?\n` +
          `Jobs Bull estimados: ${jobs.toLocaleString('pt-BR')}.\n` +
          `Pend. mem. pode incluir chips mortos — não confundir com fila dos Disparo atuais.\n\n` +
          `Confirmação: "${confirmPhrase}"`
      )
    ) {
      return;
    }
    const typed = window.prompt(`Digite:\n${confirmPhrase}`);
    if (typed?.trim() !== confirmPhrase) {
      toast.error('Confirmação incorreta.');
      return;
    }
    setBusyKey('runtime-orphans');
    try {
      const res = await apiPurgeRuntimeOrphans({ dryRun: false, confirm: confirmPhrase });
      if (!res.ok) throw new Error(res.error || 'Falha ao parar órfãs.');
      const removed = (res.results || []).reduce((s, x) => s + (x.purgeRemoved || 0), 0);
      toast.success(
        `Paradas ${(res.results || []).length} campanha(s) runtime; ~${removed.toLocaleString('pt-BR')} job(s) removidos da fila.`
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusyKey(null);
    }
  };

  const runPurgeSingleRuntime = async (campaignId: string) => {
    const shortId = runtimeCampaignConfirmShortId(campaignId);
    const confirmPhrase = buildQueueRemoveConfirmPhrase('runtime-campaign', campaignId);
    const preview = await apiPurgeRuntimeCampaign({ campaignId, dryRun: true });
    const jobs = preview.wouldRemoveJobs ?? 0;
    const pending = preview.pendingMem ?? 0;
    if (
      !window.confirm(
        `Parar runtime órfão ${shortId} e limpar fila?\n` +
          `Jobs Bull: ~${jobs.toLocaleString('pt-BR')} · pend. mem. ${pending.toLocaleString('pt-BR')}.\n\n` +
          `Confirmação: "${confirmPhrase}"`
      )
    ) {
      return;
    }
    const typed = window.prompt(`Digite:\n${confirmPhrase}`);
    if (typed?.trim() !== confirmPhrase) {
      toast.error('Confirmação incorreta.');
      return;
    }
    setBusyKey(`runtime-${shortId}`);
    try {
      const res = await apiPurgeRuntimeCampaign({
        campaignId,
        dryRun: false,
        confirm: confirmPhrase,
      });
      if (!res.ok) throw new Error(res.error || 'Falha.');
      toast.success(
        `Runtime ${shortId} parado; ${(res.purgeRemoved ?? 0).toLocaleString('pt-BR')} job(s) removidos.`
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusyKey(null);
    }
  };

  const runPurgeDeadChannels = async () => {
    const confirmPhrase = buildQueueRemoveConfirmPhrase('dead-channels');
    const preview = await apiPurgeDeadChannelQueue({ dryRun: true });
    const n = preview.result?.wouldRemove ?? 0;
    if (
      !window.confirm(
        `Remover ${n.toLocaleString('pt-BR')} job(s) presos em chips mortos/offline?\nConfirmação: "${confirmPhrase}"`
      )
    ) {
      return;
    }
    const typed = window.prompt(`Digite:\n${confirmPhrase}`);
    if (typed?.trim() !== confirmPhrase) {
      toast.error('Confirmação incorreta.');
      return;
    }
    setBusyKey('dead-channels');
    try {
      const res = await apiPurgeDeadChannelQueue({ dryRun: false, confirm: confirmPhrase });
      toast.success(`Removidos ${res.result.removed.toLocaleString('pt-BR')} job(s) de chips mortos.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusyKey(null);
    }
  };

  const togglePriority = async (campaignId: string, boosted: boolean) => {
    setBusyKey(`prio-${campaignId}`);
    try {
      const res = await apiSetCampaignQueuePriority(campaignId, boosted);
      if (!res.ok) throw new Error(res.error || 'Falha ao alterar prioridade.');
      toast.success(
        boosted
          ? `Campanha priorizada (${res.updated} job(s) na fila).`
          : `Prioridade normal restaurada (${res.updated} job(s)).`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-6 h-6 text-emerald-500" />
            Fila de disparo
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
            {DISPATCH_QUEUE_TAB_INTRO} Campanhas runtime órfãs podem ter pend. mem. e fila em chips
            mortos — use parar runtime ou limpar chips mortos.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </Button>
      </header>

      <div className="flex flex-wrap gap-3 items-end bg-white/60 dark:bg-slate-900/40 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 p-4">
        <label className="text-xs font-bold text-slate-500 uppercase">
          Campanha
          <select
            className="mt-1 block min-w-[200px] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            value={filterCampaign}
            onChange={(e) => setFilterCampaign(e.target.value)}
          >
            <option value="">Todas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-500 uppercase">
          Canal (chip)
          <select
            className="mt-1 block min-w-[200px] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
          >
            <option value="">Todos</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-slate-600 dark:text-slate-300 ml-auto text-right">
          Total (sua conta): <strong>{totals.jobs.toLocaleString('pt-BR')}</strong> jobs
          <span className="block text-[11px] text-slate-400 font-normal">
            aguard. {totals.byState.waiting} · atras. {totals.byState.delayed} · ativos{' '}
            {totals.byState.active}
          </span>
          {!loading && deadChannelJobs > 0 && (
            <span className="block text-[11px] text-red-600 dark:text-red-400 font-semibold mt-0.5">
              Em chips mortos: {deadChannelJobs.toLocaleString('pt-BR')} (não listados)
            </span>
          )}
        </p>
      </div>

      {!loading && deadChannelJobs > 0 && (
        <div
          className={`rounded-2xl border p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between ${
            deadJobsOrphanHighlight
              ? 'border-red-500 bg-red-100/80 dark:bg-red-950/50 dark:border-red-600 ring-2 ring-red-400/40 shadow-lg shadow-red-500/10'
              : 'border-red-200/80 bg-red-50/60 dark:bg-red-950/25 dark:border-red-800/50'
          }`}
        >
          <div className="flex gap-3 text-sm text-red-900 dark:text-red-100">
            <AlertTriangle className={`w-5 h-5 shrink-0 ${deadJobsOrphanHighlight ? 'animate-pulse' : ''}`} />
            <div>
              <p className="font-bold">
                {deadJobsOrphanHighlight
                  ? 'Jobs órfãos em chips mortos — seus chips online estão com fila zerada'
                  : 'Jobs em chips offline ou removidos'}
              </p>
              <p className="mt-1">
                <strong>{deadChannelJobs.toLocaleString('pt-BR')}</strong> job(s) não saem sozinhos.
                {deadJobsOrphanHighlight
                  ? ' Limpe os chips mortos para alinhar totais e cards de conexão.'
                  : ' Limpe ou reconecte o chip.'}
              </p>
            </div>
          </div>
          <Button variant="danger" disabled={busyKey != null} onClick={() => void runPurgeDeadChannels()}>
            <Trash2 className="w-4 h-4" />
            Limpar chips mortos
          </Button>
        </div>
      )}

      {!loading && channelSummaries.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/60 overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/80 text-[10px] font-bold uppercase text-slate-500">
            Fila por chip (sua conta)
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {channelSummaries.slice(0, 12).map((ch) => {
              const chipName = channelNameById.get(ch.connectionId) || ch.connectionId;
              return (
                <div
                  key={ch.connectionId}
                  className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {chipName}
                    {!ch.knownToTenant && (
                      <span className="ml-2 text-[10px] font-bold uppercase text-red-600">órfão</span>
                    )}
                  </span>
                  <span className="text-slate-500 text-xs">{stateSummary(ch.byState)}</span>
                  <strong>{ch.jobs.toLocaleString('pt-BR')}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && runtimeOrphans.length > 0 && (
        <div className="rounded-2xl border border-red-200/70 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800/50 p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="text-sm text-red-900 dark:text-red-100">
            <p className="font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {runtimeOrphans.length} campanha(s) runtime sem cadastro
            </p>
            <p className="mt-1 text-red-800/90 dark:text-red-200/90">
              Motor ainda ativo na memória; jobs podem estar em filas de chips antigos. Pend. mem. ≠
              fila nos Disparo atuais.
            </p>
          </div>
          <Button
            variant="danger"
            disabled={busyKey != null}
            onClick={() => void runPurgeRuntimeOrphans()}
          >
            <Trash2 className="w-4 h-4" />
            Parar runtime órfãs
          </Button>
        </div>
      )}

      {!loading && runtimeCampaigns.length > 0 && (
        <div className="rounded-2xl border border-amber-200/60 dark:border-amber-800/40 p-4 text-sm space-y-2">
          <p className="font-bold text-amber-900 dark:text-amber-100">Campanhas em execução (runtime)</p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300">
            {runtimeCampaigns.map((r) => (
              <li
                key={r.campaignId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {campaignNameById.get(r.campaignId) || r.campaignId.slice(0, 8)}
                  {r.runtimeOnly ? (
                    <span className="ml-2 text-[10px] font-bold uppercase text-red-600">
                      órfã (sem cadastro)
                    </span>
                  ) : null}
                  {' — '}
                  fila {r.queueJobs.toLocaleString('pt-BR')} · pend. mem.{' '}
                  {r.pendingJobs.toLocaleString('pt-BR')}
                  {r.paused ? ' · pausada' : ''}
                </span>
                {r.runtimeOnly ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                    disabled={busyKey != null}
                    onClick={() => void runPurgeSingleRuntime(r.campaignId)}
                  >
                    <Trash2 className="w-3 h-3" />
                    Parar e limpar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-10 text-center text-slate-500">
          Nenhum job de disparo encontrado para os filtros atuais.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-slate-700/60">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Chip</th>
                <th className="px-4 py-3">Campanha</th>
                <th className="px-4 py-3">Etapa</th>
                <th className="px-4 py-3">Fila</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {groups.map((g) => {
                const rowKey = `${g.connectionId}-${g.campaignId}-${g.stepIndex}`;
                const campName = campaignNameById.get(g.campaignId) || g.campaignId;
                    const chipName = channelNameById.get(g.connectionId) || g.connectionId;
                    const chipOrphan = !channelNameById.has(g.connectionId);
                    return (
                      <tr key={rowKey} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                          {chipName}
                          {chipOrphan && (
                            <span className="block text-[10px] text-red-500 font-bold uppercase">
                              chip não listado
                            </span>
                          )}
                        </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{campName}</span>
                      {g.samplePhones.length > 0 && (
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          ex.: {g.samplePhones.join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">Etapa {g.stepIndex + 1}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <span className="font-bold">{g.jobs}</span>
                      <span className="text-xs ml-1">({stateSummary(g.byState)})</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                          disabled={busyKey != null}
                          onClick={() =>
                            void togglePriority(g.campaignId, true)
                          }
                        >
                          <Zap className="w-3 h-3" />
                          Priorizar
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          disabled={busyKey != null}
                          onClick={() =>
                            void runPromoteDelayed({
                              campaignId: g.campaignId,
                              connectionId: g.connectionId,
                              stepIndex: g.stepIndex,
                            })
                          }
                        >
                          <FastForward className="w-3 h-3" />
                          Antecipar
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                          disabled={busyKey != null}
                          onClick={() =>
                            void runRemove(
                              {
                                campaignId: g.campaignId,
                                connectionId: g.connectionId,
                                stepIndex: g.stepIndex,
                              },
                              `Limpar etapa ${g.stepIndex + 1} — ${campName}`
                            )
                          }
                        >
                          <Trash2 className="w-3 h-3" />
                          Limpar etapa
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/50 p-4 flex gap-3 text-sm text-amber-900 dark:text-amber-100">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <p>
          Limpar a fila remove jobs aguardando ou atrasados — contatos não enviados deixam de sair
          automaticamente. Retome a campanha ou faça redispatch depois. Jobs <strong>ativos</strong>{' '}
          (envio em curso) não são interrompidos.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={busyKey != null || !filterCampaign}
          onClick={() =>
            void runRemove({ campaignId: filterCampaign }, `Limpar campanha inteira`)
          }
        >
          <Trash2 className="w-4 h-4" />
          Limpar campanha (filtro)
        </Button>
        <Button
          variant="secondary"
          disabled={busyKey != null || !filterChannel}
          onClick={() => void runRemove({ connectionId: filterChannel }, `Limpar canal`)}
        >
          Limpar canal (filtro)
        </Button>
      </div>
    </div>
  );
};
