import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Info, RefreshCw, Shield, ShieldCheck, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { CollapsibleSection, Badge, Button } from '../ui';
import {
  fetchChipProtection,
  setChipProtectionPolicy,
  type ChipProtectionPolicy,
  type ChipProtectionSnapshot
} from '../../services/chipProtectionApi';

const POLICY_OPTIONS: Array<{
  value: ChipProtectionPolicy;
  label: string;
  description: string;
}> = [
  {
    value: 'auto',
    label: 'Automático (recomendado)',
    description:
      'Protege chips quando não há campanha. Ao iniciar uma campanha, pausa sozinho. Após ban ou quedas, reforça por horas.',
  },
  {
    value: 'always',
    label: 'Sempre protegido',
    description: 'Nunca envia automações nem sync pesado — mesmo com campanha (use só se souber o impacto).',
  },
  {
    value: 'off',
    label: 'Desligado',
    description: 'Sem proteção automática. Apenas para operação avançada.',
  },
];

export const ChipProtectionPanel: React.FC = () => {
  const [data, setData] = useState<ChipProtectionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await fetchChipProtection();
      setData(snap);
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao carregar proteção.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const changePolicy = async (policy: ChipProtectionPolicy) => {
    if (!data || data.chipProtectionPolicy === policy) return;
    setSaving(true);
    try {
      const snap = await setChipProtectionPolicy(policy);
      setData(snap);
      toast.success(
        policy === 'auto'
          ? 'Proteção automática ativada — você não precisa fazer nada manualmente.'
          : policy === 'always'
            ? 'Proteção permanente ativada.'
            : 'Proteção automática desligada.'
      );
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const warnCount = data?.risks.filter((r) => r.level === 'warn').length ?? 0;
  const summary = data?.chipQuietMode
    ? data.protectionReasonLabel
    : warnCount > 0
      ? `${warnCount} alerta(s)`
      : 'Automático';

  return (
    <CollapsibleSection
      title="Proteção automática de chips"
      summary={summary}
      defaultOpen
    >
      <div className="space-y-4">
        <div className="zm-panel p-4 flex items-start gap-3">
          {data?.chipQuietMode ? (
            <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          ) : (
            <Shield className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <p className="font-medium text-sm">Status agora</p>
              {data?.chipQuietMode ? (
                <Badge variant="success">Protegido</Badge>
              ) : (
                <Badge variant="neutral">Campanha ativa / envios liberados</Badge>
              )}
            </div>
            <p className="ui-caption">
              {data?.protectionReasonLabel ||
                'Carregando… — a proteção funciona sozinha, sem botão manual.'}
            </p>
            {data?.protectionLockUntil && (
              <p className="ui-caption text-amber-600 dark:text-amber-400 mt-1">
                Reforço até {new Date(data.protectionLockUntil).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="space-y-2">
          <p className="ui-overline px-1">Política</p>
          {POLICY_OPTIONS.map((opt) => {
            const selected = data?.chipProtectionPolicy === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={saving || loading}
                onClick={() => void changePolicy(opt.value)}
                className={`w-full text-left zm-panel p-3 transition-colors ${
                  selected
                    ? 'ring-2 ring-emerald-500/40 bg-emerald-500/5'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{opt.label}</span>
                  {selected && <Badge variant="success">Ativo</Badge>}
                </div>
                <p className="ui-caption mt-1">{opt.description}</p>
              </button>
            );
          })}
        </div>

        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="zm-panel p-3">
                <p className="ui-overline mb-1">Jornada</p>
                <p className="text-sm">
                  {data.nurture.journeyEnabled ? 'Configurada' : 'Desligada'}
                  {data.nurture.dueEnrollments > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {' '}
                      · {data.nurture.dueEnrollments} pendente(s)
                    </span>
                  )}
                </p>
                {data.nurture.pausedByQuiet && (
                  <Badge variant="success" className="mt-2">
                    Bloqueada pela proteção
                  </Badge>
                )}
              </div>
              <div className="zm-panel p-3">
                <p className="ui-overline mb-1 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  Auto-aquecimento
                </p>
                <p className="text-sm">
                  {data.autoWarmup.active
                    ? `Ativo (${data.autoWarmup.connectionIds.length} chip(s))`
                    : 'Parado'}
                </p>
              </div>
              <div className="zm-panel p-3">
                <p className="ui-overline mb-1">Campanhas</p>
                <p className="text-sm">{data.campaigns.queueHint}</p>
              </div>
            </div>

            <div className="zm-panel p-3">
              <p className="ui-overline mb-2">Sync da inbox (automático)</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant={data.sync.fullHistory ? 'warning' : 'success'}>
                  Histórico completo: {data.sync.fullHistory ? 'sim' : 'não'}
                </Badge>
                <Badge variant={data.sync.fullInboxSync ? 'neutral' : 'success'}>
                  Prefetch: {data.sync.sparseConvLimit} conv × {data.sync.msgPrefetch} msgs
                </Badge>
              </div>
            </div>

            {data.risks.length > 0 && (
              <ul className="space-y-2">
                {data.risks.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300"
                  >
                    {r.level === 'warn' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    )}
                    <span>{r.message}</span>
                  </li>
                ))}
              </ul>
            )}

            {data.recommendations.length > 0 && (
              <div className="ui-caption space-y-1 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                {data.recommendations.map((rec, i) => (
                  <p key={i}>• {rec}</p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
};
