import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, RefreshCw, RotateCcw, Users, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ContactStateStepSummaryDto } from '../../services/campaignsApi';
import { fetchCampaignContactStates, retryFailedContacts } from '../../services/campaignsApi';
import type { Campaign } from '../../types';

interface Props {
  campaign: Campaign;
  /** Rótulos das etapas (derivados de messageStages ou stageConfigs). */
  stageLabels?: string[];
}

type StatusConfig = {
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  order: number;
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  pending:       { label: 'Pendente',     icon: <Clock className="w-3.5 h-3.5" />,        color: 'text-gray-400',   bg: 'bg-gray-100 dark:bg-gray-800',         order: 0 },
  waiting_delay: { label: 'Aguardando',   icon: <Clock className="w-3.5 h-3.5" />,        color: 'text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-900/30',       order: 1 },
  waiting_reply: { label: 'Aguard. resposta', icon: <Clock className="w-3.5 h-3.5 animate-pulse" />, color: 'text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30', order: 2 },
  completed:     { label: 'Concluído',    icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-green-400',  bg: 'bg-green-50 dark:bg-green-900/30',     order: 3 },
  skipped:       { label: 'Pulado',       icon: <AlertCircle className="w-3.5 h-3.5" />,  color: 'text-gray-400',   bg: 'bg-gray-50 dark:bg-gray-900/30',       order: 4 },
  failed:        { label: 'Falhou',       icon: <XCircle className="w-3.5 h-3.5" />,      color: 'text-red-400',    bg: 'bg-red-50 dark:bg-red-900/30',         order: 5 },
};

type StepGroup = {
  stepIndex: number;
  label: string;
  byStatus: Record<string, number>;
  total: number;
};

function groupByStep(
  rows: ContactStateStepSummaryDto[],
  stageLabels: string[]
): StepGroup[] {
  const stepMap = new Map<number, StepGroup>();
  for (const row of rows) {
    const idx = row.step_index;
    if (!stepMap.has(idx)) {
      stepMap.set(idx, {
        stepIndex: idx,
        label: stageLabels[idx] ? `Etapa ${idx + 1}: ${stageLabels[idx].slice(0, 40)}` : `Etapa ${idx + 1}`,
        byStatus: {},
        total: 0,
      });
    }
    const group = stepMap.get(idx)!;
    group.byStatus[row.status] = (group.byStatus[row.status] || 0) + row.count;
    group.total += row.count;
  }
  return Array.from(stepMap.values()).sort((a, b) => a.stepIndex - b.stepIndex);
}

export function CampaignMultiStepDashboard({ campaign, stageLabels = [] }: Props) {
  const [summary, setSummary] = useState<ContactStateStepSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCampaignContactStates(campaign.id);
      setSummary(data);
    } catch {
      // silencioso se a tabela não existir ainda
    } finally {
      setLoading(false);
    }
  }, [campaign.id]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRetryFailed = async (stepIndex: number) => {
    setRetrying(stepIndex);
    try {
      const n = await retryFailedContacts(campaign.id, stepIndex);
      toast.success(`${n} contato(s) reenviado(s) na mesma campanha.`);
      void load();
    } catch {
      toast.error('Erro ao resetar contatos falhos.');
    } finally {
      setRetrying(null);
    }
  };

  const steps = groupByStep(summary, stageLabels);

  if (steps.length === 0 && !loading) return null;

  const totalContacts = steps[0]?.total ?? 0;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Users className="h-4 w-4 text-violet-400" />
          Progresso por etapa
          {totalContacts > 0 && (
            <span className="text-xs text-white/40">({totalContacts} contatos)</span>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded p-1 text-white/40 hover:text-white/70 transition-colors"
          title="Atualizar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && steps.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-white/40 py-2">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Carregando...
        </div>
      ) : (
        <div className="space-y-3">
          {steps.map((step) => {
            const hasFailed = (step.byStatus.failed || 0) > 0;
            const waitingReply = step.byStatus.waiting_reply || 0;
            const completedPct =
              step.total > 0
                ? Math.round(((step.byStatus.completed || 0) / step.total) * 100)
                : 0;

            return (
              <div key={step.stepIndex} className="rounded-lg bg-white/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-white/70 truncate max-w-[200px]">
                    {step.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {waitingReply > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300 animate-pulse">
                        <Clock className="h-3 w-3" />
                        {waitingReply} aguardando
                      </span>
                    )}
                    {hasFailed && (
                      <button
                        onClick={() => void handleRetryFailed(step.stepIndex)}
                        disabled={retrying === step.stepIndex}
                        className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/30 transition-colors"
                        title="Reenviar falhos desta etapa"
                      >
                        <RotateCcw className={`h-3 w-3 ${retrying === step.stepIndex ? 'animate-spin' : ''}`} />
                        {step.byStatus.failed} falhos — reenviar
                      </button>
                    )}
                  </div>
                </div>

                {/* Barra de progresso */}
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-green-500 transition-all duration-500"
                    style={{ width: `${completedPct}%` }}
                  />
                </div>

                {/* Chips de status */}
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(STATUS_CONFIG) as [string, StatusConfig][])
                    .sort((a, b) => a[1].order - b[1].order)
                    .map(([status, cfg]) => {
                      const count = step.byStatus[status] || 0;
                      if (count === 0) return null;
                      return (
                        <span
                          key={status}
                          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${cfg.bg} ${cfg.color}`}
                        >
                          {cfg.icon}
                          {count} {cfg.label}
                        </span>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
