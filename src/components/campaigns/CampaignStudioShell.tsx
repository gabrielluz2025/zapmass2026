/**
 * Broadcast Studio — layout novo da aba Campanhas.
 * Visual distinto do antigo cockpit escuro: painéis claros, acento índigo/laranja,
 * navegação lateral e faixa de saúde compacta.
 */
import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  LayoutGrid,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Campaign, CampaignStatus, ConnectionStatus, WhatsAppConnection } from '../../types';
import { getCampaignProgressMetrics } from '../../utils/campaignMetrics';
import { DispatchFixPanel } from './DispatchFixPanel';
import { useDispatchHealth } from './useDispatchHealth';
import { useAuth } from '../../context/AuthContext';
import { isPlatformAdminUser } from '../../utils/adminAccess';

export type CampaignStudioTab = 'overview' | 'mission' | 'campaigns' | 'create';

type NavItem = {
  id: CampaignStudioTab;
  label: string;
  hint: string;
  icon: React.ReactNode;
  badge?: string;
};

interface Props {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  subTab: CampaignStudioTab;
  onSubTabChange: (tab: CampaignStudioTab) => void;
  onCreate: () => void;
  onOpenDetails: (id: string) => void;
  children: React.ReactNode;
}

export const CampaignStudioShell: React.FC<Props> = ({
  campaigns,
  connections,
  subTab,
  onSubTabChange,
  onCreate,
  onOpenDetails,
  children,
}) => {
  const { health, ui: healthUi, check } = useDispatchHealth();
  const { user } = useAuth();
  const isAdmin = isPlatformAdminUser(user);

  const stats = useMemo(() => {
    const running = campaigns.filter((c) => c.status === CampaignStatus.RUNNING);
    const scheduled = campaigns.filter((c) => c.status === CampaignStatus.SCHEDULED);
    const onlineChips = connections.filter((c) => c.status === ConnectionStatus.CONNECTED);
    const sentToday = campaigns.reduce((a, c) => a + c.successCount, 0);
    return { running, scheduled, onlineChips, sentToday, total: campaigns.length };
  }, [campaigns, connections]);

  const ready = (healthUi === 'ok' || healthUi === 'reconnecting') && stats.onlineChips.length > 0;

  const motorTitle =
    healthUi === 'checking'
      ? 'Sincronizando…'
      : healthUi === 'reconnecting'
      ? 'Reconectando ao servidor…'
      : ready
      ? 'Pronto para disparar'
      : healthUi === 'error'
      ? isAdmin
        ? health?.reachable === false
          ? 'Conexão instável'
          : 'Fila indisponível'
        : 'Preparando envio…'
      : 'Conecte um chip WhatsApp';

  const showErrorPanel = healthUi === 'error' && isAdmin;
  const errorPanelMode =
    health?.reachable === false || health?.kind === 'network' ? ('network' as const) : ('redis' as const);

  const nav: NavItem[] = [
    { id: 'overview', label: 'Painel', hint: 'Métricas e pulso', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'mission', label: 'Operações', hint: 'Controle ao vivo', icon: <LayoutGrid className="w-4 h-4" /> },
    { id: 'campaigns', label: 'Campanhas', hint: 'Lista e calendário', icon: <Send className="w-4 h-4" />, badge: String(stats.total) },
    { id: 'create', label: 'Nova', hint: 'Assistente', icon: <Sparkles className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 pb-24 lg:pb-10">
      {/* ── Navegação lateral ── */}
      <aside
        className="lg:w-[210px] shrink-0 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0"
        style={{ scrollbarWidth: 'none' }}
      >
        <div
          className="hidden lg:flex items-center gap-2.5 px-3 py-3 mb-2 rounded-2xl"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #06B6D4, #06B6D4)' }}
          >
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-black truncate" style={{ color: 'var(--text-1)' }}>
              Broadcast
            </p>
            <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
              Studio de campanhas
            </p>
          </div>
        </div>

        {nav.map((item) => {
          const active = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === 'create') onCreate();
                else onSubTabChange(item.id);
              }}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all shrink-0 lg:shrink lg:w-full"
              style={{
                background: active ? 'rgba(99,102,241,0.14)' : 'transparent',
                border: active ? '1px solid rgba(99,102,241,0.35)' : '1px solid transparent',
                color: active ? '#818cf8' : 'var(--text-2)',
              }}
            >
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: active ? 'rgba(99,102,241,0.2)' : 'var(--surface-1)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {item.icon}
              </span>
              <span className="hidden sm:block lg:block min-w-0 flex-1">
                <span className="text-[12.5px] font-bold block truncate">{item.label}</span>
                <span className="text-[10px] block truncate" style={{ color: 'var(--text-3)' }}>
                  {item.hint}
                </span>
              </span>
              {item.badge && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onCreate}
          className="hidden lg:flex items-center justify-center gap-2 mt-3 px-3 py-2.5 rounded-xl text-[12px] font-bold text-white transition-transform hover:scale-[1.02]"
          style={{
            background: 'linear-gradient(135deg, #06B6D4, #06B6D4)',
            boxShadow: '0 8px 24px -8px rgba(99,102,241,0.55)',
          }}
        >
          <Plus className="w-4 h-4" />
          Nova campanha
        </button>
      </aside>

      {/* ── Área principal ── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header + saúde */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="px-4 py-3.5 sm:px-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>
                Status do motor
              </p>
              <p className="text-[15px] font-black mt-0.5" style={{ color: 'var(--text-1)' }}>
                {motorTitle}
              </p>
              {healthUi === 'reconnecting' && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Mantendo o último status estável — nova verificação em andamento.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label="Redis"
                ok={healthUi === 'ok'}
                warn={healthUi === 'reconnecting'}
                checking={healthUi === 'checking'}
                sub={health?.redis.pingMs != null ? `${health.redis.pingMs}ms` : undefined}
              />
              <StatusPill
                label="Chips"
                ok={stats.onlineChips.length > 0}
                value={`${stats.onlineChips.length}/${connections.length}`}
              />
              <StatusPill
                label="Fila"
                ok={healthUi === 'ok'}
                warn={healthUi === 'reconnecting'}
                value={String(stats.running.length)}
              />
              <button
                type="button"
                onClick={() => void check()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
                style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${healthUi === 'checking' ? 'animate-spin' : ''}`} />
                Reverificar
              </button>
            </div>
          </div>

          {showErrorPanel && (
            <div className="px-4 pb-4 sm:px-5">
              <DispatchFixPanel
                compact
                mode={errorPanelMode}
                fixCommand={health?.fixCommand}
                detail={
                  errorPanelMode === 'redis'
                    ? health?.redis.misconfigHint ?? health?.redis.error
                    : health?.redis.error
                }
                onRetry={() => void check()}
              />
            </div>
          )}

          {(healthUi === 'ok' || healthUi === 'reconnecting') && (
            <div
              className="h-[2px]"
              style={{
                background:
                  healthUi === 'reconnecting'
                    ? 'linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)'
                    : 'linear-gradient(90deg, #06B6D4, #22d3ee, #06B6D4)',
              }}
            />
          )}
        </div>

        {/* KPI bento */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            { label: 'Em execução', val: stats.running.length, icon: <Activity className="w-4 h-4" />, tone: '#22c55e' },
            { label: 'Agendadas', val: stats.scheduled.length, icon: <Radio className="w-4 h-4" />, tone: '#06B6D4' },
            { label: 'Enviadas (total)', val: stats.sentToday, icon: <Send className="w-4 h-4" />, tone: '#f97316' },
            { label: 'Canais online', val: stats.onlineChips.length, icon: <Zap className="w-4 h-4" />, tone: '#06b6d4' },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-xl px-3 py-3 flex flex-col gap-1.5"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <span style={{ color: k.tone }}>{k.icon}</span>
              <span className="text-[22px] font-black tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                {k.val}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                {k.label}
              </span>
            </div>
          ))}
        </div>

        {/* Missões ativas — compacto */}
        {stats.running.length > 0 && (
          <div
            className="rounded-xl px-3 py-3 space-y-2"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)' }}
          >
            <p className="text-[9px] font-extrabold uppercase tracking-widest" style={{ color: '#818cf8' }}>
              Ao vivo agora
            </p>
            {stats.running.slice(0, 2).map((c) => {
              const m = getCampaignProgressMetrics(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenDetails(c.id)}
                  className="w-full flex items-center gap-3 text-left rounded-lg px-2 py-1.5 hover:opacity-90"
                >
                  <span className="text-[13px] font-bold truncate flex-1" style={{ color: 'var(--text-1)' }}>
                    {c.name}
                  </span>
                  <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-0)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${m.progressPct}%`, background: 'linear-gradient(90deg, #06B6D4, #22d3ee)' }}
                    />
                  </div>
                  <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: '#818cf8' }}>
                    {m.progressPct}%
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Conteúdo da sub-aba */}
        <div className="animate-fade-in-up">{children}</div>
      </div>
    </div>
  );
};

const StatusPill: React.FC<{
  label: string;
  ok: boolean;
  warn?: boolean;
  checking?: boolean;
  value?: string;
  sub?: string;
}> = ({ label, ok, warn, checking, value, sub }) => {
  const tone = checking ? 'checking' : warn ? 'warn' : ok ? 'ok' : 'bad';
  const styles = {
    checking: {
      bg: 'var(--surface-0)',
      border: 'var(--border-subtle)',
      color: 'var(--text-3)',
    },
    warn: {
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.35)',
      color: '#f59e0b',
    },
    ok: {
      bg: 'rgba(34,197,94,0.12)',
      border: 'rgba(34,197,94,0.3)',
      color: '#22c55e',
    },
    bad: {
      bg: 'rgba(239,68,68,0.12)',
      border: 'rgba(239,68,68,0.3)',
      color: '#ef4444',
    },
  }[tone];

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
      style={{
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        color: styles.color,
      }}
    >
      {checking ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : warn ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : ok ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <AlertTriangle className="w-3 h-3" />
      )}
      {label}
      {value && <span className="tabular-nums">{value}</span>}
      {sub && <span className="font-normal opacity-70 tabular-nums">{sub}</span>}
    </div>
  );
};
