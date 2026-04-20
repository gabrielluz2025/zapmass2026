import React, { useEffect, useMemo, useState } from 'react';
import { Code2, ExternalLink, RefreshCw, Shield, Wrench, AlertTriangle, Lock } from 'lucide-react';
import { Button, Card } from '../ui';
import { useMainLayoutNav } from '../../context/MainLayoutNavContext';
import { useZapMass } from '../../context/ZapMassContext';

type HealthJson = { status?: string; serverTime?: string; version?: string } | null;
type VersionJson = { version?: string; startedAt?: string; environment?: string } | null;
type AuditRange = '1h' | '24h' | '7d';
type Severity = 'critical' | 'high' | 'medium' | 'low';

const actionSeverity = (action: string): Severity => {
  const normalized = action.toLowerCase();
  if (normalized.includes('delete-connection') || normalized.includes('start-campaign') || normalized.includes('send-message')) {
    return 'critical';
  }
  if (normalized.includes('pause-campaign') || normalized.includes('resume-campaign') || normalized.includes('reconnect-connection')) {
    return 'high';
  }
  if (normalized.includes('load-chat-history') || normalized.includes('fetch-conversation-picture') || normalized.includes('load-message-media')) {
    return 'medium';
  }
  return 'low';
};

const severityStyles: Record<Severity, { chipBg: string; chipColor: string; bar: string }> = {
  critical: {
    chipBg: 'rgba(239,68,68,0.14)',
    chipColor: '#ef4444',
    bar: 'linear-gradient(90deg, rgba(239,68,68,0.88), rgba(220,38,38,0.9))'
  },
  high: {
    chipBg: 'rgba(249,115,22,0.14)',
    chipColor: '#f97316',
    bar: 'linear-gradient(90deg, rgba(249,115,22,0.88), rgba(234,88,12,0.9))'
  },
  medium: {
    chipBg: 'rgba(245,158,11,0.14)',
    chipColor: '#f59e0b',
    bar: 'linear-gradient(90deg, rgba(245,158,11,0.88), rgba(217,119,6,0.9))'
  },
  low: {
    chipBg: 'rgba(59,130,246,0.14)',
    chipColor: '#3b82f6',
    bar: 'linear-gradient(90deg, rgba(59,130,246,0.84), rgba(37,99,235,0.88))'
  }
};

