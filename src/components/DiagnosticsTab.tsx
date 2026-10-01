import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ClipboardCopy,
  Download,
  Loader2,
  RefreshCw,
  Server,
  Smartphone,
  Stethoscope,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { DiagnosticsBundle } from '../../shared/diagnosticsBundle';
import { APP_VERSION } from '../config/appVersion';
import { useZapMassCore } from '../context/ZapMassContext';
import { fetchDiagnosticsExport, fetchDiagnosticsRecent } from '../services/diagnosticsApi';
import { Button } from './ui';

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export const DiagnosticsTab: React.FC = () => {
  const { campaigns, connections, systemLogs } = useZapMassCore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recent, setRecent] = useState<DiagnosticsBundle['recentErrors']>([]);
  const [serverCampaigns, setServerCampaigns] = useState<DiagnosticsBundle['campaigns']>([]);
  const [serverConnections, setServerConnections] = useState<DiagnosticsBundle['connections']>([]);
  const [queue, setQueue] = useState<DiagnosticsBundle['queue']>();

  const load = useCallback(async () => {
    try {
      const res = await fetchDiagnosticsRecent();
      if (!res.ok) throw new Error(res.error || 'Falha ao carregar diagnóstico.');
      setRecent(res.recentErrors || []);
      setServerCampaigns(res.campaigns || []);
      setServerConnections(res.connections || []);
      setQueue(res.queue);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar diagnóstico.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clientErrorHints = useMemo(() => {
    return systemLogs
      .filter((l) => String(l.event || '').includes('error'))
      .slice(0, 25)
      .map((l) => ({
        at: l.timestamp,
        event: l.event,
        message: String((l.payload as { message?: string })?.message || l.event).slice(0, 240),
      }));
  }, [systemLogs]);

  const connectionRows = serverConnections.length
    ? serverConnections
    : connections.map((c) => ({
        id: c.id,
        label: c.name || c.id,
        status: String(c.status),
      }));

  const handleDownload = async () => {
    try {
      const res = await fetchDiagnosticsExport({
        localCampaignCount: campaigns.length,
        clientRecentErrors: clientErrorHints,
      });
      if (!res.ok || !res.bundle) throw new Error(res.error || 'Exportação falhou.');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadJson(`zapmass-diagnostico-${stamp}.json`, res.bundle);
      toast.success('Pacote de diagnóstico baixado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao exportar.');
    }
  };

  const handleCopy = async () => {
    try {
      const res = await fetchDiagnosticsExport({ clientRecentErrors: clientErrorHints });
      if (!res.ok || !res.bundle) throw new Error(res.error || 'Exportação falhou.');
      await navigator.clipboard.writeText(JSON.stringify(res.bundle, null, 2));
      toast.success('Pacote copiado — cole no suporte ou no chat com IA.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao copiar.');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full min-w-0 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: 'var(--text-1)' }}>
          <Stethoscope className="w-6 h-6 text-emerald-500" />
          Diagnóstico
        </h1>
        <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>
          Erros recentes, estado dos chips e pacote exportável para suporte ou IA (sem senhas).
        </p>
      </header>
      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          type="button"
          variant="primary"
          size="sm"
          leftIcon={<Download className="w-4 h-4" />}
          onClick={() => void handleDownload()}
        >
          Baixar pacote de diagnóstico
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<ClipboardCopy className="w-4 h-4" />}
          onClick={() => void handleCopy()}
        >
          Copiar JSON
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leftIcon={refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
        >
          Atualizar
        </Button>
        <span className="text-[12px] self-center" style={{ color: 'var(--text-3)' }}>
          App {APP_VERSION}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-2xl border p-4"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
          >
            <h2 className="flex items-center gap-2 text-[14px] font-bold mb-3" style={{ color: 'var(--text-1)' }}>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Erros recentes (servidor)
            </h2>
            {recent.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                Nenhum erro registrado nesta sessão do servidor. Dispare ou reproduza o problema e atualize.
              </p>
            ) : (
              <ul className="space-y-2 max-h-[420px] overflow-y-auto">
                {recent.slice(0, 40).map((e, i) => (
                  <li
                    key={`${e.at}-${i}`}
                    className="rounded-xl border px-3 py-2 text-[12px]"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
                  >
                    <div className="flex flex-wrap gap-2 items-center mb-1">
                      <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                        {e.codeLabel}
                      </span>
                      <span style={{ color: 'var(--text-3)' }}>{new Date(e.at).toLocaleString('pt-BR')}</span>
                    </div>
                    <p style={{ color: 'var(--text-2)' }}>{e.message}</p>
                    {(e.campaignId || e.phoneMasked) && (
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {e.campaignId ? `Campanha ${e.campaignId.slice(0, 8)}…` : ''}
                        {e.phoneMasked ? ` · ${e.phoneMasked}` : ''}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-6">
            <section
              className="rounded-2xl border p-4"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            >
              <h2 className="flex items-center gap-2 text-[14px] font-bold mb-3" style={{ color: 'var(--text-1)' }}>
                <Smartphone className="w-4 h-4" />
                Conexões
              </h2>
              <ul className="space-y-1.5 text-[12px] max-h-[200px] overflow-y-auto">
                {connectionRows.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span style={{ color: 'var(--text-2)' }}>{c.label}</span>
                    <span className="font-medium" style={{ color: 'var(--text-1)' }}>
                      {c.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section
              className="rounded-2xl border p-4"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
            >
              <h2 className="flex items-center gap-2 text-[14px] font-bold mb-3" style={{ color: 'var(--text-1)' }}>
                <Server className="w-4 h-4" />
                Campanhas e fila
              </h2>
              <p className="text-[12px] mb-2" style={{ color: 'var(--text-3)' }}>
                Fila (cluster): aguardando {queue?.waitLen ?? '—'} · atrasados {queue?.delayedLen ?? '—'} · ativos{' '}
                {queue?.activeJobs ?? '—'}
                {typeof queue?.failedLen === 'number' ? ` · falhas ${queue.failedLen}` : ''}
                {typeof queue?.channelQueues === 'number' && queue.channelQueues > 0
                  ? ` · ${queue.channelQueues} filas por chip`
                  : ''}
              </p>
              {queue?.note ? (
                <p className="text-[11px] mb-2 text-amber-600 dark:text-amber-400">{queue.note}</p>
              ) : null}
              <ul className="space-y-1.5 text-[12px] max-h-[220px] overflow-y-auto">
                {(serverCampaigns.length
                  ? serverCampaigns
                  : campaigns.slice(0, 8).map((c) => ({ id: c.id, name: c.name }))
                ).map((c) => (
                  <li key={c.id} className="flex flex-col gap-0.5 border-b border-[var(--border)] pb-1.5">
                    <span className="font-medium" style={{ color: 'var(--text-1)' }}>
                      {c.name}
                    </span>
                    {'isRunning' in c && typeof c.isRunning === 'boolean' && (
                      <span style={{ color: 'var(--text-3)' }}>
                        {c.isRunning ? 'Executando' : 'Parada'}
                        {'pendingJobs' in c && typeof c.pendingJobs === 'number'
                          ? ` · memória ${c.pendingJobs}`
                          : ''}
                        {'queueJobs' in c && typeof c.queueJobs === 'number'
                          ? ` · fila Bull ${c.queueJobs}`
                          : ''}
                        {'failCount' in c && typeof c.failCount === 'number' ? ` · falhas ${c.failCount}` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};
