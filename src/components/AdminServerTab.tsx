import React, { useMemo, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  ShieldCheck
} from 'lucide-react';
import { useZapMassCore, useZapMassUiSnapshot } from '../context/ZapMassContext';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { ConnectionStatus } from '../types';
import {
  getMaxConnectionSlotsForUser,
  countAccountScopedConnections,
  BASE_CHANNEL_SLOTS,
  MAX_CHANNELS_TOTAL
} from '../utils/connectionLimitPolicy';
import { getChannelCapacity } from '../utils/channelCapacityHeuristic';
import { Badge, RingGauge, PageShell, CollapsibleSection, StatTile } from './ui';
import { AdminOpsMonitor } from './AdminOpsMonitor';
import { AdminVpsMaintenancePanel } from './AdminVpsMaintenancePanel';
import { AdminSendOpsToAssistantButton } from './admin/AdminSendOpsToAssistantButton';
import { AdminConnectionsOverview } from './admin/AdminConnectionsOverview';

export const AdminServerTab: React.FC = () => {
  const { connections, isBackendConnected } = useZapMassCore();
  const { systemMetrics } = useZapMassUiSnapshot();
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

  let headline: string;
  let subHead: ReactNode;
  if (infraLevel === 'critical') {
    headline = 'Servidor no limite (memória)';
    subHead = 'Muitas sessões WhatsApp para a RAM desta máquina.';
  } else if (infraLevel === 'warn') {
    headline = 'Perto do teto de hardware';
    subHead = `Ideal até ~${cap.safe} sessões com ${systemMetrics?.ramTotalGb ?? '?'} GB.`;
  } else if (systemMetrics?.ramTotalGb == null) {
    headline = 'Capacidade do servidor';
    subHead = 'Aguardando métricas de RAM.';
  } else {
    headline = 'Capacidade do servidor';
    subHead = `Plano Pro: ${BASE_CHANNEL_SLOTS} canais · até ${MAX_CHANNELS_TOTAL} com add-on.`;
  }

  const statusBadge: { variant: 'success' | 'warning' | 'danger' | 'neutral'; label: string } = (() => {
    if (infraLevel === 'critical') return { variant: 'danger', label: 'RAM crítica' };
    if (infraLevel === 'warn') return { variant: 'warning', label: 'RAM em aviso' };
    if (systemMetrics?.ramTotalGb == null) return { variant: 'neutral', label: 'A sincronizar' };
    return { variant: 'success', label: 'Situação ok' };
  })();

  return (
    <PageShell
      statusStrip={
        <>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          <Badge variant={isBackendConnected ? 'success' : 'warning'} dot>
            {isBackendConnected ? 'Backend online' : 'Reconectando'}
          </Badge>
          <span className="ui-caption tabular-nums">
            Canais {planScopedCount}/{maxPlanChannelSlots}
          </span>
          {systemMetrics?.ramTotalGb != null && (
            <span className="ui-caption tabular-nums">RAM {systemMetrics.ramTotalGb} GB</span>
          )}
        </>
      }
      actions={<AdminSendOpsToAssistantButton user={user} />}
    >
      <CollapsibleSection
        title={headline}
        summary={typeof subHead === 'string' ? subHead : statusBadge.label}
        defaultOpen
        actions={
          infraLevel === 'ok' ? (
            <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden />
          ) : (
            <AlertTriangle
              className="w-4 h-4"
              style={{ color: infraLevel === 'critical' ? 'var(--danger)' : 'var(--warning)' }}
              aria-hidden
            />
          )
        }
      >
        <div className="space-y-4">
          {typeof subHead !== 'string' && (
            <details className="ui-body">
              <summary className="cursor-pointer ui-caption font-medium" style={{ color: 'var(--text-2)' }}>
                Contrato vs RAM do servidor
              </summary>
              <div className="mt-2 pl-3 ui-caption space-y-2">{subHead}</div>
            </details>
          )}

          <div className="zm-panel-grid zm-panel-grid--2">
            <div className="zm-panel space-y-3">
              <span className="ui-overline">Canais nesta conta</span>
              <StatTile
                label="Em uso"
                value={planScopedCount}
                hint={`Teto no app: ${maxPlanChannelSlots}`}
              />
            </div>

            <div className="zm-panel space-y-3">
              <span className="ui-overline flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" aria-hidden />
                RAM e sessões
              </span>
              <div className="flex flex-wrap justify-center gap-6 pt-1">
                <RingGauge
                  percent={ramLoadPct}
                  label="Sessões × conforto"
                  primary={`${totalConns}/${cap.safe}`}
                  secondary={`${ramLoadPct}%`}
                  size={88}
                  stroke={5}
                />
                {systemMetrics?.ramTotalGb != null && systemMetrics?.ram != null ? (
                  <RingGauge
                    percent={Math.min(100, Math.max(0, systemMetrics.ram))}
                    label="RAM do host"
                    primary={`${Math.round(systemMetrics.ram)}%`}
                    secondary={`${systemMetrics.ramTotalGb} GB`}
                    size={88}
                    stroke={5}
                  />
                ) : null}
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${ramLoadPct}%`, background: ramBarFill }}
                />
              </div>
              <details className="ui-caption">
                <summary className="cursor-pointer" style={{ color: 'var(--text-2)' }}>
                  O que isto mede
                </summary>
                <p className="mt-1.5" style={{ color: 'var(--text-3)' }}>
                  Contador de sessões desta conta. A heurística ~{cap.safe} sessões refere-se ao servidor inteiro
                  (Chromium + WA Web), não substitui o limite comercial do plano.
                </p>
              </details>
            </div>
          </div>

          {infraLevel !== 'ok' && (
            <p
              className="ui-body rounded-lg px-3 py-2.5"
              style={{
                background: infraLevel === 'critical' ? 'var(--semantic-danger-bg)' : 'var(--semantic-warning-bg)',
                color: 'var(--text-2)'
              }}
            >
              {infraLevel === 'critical'
                ? `Acima de ${cap.critical} sessões para esta RAM — reduza canais ou aumente memória.`
                : `Acima de ~${cap.safe} sessões — monitore estabilidade.`}
            </p>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Canais offline"
        summary={
          offlineConnections.length === 0
            ? 'Todos online'
            : `${offlineConnections.length} offline`
        }
        defaultOpen={offlineConnections.length > 0}
        actions={
          <Badge variant={offlineConnections.length > 0 ? 'danger' : 'success'} className="tabular-nums">
            {offlineConnections.length}
          </Badge>
        }
      >
        {offlineConnections.length === 0 ? (
          <div className="zm-panel flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden />
            <p className="ui-body font-medium">Todos os canais com sessão ativa</p>
          </div>
        ) : (
          <ul className="space-y-2 max-h-44 overflow-y-auto">
            {offlineConnections.map((conn) => (
              <li
                key={conn.id}
                className="zm-panel flex items-center justify-between gap-3 py-2.5"
                style={{ borderLeft: '3px solid var(--semantic-danger-border)' }}
              >
                <span className="truncate font-medium ui-body" style={{ color: 'var(--text-1)' }}>
                  {conn.name}
                </span>
                <span className="ui-caption tabular-nums shrink-0">{conn.lastActivity || '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <AdminVpsMaintenancePanel user={user} />
      <AdminOpsMonitor user={user} />
      <AdminConnectionsOverview user={user} />
    </PageShell>
  );
};
