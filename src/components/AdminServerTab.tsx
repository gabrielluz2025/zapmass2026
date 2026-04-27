import React, { useMemo, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Gauge,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { ConnectionStatus } from '../types';
import { getMaxConnectionSlotsForUser, countAccountScopedConnections, BASE_CHANNEL_SLOTS, MAX_CHANNELS_TOTAL } from '../utils/connectionLimitPolicy';
import { getChannelCapacity } from '../utils/channelCapacityHeuristic';
import { Card, CardHeader, Badge } from './ui';
import { AdminOpsMonitor } from './AdminOpsMonitor';
import { DashMetric } from './dashboard/DashMetric';

/**
 * Aba exclusiva de administrador: heurística RAM/sessões, canais offline, monitor de ops.
 * Utilizadores normais não veem esta rota (App redireciona).
 */
export const AdminServerTab: React.FC = () => {
  const { connections, systemMetrics, isBackendConnected } = useZapMass();
  const { user } = useAuth();
  const { subscription } = useSubscription();

  const maxPlanChannelSlots = useMemo(() => getMaxConnectionSlotsForUser(subscription, true), [subscription]);
  const planScopedCount = useMemo(
    () => countAccountScopedConnections(connections, user?.uid ?? null),
    [connections, user?.uid]
  );

  const offlineConnections = connections.filter((c) => c.status !== ConnectionStatus.CONNECTED);

  const cap = getChannelCapacity(systemMetrics?.ramTotalGb);
  const totalConns = connections.length;
  const ramLoadPct = cap.safe > 0 ? Math.min(100, Math.round((totalConns / cap.safe) * 100)) : 0;
  const infraLevel: 'ok' | 'warn' | 'critical' =
    totalConns >= cap.critical ? 'critical' : totalConns > cap.safe ? 'warn' : 'ok';
  const ramBarFill =
    infraLevel === 'critical' ? 'var(--danger)' : infraLevel === 'warn' ? 'var(--warning)' : 'var(--semantic-muted-fg)';

  const planBg =
    infraLevel === 'ok' && systemMetrics?.ramTotalGb != null
      ? 'var(--semantic-success-bg)'
      : 'var(--semantic-warning-bg)';

  let headline: string;
  let subHead: ReactNode;
  if (infraLevel === 'critical') {
    headline = 'Servidor no limite (memória)';
    subHead = `Muitas sessões WhatsApp para a RAM desta máquina. Risco de travamentos.`;
  } else if (infraLevel === 'warn') {
    headline = 'Perto do teto de hardware';
    subHead = `Com ${systemMetrics?.ramTotalGb ?? '?'} GB, o ideal é até ~${cap.safe} sessões; acima de ${cap.critical} o sistema fica instável.`;
  } else if (systemMetrics?.ramTotalGb == null) {
    headline = 'A sincronizar';
    subHead = 'Métricas de RAM do host em breve.';
  } else {
    headline = 'Plano e servidor alinhados';
    subHead = (
      <>
        <p className="leading-relaxed">
          <strong className="font-semibold" style={{ color: 'var(--text-2)' }}>Pro</strong>: {BASE_CHANNEL_SLOTS} canais no
          plano; até {MAX_CHANNELS_TOTAL} com add-on pago.
        </p>
        <p className="mt-1.5 leading-relaxed">
          A caixa <strong className="font-semibold" style={{ color: 'var(--text-2)' }}>Contrato</strong> mostra quantos
          canais pode <em>criar</em>. A de <strong className="font-semibold" style={{ color: 'var(--text-2)' }}>RAM</strong>{' '}
          só estima conforto da máquina — não substitui o limite do plano.
        </p>
      </>
    );
  }

  const headerIcon =
    infraLevel !== 'ok' || systemMetrics?.ramTotalGb == null ? (
      <AlertTriangle
        className="w-[18px] h-[18px]"
        style={{ color: infraLevel === 'critical' ? 'var(--danger)' : 'var(--warning)' }}
      />
    ) : (
      <ShieldCheck className="w-[18px] h-[18px]" style={{ color: 'var(--semantic-success-fg)' }} />
    );

  const statusBadge: { variant: 'success' | 'warning' | 'danger' | 'neutral'; label: string } = (() => {
    if (infraLevel === 'critical') return { variant: 'danger', label: 'RAM crítica' };
    if (infraLevel === 'warn') return { variant: 'warning', label: 'RAM em aviso' };
    if (systemMetrics?.ramTotalGb == null) return { variant: 'neutral', label: 'A sincronizar' };
    return { variant: 'success', label: 'Situação ok' };
  })();

  return (
    <div className="space-y-5 pb-10 max-w-[1800px] mx-auto w-full">
      <div>
        <h1 className="ui-title text-[20px]">Operações (servidor)</h1>
        <p className="ui-subtitle text-[13px] mt-0.5">
          Heurísticas de RAM, canais e integrações — visível só para administradores.
        </p>
      </div>

      <Card
        className="overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, var(--ops-panel-fade) 0%, var(--surface-0) 48%)',
          borderColor: 'var(--border-subtle)'
        }}
      >
        <div className="space-y-0">
          <div className="p-1">
            <CardHeader
              icon={
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: systemMetrics?.ramTotalGb == null ? 'var(--semantic-warning-bg)' : planBg }}
                >
                  {headerIcon}
                </div>
              }
              title={headline}
              subtitle={typeof subHead === 'string' ? subHead : undefined}
              actions={
                <div className="flex flex-wrap items-center gap-1.5 justify-end">
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  <Badge variant="neutral" className="text-[10px] hidden sm:inline-flex" dot={isBackendConnected}>
                    {isBackendConnected ? 'Online' : 'Reconectando'}
                  </Badge>
                </div>
              }
            />
          </div>

          {typeof subHead !== 'string' && (
            <div className="px-4 pb-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {subHead}
            </div>
          )}

          <div
            className="mx-4 mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] leading-snug"
            style={{
              background: isBackendConnected ? 'var(--surface-1)' : 'rgba(245, 158, 11, 0.08)',
              border: `1px solid ${isBackendConnected ? 'var(--border-subtle)' : 'rgba(245, 158, 11, 0.2)'}`
            }}
            role="status"
            aria-live="polite"
          >
            {isBackendConnected ? (
              <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
            ) : (
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            )}
            <span style={{ color: 'var(--text-3)' }}>
              {isBackendConnected
                ? 'Dados e avisos sincronizados com o backend.'
                : 'Reconectando — os números voltam em instantes.'}
            </span>
          </div>

          <div className="px-4 grid grid-cols-1 gap-3 pb-4 lg:grid-cols-2">
            <div
              className="rounded-xl p-3.5 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                <FileText className="h-4 w-4 shrink-0 text-emerald-500/90" aria-hidden />
                <span className="text-[11px] font-semibold">Canais nesta conta</span>
              </div>
              <DashMetric
                label="Canais em uso"
                value={<span>{planScopedCount}</span>}
                hint={`Teto de criação no app: ${maxPlanChannelSlots}; o gargalo operacional costuma ser a RAM.`}
              />
            </div>

            <div
              className="rounded-xl p-3.5 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
                <Gauge className="h-4 w-4 shrink-0 text-indigo-500/90" aria-hidden />
                <span className="text-[11px] font-semibold">Referência: RAM e sessões</span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {systemMetrics?.ramTotalGb != null ? (
                  <>
                    Com ~{systemMetrics.ramTotalGb} GB, conforto até{' '}
                    <strong style={{ color: 'var(--text-2)' }}>~{cap.safe} sessões</strong>; risco relevante acima de{' '}
                    <strong style={{ color: 'var(--text-2)' }}>{cap.critical}</strong> (Chromium + WA Web).
                  </>
                ) : (
                  'Aguardando leitura de RAM do servidor…'
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <DashMetric
                  label="Sessões / referência conforto"
                  value={
                    <span>
                      {totalConns} / ~{cap.safe}
                    </span>
                  }
                  hint={`Carga relativa: ${ramLoadPct}%`}
                />
                {systemMetrics?.ramUsedGb != null && systemMetrics?.ramTotalGb != null ? (
                  <DashMetric
                    label="RAM do host (os)"
                    value={`${systemMetrics.ramUsedGb} / ${systemMetrics.ramTotalGb} GB`}
                    hint={`${systemMetrics.ram}% do sistema`}
                  />
                ) : (
                  <DashMetric label="RAM do host" value="—" hint="A aguardar métricas" />
                )}
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${ramLoadPct}%`, background: ramBarFill }} />
              </div>
              <details className="group rounded-lg text-[10px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                <summary
                  className="cursor-pointer list-none font-medium text-[10.5px] py-0.5 marker:content-[''] [&::-webkit-details-marker]:hidden flex items-center gap-1"
                  style={{ color: 'var(--text-2)' }}
                >
                  <span className="text-indigo-500/80 group-open:rotate-90 transition-transform inline-block">▸</span>
                  O que isto mede (operador)
                </summary>
                <p className="mt-1.5 pl-3 border-l-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  O contador de sessões é <strong>desta conta</strong>. A RAM e o “~N sessões” referem-se ao
                  <strong> servidor</strong> (heurística, não a regra comercial do plano). Em hospedagem partilhada, a
                  carga <em>real</em> soma <strong>todas</strong> as contas — a referência ~{cap.safe} aplica-se à máquina
                  inteira. Serve para dimensionar memória; não substitui o teto de canais.
                </p>
              </details>
            </div>
          </div>

          {infraLevel !== 'ok' && (
            <div
              className="mx-4 mb-4 pl-3 py-2.5 rounded-r-lg text-[12px] leading-snug"
              style={{
                borderLeftWidth: 3,
                borderLeftStyle: 'solid',
                borderLeftColor: infraLevel === 'critical' ? 'var(--danger)' : 'var(--warning)',
                background: infraLevel === 'critical' ? 'var(--semantic-danger-bg)' : 'var(--semantic-warning-bg)',
                color: 'var(--text-2)'
              }}
            >
              {infraLevel === 'critical' ? (
                <>
                  <strong style={{ color: 'var(--semantic-danger-fg)' }}>Hardware</strong> — canais acima do crítico (
                  {cap.critical}) para esta RAM. Reduza sessões ou aumente memória.
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--semantic-warning-fg)' }}>Hardware</strong> — acima de ~{cap.safe}{' '}
                  sessões com {systemMetrics?.ramTotalGb ?? '?'} GB a estabilidade pode cair. Monitore travamentos.
                </>
              )}
            </div>
          )}
        </div>

        <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="p-1 pt-3">
            <CardHeader
              icon={
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: offlineConnections.length > 0 ? 'var(--semantic-danger-bg)' : 'var(--semantic-success-bg)'
                  }}
                >
                  {offlineConnections.length === 0 ? (
                    <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500" aria-hidden />
                  ) : (
                    <Smartphone className="h-[18px] w-[18px] text-red-500" aria-hidden />
                  )}
                </div>
              }
              title="Canais offline"
              subtitle={
                offlineConnections.length === 0
                  ? 'Todos os canais com sessão ativa no momento.'
                  : 'Reabra a sessão na aba Conexões se permanecer offline.'
              }
              actions={
                <Badge variant={offlineConnections.length > 0 ? 'danger' : 'success'} className="tabular-nums text-[11px]">
                  {offlineConnections.length}
                </Badge>
              }
            />
          </div>
          <div className="px-4 pb-4 max-h-40 space-y-1.5 overflow-y-auto">
            {offlineConnections.length === 0
              ? null
              : offlineConnections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between gap-2 rounded-lg pl-2.5 pr-2 py-2 text-[11.5px]"
                    style={{
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border-subtle)',
                      borderLeftWidth: 2,
                      borderLeftColor: 'var(--semantic-danger-border)'
                    }}
                  >
                    <span className="truncate font-medium min-w-0" style={{ color: 'var(--text-1)' }}>
                      {conn.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                      {conn.lastActivity || '—'}
                    </span>
                  </div>
                ))}
          </div>
        </div>

        <div className="px-2 pb-2">
          <AdminOpsMonitor user={user} />
        </div>
      </Card>
    </div>
  );
};