export const CreatorStudio: React.FC = () => {
  const goTo = useMainLayoutNav();
  const { systemLogs } = useZapMass();
  const [health, setHealth] = useState<HealthJson>(null);
  const [version, setVersion] = useState<VersionJson>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auditRange, setAuditRange] = useState<AuditRange>('24h');

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [h, v] = await Promise.all([
        fetch('/api/health').then((r) => r.json()),
        fetch('/api/version').then((r) => r.json())
      ]);
      setHealth(h);
      setVersion(v);
    } catch {
      setErr('Nao foi possivel ler /api/health ou /api/version (servidor rodando na porta 3001?).');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const securityLogs = useMemo(() => {
    const now = Date.now();
    const rangeMs =
      auditRange === '1h'
        ? 60 * 60 * 1000
        : auditRange === '24h'
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
    return systemLogs
      .filter((l) => l.event === 'security:cross-tenant-blocked')
      .filter((l) => {
        const ts = new Date(l.timestamp).getTime();
        return Number.isFinite(ts) && now - ts <= rangeMs;
      })
      .slice(0, 80);
  }, [systemLogs, auditRange]);

  const auditSummary = useMemo(() => {
    const actionCount: Record<string, number> = {};
    securityLogs.forEach((log) => {
      const payload = (log.payload || {}) as Record<string, unknown>;
      const action = typeof payload.action === 'string' && payload.action.trim() ? payload.action : 'unknown';
      actionCount[action] = (actionCount[action] || 0) + 1;
    });
    const topActions = Object.entries(actionCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return {
      total: securityLogs.length,
      uniqueActions: Object.keys(actionCount).length,
      topActions
    };
  }, [securityLogs]);

  const exportAuditJson = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      range: auditRange,
      total: securityLogs.length,
      events: securityLogs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zapmass-auditoria-${auditRange}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-10">
      <div
        className="rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2"
        style={{ borderColor: 'rgba(59,130,246,0.35)', background: 'rgba(59,130,246,0.08)' }}
      >
        <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
          <Code2 className="w-4 h-4 text-blue-500 shrink-0" />
          Estudio do criador
        </div>
        <p className="text-[12px] leading-relaxed flex-1" style={{ color: 'var(--text-2)' }}>
          Ambiente interno para evoluir o ZapMass sem limitar-se ao que o cliente ve. O painel do cliente continua
          igual; use isto para prototipar, consultar API e abrir o painel de configuracao remota.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-500" />
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
              Config remota (Firestore)
            </h2>
          </div>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Precos de marketing, duracao do teste, textos da landing — documento{' '}
            <span className="font-mono text-[11px]">appConfig/global</span>.
          </p>
          <Button variant="primary" leftIcon={<Shield className="w-4 h-4" />} onClick={() => goTo('admin')}>
            Abrir painel do criador
          </Button>
        </Card>

        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-500" />
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
              Ajustes do app
            </h2>
          </div>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Mesmas configuracoes que o usuario final acessa; util para comparar comportamento.
          </p>
          <Button variant="secondary" onClick={() => goTo('settings')}>
            Abrir configuracoes
          </Button>
        </Card>
      </div>

      <Card className="p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
            API local
          </h2>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={loading}
            leftIcon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
            onClick={() => void load()}
          >
            Atualizar
          </Button>
        </div>
        {err && (
          <p className="text-[12px] text-red-500" role="alert">
            {err}
          </p>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
              GET /api/health
            </p>
            <pre
              className="text-[11px] p-3 rounded-lg overflow-auto max-h-40 font-mono"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
            >
              {health ? JSON.stringify(health, null, 2) : loading ? '...' : '—'}
            </pre>
            <a
              href="/api/health"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] mt-2 font-semibold text-emerald-600 hover:underline"
            >
              Abrir no navegador <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
              GET /api/version
            </p>
            <pre
              className="text-[11px] p-3 rounded-lg overflow-auto max-h-40 font-mono"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
            >
              {version ? JSON.stringify(version, null, 2) : loading ? '...' : '—'}
            </pre>
            <a
              href="/api/version"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] mt-2 font-semibold text-emerald-600 hover:underline"
            >
              Abrir no navegador <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
              Modo auditoria (isolamento entre clientes)
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={auditRange}
              onChange={(e) => setAuditRange(e.target.value as AuditRange)}
              className="text-[11px] px-2 py-1.5 rounded-md border bg-transparent"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-2)' }}
              title="Periodo da auditoria"
            >
              <option value="1h">Ultima 1h</option>
              <option value="24h">Ultimas 24h</option>
              <option value="7d">Ultimos 7 dias</option>
            </select>
            <Button variant="secondary" size="sm" type="button" onClick={exportAuditJson} disabled={securityLogs.length === 0}>
              Exportar JSON
            </Button>
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--text-2)' }}>
          Registra tentativas bloqueadas de acesso cruzado (um usuario tentando usar conexao/conversa/campanha que nao
          pertence a ele). Esses eventos chegam pelo socket e aparecem somente para o proprio usuario.
        </p>
        <div className="grid sm:grid-cols-3 gap-2 mb-3">
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Bloqueios no periodo
            </div>
            <div className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>
              {auditSummary.total}
            </div>
          </div>
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Tipos de acao
            </div>
            <div className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>
              {auditSummary.uniqueActions}
            </div>
          </div>
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Acao mais frequente
            </div>
            <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              {auditSummary.topActions[0]?.[0] || '—'}
            </div>
          </div>
        </div>
        {auditSummary.topActions.length > 0 && (
          <div
            className="rounded-lg px-3 py-2.5 mb-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
              Top acoes bloqueadas
            </p>
            <div className="flex flex-wrap gap-1.5">
              {auditSummary.topActions.map(([action, count]) => {
                const severity = actionSeverity(action);
                const color = severityStyles[severity];
                return (
                  <span
                    key={action}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
                    style={{ background: color.chipBg, color: color.chipColor }}
                    title={`Severidade: ${severity}`}
                  >
                    <span className="font-mono">{action}</span>
                    <span className="font-bold">{count}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {auditSummary.topActions.length > 0 && (
          <div
            className="rounded-lg px-3 py-2.5 mb-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
              Distribuicao por acao (top 5)
            </p>
            <div className="space-y-2">
              {auditSummary.topActions.map(([action, count], idx) => {
                const max = auditSummary.topActions[0]?.[1] || 1;
                const width = Math.max(8, Math.round((count / max) * 100));
                const severity = actionSeverity(action);
                const color = severityStyles[severity];
                return (
                  <div key={`${action}-${idx}`} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono truncate max-w-[75%]" style={{ color: color.chipColor }}>
                        {action}
                      </span>
                      <span className="font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                        {count}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${width}%`,
                          background: color.bar
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {securityLogs.length === 0 ? (
          <div
            className="rounded-lg px-3 py-2.5 text-[12px] flex items-center gap-2"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-3)' }}
          >
            <Lock className="w-4 h-4 text-emerald-600" />
            Nenhuma tentativa bloqueada recente.
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {securityLogs.map((log, idx) => (
              <div
                key={`${log.timestamp}-${idx}`}
                className="rounded-lg px-3 py-2 text-[11.5px] font-mono"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
              >
                <div className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  {new Date(log.timestamp).toLocaleString('pt-BR')}
                </div>
                <div>{JSON.stringify(log.payload || {}, null, 0)}</div>
              </div>
            ))}
          </div>
        )}

        <h2 className="text-[15px] font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          Proximas extensoes
        </h2>
        <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--text-2)' }}>
          Voce pode acrescentar aqui novas abas ou ferramentas (ex.: inspecao de socket, seeds, migracoes) sem poluir o
          fluxo do cliente. O codigo fica em <span className="font-mono text-[11px]">src/components/creator/</span>.
        </p>
        <ul className="text-[12px] space-y-1 list-disc pl-5" style={{ color: 'var(--text-3)' }}>
          <li>Eventos Socket.IO e logs de campanha</li>
          <li>Atalhos para colecoes Firestore (somente leitura)</li>
          <li>Feature flags experimentais</li>
        </ul>
      </Card>
    </div>
  );
};
