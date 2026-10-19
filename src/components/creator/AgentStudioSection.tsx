import React, { useCallback, useEffect, useState } from 'react';
import { Bot, BookOpen, Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card } from '../ui';
import {
  fetchAgentConfigAdmin,
  fetchAgentKnowledgeAdmin,
  patchAgentConfigAdmin,
  patchAgentKnowledgeAdmin,
  type AgentConfig,
  type AgentMode
} from '../../services/agentApi';

const MODES: AgentMode[] = ['auto', 'standard', 'admin_full'];

export const AgentStudioSection: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [knowledgeJson, setKnowledgeJson] = useState('');
  const [meta, setMeta] = useState<{ baseCount: number; mergedCount: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, knRes] = await Promise.all([fetchAgentConfigAdmin(), fetchAgentKnowledgeAdmin()]);
      if (cfgRes.ok && cfgRes.config) setConfig(cfgRes.config);
      if (knRes.ok) {
        setMeta({ baseCount: knRes.baseCount, mergedCount: knRes.mergedCount });
        setKnowledgeJson(JSON.stringify(knRes.overrides ?? [], null, 2));
      }
    } catch {
      toast.error('Não foi possível carregar config do agente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await patchAgentConfigAdmin(config);
      if (res.ok) {
        setConfig(res.config);
        toast.success('Configuração do agente salva.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const saveKnowledge = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(knowledgeJson) as AgentConfig['knowledgeOverrides'];
      if (!Array.isArray(parsed)) throw new Error('JSON deve ser um array.');
      const res = await patchAgentKnowledgeAdmin(parsed);
      if (res.ok) {
        setKnowledgeJson(JSON.stringify(res.overrides, null, 2));
        toast.success('Base de conhecimento atualizada.');
        void load();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'JSON inválido ou falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-5 flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando agente ZapMass…
      </Card>
    );
  }

  if (!config) {
    return (
      <Card className="p-5 text-[13px] text-red-500" role="alert">
        Config do agente indisponível (verifique login admin e Firestore).
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-violet-500" />
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
            Agente ZapMass — configuração
          </h2>
        </div>
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Documento Firestore <span className="font-mono text-[11px]">appConfig/agent</span>. Orquestra o{' '}
          <strong>Agente ZapMass</strong> gratuito (regras, ferramentas, RAG) e, se configurado, LLM opcional
          (Groq/Gemini via <span className="font-mono text-[11px]">AGENT_LLM_PROVIDER</span>).
        </p>

        <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
          Agente ativo para todos os tenants
        </label>

        <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
          <input
            type="checkbox"
            checked={config.llmPolishEnabled}
            onChange={(e) => setConfig({ ...config, llmPolishEnabled: e.target.checked })}
          />
          Permitir polimento LLM no modo padrão (admins)
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Limite diário (vazio = env)
            </label>
            <input
              type="number"
              min={1}
              max={200}
              className="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border bg-transparent"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
              value={config.dailyLimitOverride ?? ''}
              placeholder="Padrão do servidor"
              onChange={(e) => {
                const v = e.target.value.trim();
                setConfig({
                  ...config,
                  dailyLimitOverride: v === '' ? null : Number(v)
                });
              }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Modo padrão (admin, auto)
            </label>
            <select
              className="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border bg-transparent"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
              value={config.defaultAdminMode}
              onChange={(e) => setConfig({ ...config, defaultAdminMode: e.target.value as AgentMode })}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
            Prompt extra (modo admin_full com LLM)
          </label>
          <textarea
            rows={3}
            maxLength={2000}
            className="w-full mt-1 text-[12px] px-3 py-2 rounded-lg border font-mono bg-transparent"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
            value={config.systemPromptExtra}
            onChange={(e) => setConfig({ ...config, systemPromptExtra: e.target.value })}
          />
        </div>

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
            Sugestões iniciais (uma por linha)
          </label>
          <textarea
            rows={4}
            className="w-full mt-1 text-[12px] px-3 py-2 rounded-lg border bg-transparent"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
            value={config.starterSuggestions.join('\n')}
            onChange={(e) =>
              setConfig({
                ...config,
                starterSuggestions: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 12)
              })
            }
          />
        </div>

        <Button
          variant="primary"
          size="sm"
          type="button"
          disabled={saving}
          leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          onClick={() => void saveConfig()}
        >
          Salvar configuração
        </Button>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-emerald-500" />
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
            Conhecimento (overrides)
          </h2>
        </div>
        {meta && (
          <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            Base embutida: {meta.baseCount} chunks · Mesclado: {meta.mergedCount}
          </p>
        )}
        <p className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>
          Array JSON de chunks <span className="font-mono text-[11px]">id, title, keywords[], body, navigateTo?, enabled?</span>.
          Mesmo <span className="font-mono">id</span> substitui chunk base; <span className="font-mono">enabled: false</span> oculta.
        </p>
        <textarea
          rows={12}
          className="w-full text-[11px] px-3 py-2 rounded-lg border font-mono bg-transparent"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
          value={knowledgeJson}
          onChange={(e) => setKnowledgeJson(e.target.value)}
        />
        <Button variant="secondary" size="sm" type="button" disabled={saving} onClick={() => void saveKnowledge()}>
          Salvar conhecimento
        </Button>
      </Card>
    </div>
  );
};
