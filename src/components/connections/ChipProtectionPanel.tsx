import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Info, RefreshCw, Shield, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { CollapsibleSection, Badge, Button } from '../ui';
import {
  fetchChipProtection,
  setChipQuietMode,
  type ChipProtectionSnapshot
} from '../../services/chipProtectionApi';

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
  }, [load]);

  const toggleQuiet = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const next = !data.chipQuietMode;
      const snap = await setChipQuietMode(next);
      setData(snap);
      toast.success(
        next
          ? 'Modo chip quieto ativado — envios automáticos pausados e sync leve.'
          : 'Modo chip quieto desativado — automações voltam ao normal.'
      );
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const warnCount = data?.risks.filter((r) => r.level === 'warn').length ?? 0;
  const summary = data?.chipQuietMode
    ? 'Modo quieto ON'
    : warnCount > 0
      ? `${warnCount} alerta(s)`
      : 'Sem alertas';

  return (
    <CollapsibleSection
      title="Proteção de chips"
      summary={summary}
      defaultOpen={Boolean(data?.chipQuietMode || warnCount > 0)}
    >
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 zm-panel p-4">
          <div className="flex items-start gap-3">
            {data?.chipQuietMode ? (
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <Shield className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium text-sm">Modo chip quieto</p>
              <p className="ui-caption mt-0.5 max-w-xl">
                Mantém chips conectados com sync leve da inbox, sem jornada de nutrição, sem
                auto-aquecimento e sem novas inscrições automáticas. Ideal quando o WhatsApp
                derruba números sem campanha ativa.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={data?.chipQuietMode ? 'secondary' : 'primary'}
              onClick={() => void toggleQuiet()}
              disabled={loading || saving || !data}
            >
              {saving ? 'Salvando…' : data?.chipQuietMode ? 'Desativar' : 'Ativar'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="zm-panel p-3">
                <p className="ui-overline mb-1">Jornada</p>
                <p className="text-sm">
                  {data.nurture.journeyEnabled ? 'Ativa' : 'Desligada'}
                  {data.nurture.dueEnrollments > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {' '}
                      · {data.nurture.dueEnrollments} pendente(s)
                    </span>
                  )}
                </p>
                {data.nurture.pausedByQuiet && (
                  <Badge variant="success" className="mt-2">
                    Pausada pelo modo quieto
                  </Badge>
                )}
              </div>
              <div className="zm-panel p-3">
                <p className="ui-overline mb-1">Auto-aquecimento</p>
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
              <p className="ui-overline mb-2">Sync da inbox ao conectar</p>
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
