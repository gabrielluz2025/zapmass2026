import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Loader2, Network, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card } from '../ui';
import {
  fetchAgentActivityAdmin,
  fetchAgentConfigAdmin,
  fetchAgentRegistry,
  patchAgentConfigAdmin,
  type AgentActivityEntry,
  type AgentConfig,
  type AgentRegistryPayload
} from '../../services/agentApi';

type ScreenOverride = NonNullable<AgentConfig['screenAgentOverrides']>[number];

function mergeOverrides(
  registry: AgentRegistryPayload,
  config: AgentConfig
): ScreenOverride[] {
  const byKey = new Map((config.screenAgentOverrides ?? []).map((o) => [o.screenKey, { ...o }]));
  return registry.screenAgents.map((a) => {
    const existing = byKey.get(a.screenKey);
    return {
      screenKey: a.screenKey,
      systemPromptExtra: existing?.systemPromptExtra ?? a.systemPromptExtra ?? '',
      enabledTools: existing?.enabledTools ?? a.enabledTools,
      tags: existing?.tags ?? a.tags,
      enabled: existing?.enabled !== false && a.enabled
    };
  });
}

export const AgentControlPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [registry, setRegistry] = useState<AgentRegistryPayload | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [overrides, setOverrides] = useState<ScreenOverride[]>([]);
  const [orchExtra, setOrchExtra] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>('dashboard');
  const [activity, setActivity] = useState<AgentActivityEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reg, cfgRes, actRes] = await Promise.all([
        fetchAgentRegistry(),
        fetchAgentConfigAdmin(),
        fetchAgentActivityAdmin(25)
      ]);
      setRegistry(reg);
      if (cfgRes.ok && cfgRes.config) {
        setConfig(cfgRes.config);
        setOverrides(mergeOverrides(reg, cfgRes.config));
        setOrchExtra(cfgRes.config.orchestratorOverride?.systemPromptExtra ?? reg.orchestrator.systemPromptExtra);
      }
      if (actRes.ok) setActivity(actRes.entries);
    } catch {
      toast.error('Não foi possível carregar o painel de agentes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchAgentActivityAdmin(25)
        .then((r) => {
          if (r.ok) setActivity(r.entries);
        })
        .catch(() => undefined);
    }, 12_000);
    return () => window.clearInterval(id);
  }, []);

  const selectedAgent = useMemo(() => {
    return registry?.screenAgents.find((a) => a.screenKey === selectedKey) ?? null;
  }, [registry, selectedKey]);

  const selectedOverride = useMemo(() => {
    return overrides.find((o) => o.screenKey === selectedKey);
  }, [overrides, selectedKey]);

  const updateOverride = (patch: Partial<ScreenOverride>) => {
    setOverrides((prev) =>
      prev.map((o) => (o.screenKey === selectedKey ? { ...o, ...patch } : o))
    );
  };

  const toggleTool = (toolId: string) => {
    const current = selectedOverride?.enabledTools ?? selectedAgent?.enabledTools ?? [];
    const next = current.includes(toolId)
      ? current.filter((t) => t !== toolId)
      : [...current, toolId];
    updateOverride({ enabledTools: next });
  };

  const save = async () => {
    if (!config || !registry) return;
    setSaving(true);
    try {
      const res = await patchAgentConfigAdmin({
        screenAgentOverrides: overrides.map((o) => ({
          screenKey: o.screenKey,
          systemPromptExtra: o.systemPromptExtra?.trim() || undefined,
          enabledTools: o.enabledTools,
          tags: o.tags,
          enabled: o.enabled === false ? false : undefined
        })),
        orchestratorOverride: {
          ...config.orchestratorOverride,
          systemPromptExtra: orchExtra.trim() || undefined
        }
      });
      if (res.ok) {
        setConfig(res.config);
        toast.success('Agentes lógicos salvos.');
        const reg = await fetchAgentRegistry();
        setRegistry(reg);
        setOverrides(mergeOverrides(reg, res.config));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar agentes.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-5 flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando agentes lógicos…
      </Card>
    );
  }

  if (!registry || !config || !selectedAgent || !selectedOverride) {
    return (
      <Card className="p-5 text-[13px] text-red-500" role="alert">
        Registry de agentes indisponível.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-sky-500" />
            <div>
              <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
                Multi-agente — painel de controle
              </h2>
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {registry.screenAgentCount} agentes por tela · orquestrador{' '}
                <strong>{registry.orchestrator.name}</strong>
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            type="button"
            disabled={saving}
            leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            onClick={() => void save()}
          >
            Salvar agentes
          </Button>
        </div>

        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            <Bot className="w-4 h-4 text-violet-500" />
            {registry.orchestrator.name}
          </div>
          <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            {registry.orchestrator.tagline}
          </p>
          <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
            Prompt extra do orquestrador
          </label>
          <textarea
            rows={2}
            maxLength={2000}
            className="w-full text-[12px] px-3 py-2 rounded-lg border font-mono bg-transparent"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
            value={orchExtra}
            onChange={(e) => setOrchExtra(e.target.value)}
          />
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
              Mapeamento tela → agente
            </p>
            <ul className="max-h-72 overflow-y-auto space-y-1 text-[12px]">
              {registry.mappings.map((m) => {
                const active = m.screenKey === selectedKey;
                return (
                  <li key={m.screenKey}>
                    <button
                      type="button"
                      className={`w-full text-left px-2 py-1.5 rounded-md border transition-colors ${
                        active ? 'border-violet-400/60 bg-violet-500/10' : 'border-transparent hover:bg-white/5'
                      }`}
                      onClick={() => setSelectedKey(m.screenKey)}
                    >
                      <span className="font-mono text-[10px] opacity-70">{m.screenKey}</span>
                      <span className="mx-1">→</span>
                      <strong>{m.agentName}</strong>
                      <span className="text-[10px] opacity-60 ml-1">({m.profileId})</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                {selectedAgent.name}
              </h3>
              <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                {selectedAgent.tagline}
              </p>
            </div>

            <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
              <input
                type="checkbox"
                checked={selectedOverride.enabled !== false}
                onChange={(e) => updateOverride({ enabled: e.target.checked })}
              />
              Agente ativo nesta tela
            </label>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Tags (vírgula)
              </label>
              <input
                type="text"
                className="w-full mt-1 text-[12px] px-3 py-2 rounded-lg border bg-transparent"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
                value={(selectedOverride.tags ?? selectedAgent.tags).join(', ')}
                onChange={(e) =>
                  updateOverride({
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  })
                }
              />
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Prompt extra (agente da tela)
              </label>
              <textarea
                rows={3}
                maxLength={2000}
                className="w-full mt-1 text-[12px] px-3 py-2 rounded-lg border font-mono bg-transparent"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
                value={selectedOverride.systemPromptExtra ?? ''}
                onChange={(e) => updateOverride({ systemPromptExtra: e.target.value })}
              />
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                Ferramentas habilitadas
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {registry.availableTools.map((t) => {
                  const on = (selectedOverride.enabledTools ?? []).includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      title={t.description}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        on ? 'border-emerald-500/50 bg-emerald-500/15' : 'border-white/10 opacity-60'
                      }`}
                      onClick={() => toggleTool(t.id)}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-amber-500" />
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
            Atividade ao vivo
          </h2>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            (atualiza a cada 12s)
          </span>
        </div>
        {activity.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            Nenhuma pergunta recente no buffer do servidor.
          </p>
        ) : (
          <ul className="space-y-2 max-h-56 overflow-y-auto text-[11px] font-mono">
            {activity.map((entry) => (
              <li
                key={`${entry.at}-${entry.questionPreview}`}
                className="rounded border px-2 py-1.5"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-2)' }}
              >
                <span className="text-violet-400">{entry.orchestrator ?? registry.orchestrator.name}</span>
                {' → '}
                <span className="text-emerald-400">{entry.agentPersona}</span>
                {' · '}
                {entry.screen} · {entry.intent}
                {entry.toolsUsed.length > 0 ? ` · ${entry.toolsUsed.join(', ')}` : ''}
                <div className="truncate opacity-70">{entry.questionPreview}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
