import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  Megaphone,
  Radio,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CollapsibleSection, Badge, Button } from '../ui';
import {
  fetchChipProtection,
  setChipProtectionPolicy,
  type ChipProtectionConnectionRow,
  type ChipProtectionFeedItem,
  type ChipProtectionPolicy,
  type ChipProtectionSnapshot,
} from '../../services/chipProtectionApi';

const POLL_MS = 10_000;

const POLICY_OPTIONS: Array<{
  value: ChipProtectionPolicy;
  label: string;
  short: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    value: 'auto',
    label: 'Automático',
    short: 'Recomendado',
    description: 'Quietos sem campanha; libera ao disparar; reforça após ban ou quedas.',
    icon: <ShieldCheck className="w-4 h-4" />,
  },
  {
    value: 'always',
    label: 'Sempre protegido',
    short: 'Máximo',
    description: 'Sync leve e automações pausadas — mesmo durante campanhas.',
    icon: <Shield className="w-4 h-4" />,
  },
  {
    value: 'off',
    label: 'Desligado',
    short: 'Avançado',
    description: 'Sem proteção automática. Use só se souber o risco.',
    icon: <ShieldAlert className="w-4 h-4" />,
  },
];

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000) return 'agora';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`;
  return `${Math.floor(diff / 60_000)}min atrás`;
}

type StatusVisual = {
  label: string;
  sub: string;
  gradient: string;
  border: string;
  glow: string;
  icon: React.ReactNode;
  badge: 'success' | 'warning' | 'neutral' | 'danger';
};

function resolveStatusVisual(data: ChipProtectionSnapshot): StatusVisual {
  const reason = data.protectionReason;
  if (reason === 'ban_cooldown') {
    return {
      label: 'Cooldown pós-ban',
      sub: data.protectionReasonLabel,
      gradient: 'linear-gradient(135deg, rgba(239,68,68,0.14), rgba(127,29,29,0.06))',
      border: 'rgba(239,68,68,0.35)',
      glow: 'rgba(239,68,68,0.2)',
      icon: <ShieldAlert className="w-6 h-6 text-red-400" />,
      badge: 'danger',
    };
  }
  if (reason === 'reconnect_storm') {
    return {
      label: 'Proteção reforçada',
      sub: 'Instabilidade — várias quedas seguidas',
      gradient: 'linear-gradient(135deg, rgba(245,158,11,0.14), rgba(180,83,9,0.06))',
      border: 'rgba(245,158,11,0.35)',
      glow: 'rgba(245,158,11,0.18)',
      icon: <Activity className="w-6 h-6 text-amber-400" />,
      badge: 'warning',
    };
  }
  if (data.chipQuietMode && reason === 'policy_auto_idle') {
    return {
      label: 'Chips quietos',
      sub: 'Sem campanha — jornada e nutrição pausadas',
      gradient: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.05))',
      border: 'rgba(16,185,129,0.3)',
      glow: 'rgba(16,185,129,0.15)',
      icon: <ShieldCheck className="w-6 h-6 text-emerald-400" />,
      badge: 'success',
    };
  }
  if (data.chipQuietMode) {
    return {
      label: 'Protegido',
      sub: data.protectionReasonLabel,
      gradient: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.05))',
      border: 'rgba(16,185,129,0.3)',
      glow: 'rgba(16,185,129,0.15)',
      icon: <ShieldCheck className="w-6 h-6 text-emerald-400" />,
      badge: 'success',
    };
  }
  if (data.campaigns.activeCount > 0) {
    return {
      label: 'Monitorando disparo',
      sub: `${data.campaigns.activeCount} campanha(s) — anti-ban ativo`,
      gradient: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.06))',
      border: 'rgba(99,102,241,0.35)',
      glow: 'rgba(99,102,241,0.15)',
      icon: <Radio className="w-6 h-6 text-indigo-400" />,
      badge: 'neutral',
    };
  }
  return {
    label: 'Envios liberados',
    sub: 'Nenhuma trava de proteção no momento',
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(37,99,235,0.04))',
    border: 'rgba(59,130,246,0.25)',
    glow: 'rgba(59,130,246,0.12)',
    icon: <Shield className="w-6 h-6 text-blue-400" />,
    badge: 'neutral',
  };
}

const SyncIntensityBar: React.FC<{ data: ChipProtectionSnapshot }> = ({ data }) => {
  const quiet = data.chipQuietMode;
  const pct = quiet
    ? data.sync.fullHistory
      ? 55
      : 28
    : data.sync.fullHistory
      ? 100
      : 72;
  const color = pct >= 80 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#10b981';
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs">
        <span className="ui-overline">Intensidade do sync / stress no chip</span>
        <span className="font-semibold tabular-nums" style={{ color }}>
          {quiet ? 'Modo leve' : 'Normal'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800/80 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }}
        />
      </div>
      <p className="ui-caption">
        Prefetch: {data.sync.sparseConvLimit} conversas × {data.sync.msgPrefetch} msgs
        {data.sync.fullHistory ? ' · histórico completo ligado' : ' · histórico reduzido'}
      </p>
    </div>
  );
};

const ChipHealthCard: React.FC<{ row: ChipProtectionConnectionRow }> = ({ row }) => {
  const online = row.status === 'CONNECTED' || row.status === 'CONNECTING';
  const stateColor =
    row.inQuarantine || row.circuitState === 'OPEN'
      ? '#ef4444'
      : row.circuitState === 'HALF_OPEN'
        ? '#f59e0b'
        : online
          ? '#10b981'
          : '#71717a';

  return (
    <div
      className="rounded-xl p-3 border transition-colors"
      style={{
        borderColor: `${stateColor}33`,
        background: `linear-gradient(145deg, ${stateColor}08, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{row.name}</p>
          <p className="ui-caption truncate">{row.id}</p>
        </div>
        {online ? (
          <Wifi className="w-4 h-4 shrink-0 text-emerald-500" />
        ) : (
          <WifiOff className="w-4 h-4 shrink-0 text-zinc-500" />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={online ? 'success' : 'neutral'}>{online ? 'Online' : row.status}</Badge>
        {row.circuitState !== 'CLOSED' && (
          <Badge variant="warning">CB {row.circuitState === 'OPEN' ? 'aberto' : 'recuperando'}</Badge>
        )}
        {row.inQuarantine && <Badge variant="danger">Quarentena</Badge>}
        {row.banCount > 0 && (
          <Badge variant="neutral">{row.banCount} ban(s)</Badge>
        )}
      </div>
      {(row.failuresWindow > 0 || row.inQuarantine) && (
        <p className="ui-caption mt-2 text-amber-600 dark:text-amber-400">
          {row.inQuarantine && row.quarantineUntil
            ? `Quarentena até ${new Date(row.quarantineUntil).toLocaleString('pt-BR')}`
            : `${row.failRatePct}% falhas (${row.failuresWindow}/${row.sentWindow + row.failuresWindow})`}
        </p>
      )}
    </div>
  );
};

const FeedTimeline: React.FC<{ items: ChipProtectionFeedItem[] }> = ({ items }) => {
  if (!items.length) {
    return (
      <p className="ui-caption text-center py-4">Nenhum evento recente — sistema estável.</p>
    );
  }
  const levelColor: Record<ChipProtectionFeedItem['level'], string> = {
    ok: '#10b981',
    info: '#3b82f6',
    warn: '#f59e0b',
    danger: '#ef4444',
  };
  return (
    <ul className="space-y-0 max-h-52 overflow-y-auto pr-1">
      {items.map((item, i) => (
        <li key={`${item.at}-${i}`} className="flex gap-3 py-2.5 border-b border-zinc-800/60 last:border-0">
          <div className="flex flex-col items-center pt-1">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: levelColor[item.level], boxShadow: `0 0 8px ${levelColor[item.level]}66` }}
            />
            {i < items.length - 1 && <span className="w-px flex-1 bg-zinc-700/50 mt-1 min-h-[12px]" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">{item.title}</p>
            {item.detail && <p className="ui-caption mt-0.5">{item.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
};

export const ChipProtectionPanel: React.FC = () => {
  const [data, setData] = useState<ChipProtectionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const snap = await fetchChipProtection();
      setData(snap);
    } catch (err) {
      if (!silent) toast.error((err as Error).message || 'Erro ao carregar proteção.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const changePolicy = async (policy: ChipProtectionPolicy) => {
    if (!data || data.chipProtectionPolicy === policy) return;
    setSaving(true);
    try {
      const snap = await setChipProtectionPolicy(policy);
      setData(snap);
      toast.success(
        policy === 'auto'
          ? 'Proteção automática ativada.'
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

  const visual = useMemo(() => (data ? resolveStatusVisual(data) : null), [data]);

  const lockRemaining = useMemo(() => {
    if (!data?.protectionLockUntil) return null;
    const ms = new Date(data.protectionLockUntil).getTime() - Date.now();
    return ms > 0 ? ms : 0;
  }, [data?.protectionLockUntil, tick]);

  const summary = data?.chipQuietMode
    ? data.protectionReason === 'reconnect_storm'
      ? 'Instabilidade'
      : data.protectionReasonLabel
    : data?.campaigns.activeCount
      ? 'Monitorando'
      : 'Ativo';

  return (
    <CollapsibleSection title="Proteção automática de chips" summary={summary} defaultOpen>
      <div className="space-y-5">
        {/* Hero status */}
        {visual && data && (
          <div
            className="relative overflow-hidden rounded-2xl p-5 border"
            style={{
              background: visual.gradient,
              borderColor: visual.border,
              boxShadow: `0 12px 40px ${visual.glow}`,
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="p-3 rounded-xl"
                  style={{ background: `${visual.glow}`, border: `1px solid ${visual.border}` }}
                >
                  {visual.icon}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold">{visual.label}</h3>
                    <Badge variant={visual.badge === 'danger' ? 'danger' : visual.badge}>
                      {visual.badge === 'success' ? 'Protegido' : visual.badge === 'warning' ? 'Reforçado' : 'Live'}
                    </Badge>
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Ao vivo
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300">{visual.sub}</p>
                  {lockRemaining != null && lockRemaining > 0 && (
                    <p className="flex items-center gap-1.5 text-sm text-amber-400 mt-2 font-medium">
                      <Clock className="w-4 h-4" />
                      Reforço termina em {formatCountdown(lockRemaining)}
                    </p>
                  )}
                  {data.fetchedAt && (
                    <p className="ui-caption mt-2 opacity-70">
                      Atualizado {formatAgo(data.fetchedAt)} · próxima checagem em {POLL_MS / 1000}s
                    </p>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        )}

        {/* Métricas rápidas */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                icon: <Megaphone className="w-4 h-4 text-indigo-400" />,
                label: 'Campanhas',
                value: data.campaigns.activeCount,
                hint: data.campaignProtection?.pausedByProtection.length
                  ? `${data.campaignProtection.pausedByProtection.length} pausada(s)`
                  : data.campaigns.activeCount ? 'Em execução' : 'Nenhuma',
              },
              {
                icon: <Flame className="w-4 h-4 text-orange-400" />,
                label: 'Jornada',
                value: data.nurture.dueEnrollments,
                hint: data.nurture.pausedByQuiet ? 'Bloqueada' : data.nurture.journeyEnabled ? 'Liberada' : 'Off',
                warn: data.nurture.pausedByQuiet,
              },
              {
                icon: <Zap className="w-4 h-4 text-amber-400" />,
                label: 'Aquecimento',
                value: data.autoWarmup.active ? data.autoWarmup.connectionIds.length : '—',
                hint: data.autoWarmup.active ? 'Ativo no servidor' : 'Parado',
              },
              {
                icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
                label: 'Chips',
                value: data.connections?.length ?? 0,
                hint: `${data.connections?.filter((c) => c.status === 'CONNECTED').length ?? 0} online`,
              },
            ].map((m) => (
              <div key={m.label} className={`zm-panel p-3 ${m.warn ? 'ring-1 ring-amber-500/30' : ''}`}>
                <div className="flex items-center gap-1.5 mb-1 text-zinc-400">{m.icon}<span className="ui-overline">{m.label}</span></div>
                <p className="text-xl font-bold tabular-nums">{m.value}</p>
                <p className="ui-caption">{m.hint}</p>
              </div>
            ))}
          </div>
        )}

        {/* Saúde por chip */}
        {data && data.connections.length > 0 && (
          <div>
            <p className="ui-overline px-1 mb-2 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" />
              Saúde dos chips (circuit breaker · quarentena)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.connections.map((row) => (
                <ChipHealthCard key={row.id} row={row} />
              ))}
            </div>
          </div>
        )}

        {/* Feed ao vivo + sync */}
        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="zm-panel p-4">
              <p className="ui-overline mb-3 flex items-center gap-2">
                <Radio className="w-3.5 h-3.5 text-indigo-400" />
                Monitor anti-ban · tempo real
              </p>
              <FeedTimeline items={data.liveFeed ?? []} />
            </div>
            <div className="zm-panel p-4 space-y-4">
              <SyncIntensityBar data={data} />
              {data.risks.length > 0 && (
                <ul className="space-y-2 pt-2 border-t border-zinc-800">
                  {data.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {r.level === 'warn' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                      )}
                      <span className="text-zinc-300">{r.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Política */}
        <div>
          <p className="ui-overline px-1 mb-2">Política de proteção</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {POLICY_OPTIONS.map((opt) => {
              const selected = data?.chipProtectionPolicy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving || loading}
                  onClick={() => void changePolicy(opt.value)}
                  className={`text-left rounded-xl p-4 border transition-all ${
                    selected
                      ? 'border-emerald-500/50 bg-emerald-500/8 ring-1 ring-emerald-500/30'
                      : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {opt.icon}
                      {opt.label}
                    </span>
                    {selected && <Badge variant="success">Ativo</Badge>}
                    {!selected && opt.value === 'auto' && (
                      <span className="text-[10px] text-emerald-500 font-bold">{opt.short}</span>
                    )}
                  </div>
                  <p className="ui-caption leading-relaxed">{opt.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {data?.campaignProtection?.pausedByProtection.map((p) => (
          <div key={p.campaignId} className="rounded-xl p-4 border-l-4 border-amber-500 bg-amber-500/5">
            <p className="text-sm font-semibold">Campanha pausada · {p.campaignId}</p>
            <p className="ui-caption mt-1">{p.message || p.reason}</p>
            {p.autoResumeAt && (
              <p className="ui-caption text-amber-500 mt-2">
                Retomada automática: {new Date(p.autoResumeAt).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        ))}

        {data?.recommendations.length ? (
          <div className="ui-caption space-y-1 border-t border-zinc-800 pt-3 opacity-80">
            {data.recommendations.map((rec, i) => (
              <p key={i}>• {rec}</p>
            ))}
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
};
