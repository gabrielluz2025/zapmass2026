/**
 * DispatchDiagnosticsPanel
 *
 * Exibido dentro de CampaignDetails quando a campanha tem muitas falhas
 * ou está presa. Mostra:
 *  - Jobs falhos com o MOTIVO REAL do erro (da fila BullMQ)
 *  - Status dos chips utilizados
 *  - Botão "Testar envio" (envia mensagem-teste para número do usuário)
 *  - Botão "Reenviar falhos" (retry-failed)
 *  - Checklist de possíveis causas
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Send,
  Smartphone,
  XCircle,
  Zap,
  HelpCircle,
  RotateCcw,
  Bug,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign, WhatsAppConnection } from '../../types';
import { apiPreflightCheck, apiTestSend, retryFailedContacts, apiGetFailedJobs, fetchRedisHealth } from '../../services/campaignsApi';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface FailedJob {
  jobId: string;
  campaignId: string;
  connectionId: string;
  to: string;
  failedReason: string;
  attemptsMade: number;
  failedAt?: string;
}

interface Props {
  campaign: Campaign;
  connections: WhatsAppConnection[];
  failedCount?: number;
  onRefresh?: () => void;
}

type CheckStatus = 'idle' | 'checking' | 'ok' | 'error';

export const DispatchDiagnosticsPanel: React.FC<Props> = ({
  campaign,
  connections,
  failedCount = 0,
  onRefresh,
}) => {
  const [chipStatus, setChipStatus] = useState<CheckStatus>('idle');
  const [chipResults, setChipResults] = useState<Array<{ connectionId: string; status: string; isReady: boolean; error: string | null }>>([]);

  const [testNumber, setTestNumber] = useState('');
  const [testMessage, setTestMessage] = useState('Teste ZapMass — diagnóstico de disparo 🔍');
  const [testStatus, setTestStatus] = useState<CheckStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const [retryStatus, setRetryStatus] = useState<CheckStatus>('idle');

  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [showAllJobs, setShowAllJobs] = useState(false);

  const [redisStatus, setRedisStatus] = useState<CheckStatus>('idle');

  const selectedIds = campaign.selectedConnectionIds || [];

  const checkRedis = useCallback(async () => {
    setRedisStatus('checking');
    try {
      const r = await fetchRedisHealth();
      setRedisStatus(r.ok ? 'ok' : 'error');
    } catch {
      setRedisStatus('error');
    }
  }, []);

  // Carrega jobs falhos + status do Redis automaticamente ao montar
  useEffect(() => {
    loadFailedJobs();
    void checkRedis();
  }, []);

  const loadFailedJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const result = await apiGetFailedJobs();
      const mine = result.jobs.filter((j) => j.campaignId === campaign.id);
      setFailedJobs(mine);
    } catch {
      // silencioso
    } finally {
      setJobsLoading(false);
    }
  }, [campaign.id]);

  const handleCheckChips = useCallback(async () => {
    if (selectedIds.length === 0) {
      toast.error('Nenhum chip selecionado nesta campanha.');
      return;
    }
    setChipStatus('checking');
    try {
      const result = await apiPreflightCheck(selectedIds);
      setChipResults(result.results);
      setChipStatus(result.allReady ? 'ok' : 'error');
      if (result.allReady) {
        toast.success(`Todos os ${result.readyCount} chip(s) estão online!`);
      } else {
        toast.error(`${result.readyCount}/${result.totalChecked} chip(s) online. Verifique os chips com erro.`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setChipStatus('error');
      toast.error(msg);
    }
  }, [selectedIds]);

  const handleTestSend = useCallback(async () => {
    const cleanNumber = testNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10) {
      toast.error('Informe um número válido com DDD (mín. 10 dígitos).');
      return;
    }
    if (!testMessage.trim()) {
      toast.error('Informe a mensagem de teste.');
      return;
    }
    const connId = selectedIds[0];
    if (!connId) {
      toast.error('Nenhum chip disponível para o teste.');
      return;
    }
    setTestStatus('checking');
    setTestError(null);
    try {
      const result = await apiTestSend(connId, cleanNumber, testMessage);
      if (result.ok) {
        setTestStatus('ok');
        toast.success(`Mensagem enviada! ID: ${result.messageId || 'n/a'}`);
      } else {
        setTestStatus('error');
        setTestError(result.error || 'Falha no envio de teste.');
        toast.error(`Falha: ${result.error}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestStatus('error');
      setTestError(msg);
      toast.error(msg);
    }
  }, [testNumber, testMessage, selectedIds]);

  const handleRetryFailed = useCallback(async () => {
    if (!campaign.id) return;
    setRetryStatus('checking');
    try {
      const reset = await retryFailedContacts(campaign.id, 0);
      setRetryStatus('ok');
      toast.success(`${reset} contato(s) recolocado(s) na fila para reenvio.`);
      onRefresh?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRetryStatus('error');
      toast.error(msg);
    }
  }, [campaign.id, onRefresh]);

  const connMap = new Map(connections.map((c) => [c.id, c]));

  // Agrupa motivos de falha para exibição resumida
  const errorGroups = failedJobs.reduce<Record<string, number>>((acc, j) => {
    const key = j.failedReason.slice(0, 120);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const displayedJobs = showAllJobs ? failedJobs : failedJobs.slice(0, 5);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
    >
      {/* Header */}
      <div
        className="px-5 py-4 border-b flex items-center gap-3"
        style={{ borderColor: 'var(--border-subtle)', background: '#ef444408' }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: '#ef444420' }}
        >
          <Zap className="w-4.5 h-4.5 text-red-500" />
        </div>
        <div>
          <h3 className="font-bold text-[14px]" style={{ color: 'var(--text-1)' }}>
            Diagnóstico de Disparo
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            Identifique e corrija problemas de envio
          </p>
        </div>
        {failedCount > 0 && (
          <div
            className="ml-auto rounded-full px-3 py-1 text-[12px] font-bold"
            style={{ background: '#ef444420', color: '#ef4444' }}
          >
            {failedCount} falha{failedCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div className="p-5 space-y-5">

        {/* ── Seção 0: Infraestrutura (Redis / fila) ── */}
        <div
          className="rounded-xl p-4 flex items-center gap-3"
          style={{
            background:
              redisStatus === 'error' ? '#ef444410' : redisStatus === 'ok' ? '#10b98110' : 'var(--surface-1)',
            border: `1px solid ${
              redisStatus === 'error' ? '#ef444430' : redisStatus === 'ok' ? '#10b98130' : 'var(--border-subtle)'
            }`,
          }}
        >
          {redisStatus === 'checking' ? (
            <RefreshCw className="w-4 h-4 shrink-0 animate-spin" style={{ color: 'var(--text-3)' }} />
          ) : redisStatus === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
          ) : redisStatus === 'error' ? (
            <XCircle className="w-4 h-4 shrink-0 text-red-500" />
          ) : (
            <HelpCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--text-3)' }} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
              Fila de envio (Redis){' '}
              {redisStatus === 'ok'
                ? '— operacional'
                : redisStatus === 'error'
                ? '— indisponível'
                : redisStatus === 'checking'
                ? '— verificando…'
                : ''}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {redisStatus === 'error'
                ? 'Sem Redis a fila não processa. Verifique o container redis na VPS.'
                : 'Motor de fila que processa os envios em segundo plano.'}
            </p>
          </div>
          <button
            onClick={checkRedis}
            className="text-[11px] flex items-center gap-1 shrink-0"
            style={{ color: 'var(--text-3)' }}
          >
            <RefreshCw className={`w-3 h-3 ${redisStatus === 'checking' ? 'animate-spin' : ''}`} />
            Reverificar
          </button>
        </div>

        {/* ── Seção 1: Erros reais da fila ── */}
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bug className="w-4 h-4" style={{ color: '#ef4444' }} />
              <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                Motivo real das falhas (fila BullMQ)
              </span>
            </div>
            <button
              onClick={loadFailedJobs}
              className="text-[11px] flex items-center gap-1"
              style={{ color: 'var(--text-3)' }}
            >
              <RefreshCw className={`w-3 h-3 ${jobsLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>

          {jobsLoading ? (
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Carregando jobs falhos…</p>
          ) : failedJobs.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              Nenhum job falho encontrado na fila para esta campanha.
            </p>
          ) : (
            <>
              {/* Resumo agrupado por erro */}
              <div className="space-y-1.5 mb-3">
                {Object.entries(errorGroups).map(([reason, count]) => (
                  <div
                    key={reason}
                    className="rounded-lg px-3 py-2 flex items-start gap-2"
                    style={{ background: '#ef444410', border: '1px solid #ef444425' }}
                  >
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-mono break-all" style={{ color: '#ef4444' }}>
                        {reason}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5"
                      style={{ background: '#ef4444', color: '#fff' }}
                    >
                      ×{count}
                    </span>
                  </div>
                ))}
              </div>

              {/* Lista detalhada por contato */}
              <div className="space-y-1">
                {displayedJobs.map((j) => (
                  <div
                    key={j.jobId}
                    className="flex items-center gap-2 text-[11px] px-2 py-1 rounded-lg"
                    style={{ background: 'var(--surface-0)' }}
                  >
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {j.to}
                    </span>
                    <span style={{ color: '#ef4444' }} className="truncate flex-1">
                      {j.failedReason.slice(0, 80)}
                    </span>
                    <span style={{ color: 'var(--text-3)' }}>({j.attemptsMade} tentativa{j.attemptsMade !== 1 ? 's' : ''})</span>
                  </div>
                ))}
              </div>

              {failedJobs.length > 5 && (
                <button
                  onClick={() => setShowAllJobs(!showAllJobs)}
                  className="mt-2 text-[11px] flex items-center gap-1"
                  style={{ color: 'var(--text-3)' }}
                >
                  {showAllJobs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showAllJobs ? 'Mostrar menos' : `Ver todos os ${failedJobs.length} jobs falhos`}
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Seção 2: Possíveis causas ── */}
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-4 h-4" style={{ color: '#f59e0b' }} />
            <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
              Causas comuns de falha
            </span>
          </div>
          <ul className="space-y-1.5">
            {[
              'Chip desconectado — reconecte o WhatsApp no painel de chips',
              'Evolution API offline — verifique: docker logs zapmass-evolution-1',
              'Número no formato errado: deve ter DDI + DDD (ex: 5547999999999)',
              'Redis indisponível — fila parada (verifique o container redis)',
              'Limite diário do chip atingido',
              'Número bloqueado ou inválido no WhatsApp',
            ].map((cause, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--text-2)' }}>
                <span className="text-[#f59e0b] shrink-0 mt-0.5">•</span>
                {cause}
              </li>
            ))}
          </ul>
        </div>

        {/* ── Seção 3: Verificar chips ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              Verificar chips da campanha ({selectedIds.length})
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCheckChips}
              loading={chipStatus === 'checking'}
              leftIcon={<Smartphone className="w-3.5 h-3.5" />}
            >
              Verificar agora
            </Button>
          </div>

          {chipResults.length > 0 && (
            <div className="space-y-2">
              {chipResults.map((r) => {
                const conn = connMap.get(r.connectionId);
                return (
                  <div
                    key={r.connectionId}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl"
                    style={{
                      background: r.isReady ? '#10b98110' : '#ef444410',
                      border: `1px solid ${r.isReady ? '#10b98130' : '#ef444430'}`,
                    }}
                  >
                    {r.isReady
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                      : <XCircle className="w-4 h-4 shrink-0 text-red-500" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {conn?.name || r.connectionId}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {r.isReady ? 'Online e pronto' : (r.error || `Offline (${r.status})`)}
                        {(() => {
                          const limit = Number(conn?.dailyLimit) || 0;
                          if (limit <= 0) return null;
                          const sent = Number(conn?.messagesSentToday) || 0;
                          const remaining = Math.max(0, limit - sent);
                          return (
                            <span style={{ color: remaining === 0 ? '#ef4444' : 'var(--text-3)' }}>
                              {' '}· limite hoje {sent}/{limit} ({remaining} restante{remaining !== 1 ? 's' : ''})
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <div
                      className="text-[10px] font-bold rounded-full px-2 py-0.5"
                      style={{ background: r.isReady ? '#10b981' : '#ef4444', color: '#fff' }}
                    >
                      {r.status.toUpperCase()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Seção 4: Envio de teste ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
              Testar envio de 1 mensagem
            </span>
            {testStatus === 'ok' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {testStatus === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
          </div>
          <div className="flex gap-2 mb-2">
            <Input
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              placeholder="Seu número com DDD (ex: 47999999999)"
              className="flex-1 text-[12px]"
            />
          </div>
          <div className="flex gap-2">
            <Input
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Mensagem de teste"
              className="flex-1 text-[12px]"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleTestSend}
              loading={testStatus === 'checking'}
              leftIcon={<Send className="w-3.5 h-3.5" />}
            >
              Enviar
            </Button>
          </div>
          {testStatus === 'error' && testError && (
            <div
              className="mt-2 rounded-lg px-3 py-2 text-[11px] font-mono"
              style={{ background: '#ef444415', color: '#ef4444', border: '1px solid #ef444430' }}
            >
              Erro: {testError}
            </div>
          )}
          {testStatus === 'ok' && (
            <p className="mt-1.5 text-[11px] text-emerald-400">
              ✓ Enviado com sucesso! O chip está funcionando.
            </p>
          )}
        </div>

        {/* ── Seção 5: Reenviar falhos ── */}
        {failedCount > 0 && (
          <div
            className="rounded-xl p-4 flex items-start gap-3"
            style={{ background: '#ef444410', border: '1px solid #ef444430' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <div className="flex-1">
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {failedCount} mensagem{failedCount !== 1 ? 's' : ''} com falha definitiva
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                Corrija o chip e recoloque os contatos na fila para novo envio.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRetryFailed}
                loading={retryStatus === 'checking'}
                leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                className="mt-2"
              >
                Reenviar {failedCount} falho{failedCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}

        {/* Atualizar */}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { loadFailedJobs(); onRefresh?.(); }}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Atualizar dados
          </Button>
        </div>
      </div>
    </div>
  );
};
