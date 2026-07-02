import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Pencil, Check, X, Layers, Wifi, WifiOff, RefreshCw, Shield, Zap, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ConnectionStatus, WhatsAppConnection } from '../../types';
import {
  ConnectionPool,
  listConnectionPools,
  createConnectionPool,
  updateConnectionPool,
  deleteConnectionPool,
} from '../../services/connectionPoolsApi';

interface ConnectionPoolsPanelProps {
  connections: WhatsAppConnection[];
}

const strategyLabels: Record<ConnectionPool['strategy'], string> = {
  round_robin: 'Rodízio igual',
  weighted: 'Pesos personalizados',
  priority: 'Prioridade (fallback em ordem)',
};

const strategyDescriptions: Record<ConnectionPool['strategy'], string> = {
  round_robin: 'Distribui os envios igualmente entre todos os chips do pool.',
  weighted: 'Distribui por peso — chips mais fortes recebem mais envios.',
  priority: 'Usa o 1º chip disponível; os demais ficam em standby como fallback.',
};

const EMPTY_FORM = {
  name: '',
  connectionIds: [] as string[],
  strategy: 'round_robin' as ConnectionPool['strategy'],
  channelWeights: {} as Record<string, number>,
};

export const ConnectionPoolsPanel: React.FC<ConnectionPoolsPanelProps> = ({ connections }) => {
  const [pools, setPools] = useState<ConnectionPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // pool id or 'new'
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listConnectionPools();
      setPools(list);
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao carregar pools.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startNew = () => {
    setForm({ ...EMPTY_FORM });
    setEditing('new');
  };

  const startEdit = (p: ConnectionPool) => {
    setForm({
      name: p.name,
      connectionIds: [...p.connectionIds],
      strategy: p.strategy,
      channelWeights: { ...(p.channelWeights || {}) },
    });
    setEditing(p.id);
  };

  const cancel = () => { setEditing(null); };

  const toggleChip = (id: string) => {
    setForm((f) => ({
      ...f,
      connectionIds: f.connectionIds.includes(id)
        ? f.connectionIds.filter((c) => c !== id)
        : [...f.connectionIds, id],
    }));
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Informe um nome para o pool.'); return; }
    if (form.connectionIds.length === 0) { toast.error('Selecione pelo menos um chip.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        connectionIds: form.connectionIds,
        strategy: form.strategy,
        channelWeights: form.strategy === 'weighted' ? form.channelWeights : undefined,
      };
      if (editing === 'new') {
        const created = await createConnectionPool(payload);
        setPools((prev) => [...prev, created]);
        toast.success(`Pool "${created.name}" criado!`);
      } else if (editing) {
        const updated = await updateConnectionPool(editing, payload);
        setPools((prev) => prev.map((p) => (p.id === editing ? updated : p)));
        toast.success(`Pool "${updated.name}" atualizado!`);
      }
      setEditing(null);
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao salvar pool.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Excluir o pool "${name}"? Campanhas que usam este pool vão precisar selecionar chips manualmente.`)) return;
    setDeleting(id);
    try {
      await deleteConnectionPool(id);
      setPools((prev) => prev.filter((p) => p.id !== id));
      toast.success(`Pool "${name}" excluído.`);
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao excluir pool.');
    } finally {
      setDeleting(null);
    }
  };

  const connById = Object.fromEntries(connections.map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
            Pools de Chips
          </h3>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
            Agrupe chips para usar em campanhas com failover automático.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="p-2 rounded-lg hover:bg-white/10 transition"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          </button>
          {editing !== 'new' && (
            <button
              type="button"
              onClick={startNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition"
              style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff' }}
            >
              <Plus className="w-4 h-4" /> Novo Pool
            </button>
          )}
        </div>
      </div>

      {/* Formulário de edição/criação */}
      {editing && (
        <div
          className="rounded-xl p-4 space-y-4"
          style={{ background: 'var(--surface)', border: '1px solid rgba(16,185,129,0.3)' }}
        >
          <p className="text-[13px] font-bold" style={{ color: 'var(--emerald, #10b981)' }}>
            {editing === 'new' ? '+ Novo pool' : 'Editar pool'}
          </p>

          {/* Nome */}
          <div>
            <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
              Nome do pool
            </label>
            <input
              className="ui-input w-full"
              placeholder="Ex: Disparos Comerciais"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Estratégia */}
          <div>
            <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
              Estratégia de distribuição
            </label>
            <div className="grid grid-cols-1 gap-2">
              {(Object.keys(strategyLabels) as ConnectionPool['strategy'][]).map((s) => (
                <label
                  key={s}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition"
                  style={{
                    background: form.strategy === s ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
                    border: `1.5px solid ${form.strategy === s ? 'rgba(16,185,129,0.4)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <input
                    type="radio"
                    name="strategy"
                    className="mt-0.5"
                    checked={form.strategy === s}
                    onChange={() => setForm((f) => ({ ...f, strategy: s }))}
                  />
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                      {strategyLabels[s]}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      {strategyDescriptions[s]}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Seleção de chips */}
          <div>
            <label className="block text-[12px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
              Chips do pool ({form.connectionIds.length} selecionado{form.connectionIds.length !== 1 ? 's' : ''})
            </label>
            {connections.length === 0 ? (
              <p className="text-[12px] py-3 text-center" style={{ color: 'var(--text-3)' }}>
                Nenhum chip cadastrado.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                {connections.map((conn) => {
                  const online = conn.status === ConnectionStatus.CONNECTED;
                  const sel = form.connectionIds.includes(conn.id);
                  return (
                    <label
                      key={conn.id}
                      className="flex items-center gap-2 p-2 rounded-lg transition cursor-pointer"
                      style={{
                        background: sel ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
                        border: `1.5px solid ${sel ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={sel}
                        onChange={() => toggleChip(conn.id)}
                      />
                      <div
                        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={sel ? { background: '#10b981' } : { border: '2px solid var(--border-strong)' }}
                      >
                        {sel && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      {online
                        ? <Wifi className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#10b981' }} />
                        : <WifiOff className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#ef4444' }} />}
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {conn.name}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                          {conn.phoneNumber || conn.id.slice(-8)}
                        </p>
                      </div>
                      {/* Ordem de prioridade */}
                      {form.strategy === 'priority' && sel && (
                        <span
                          className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
                        >
                          #{form.connectionIds.indexOf(conn.id) + 1}
                        </span>
                      )}
                      {/* Peso */}
                      {form.strategy === 'weighted' && sel && (
                        <input
                          type="number"
                          min={1}
                          max={100}
                          className="ml-auto w-14 text-right ui-input py-0.5 px-1 text-[11px]"
                          placeholder="peso"
                          value={form.channelWeights[conn.id] ?? 1}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              channelWeights: { ...f.channelWeights, [conn.id]: Math.max(1, Number(e.target.value)) },
                            }))
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff' }}
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {saving ? 'Salvando...' : 'Salvar pool'}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition"
              style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }}
            >
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de pools existentes */}
      {loading ? (
        <div className="py-8 text-center">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--text-3)' }} />
        </div>
      ) : pools.length === 0 && !editing ? (
        <div
          className="rounded-xl py-10 text-center"
          style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)' }}
        >
          <Layers className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-2)' }}>
            Nenhum pool criado ainda
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
            Crie um pool para agrupar chips e usar em campanhas com failover automático.
          </p>
          <button
            type="button"
            onClick={startNew}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff' }}
          >
            <Plus className="w-3.5 h-3.5" /> Criar primeiro pool
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {pools.map((p) => {
            const members = p.connectionIds.map((id) => connById[id]).filter(Boolean);
            const online = members.filter((c) => c.status === ConnectionStatus.CONNECTED);
            const isEditing = editing === p.id;
            return (
              <div
                key={p.id}
                className="rounded-xl p-4 transition"
                style={{
                  background: 'var(--surface)',
                  border: `1px solid ${isEditing ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)'}`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(16,185,129,0.12)' }}
                    >
                      <Layers className="w-4 h-4" style={{ color: '#10b981' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold truncate" style={{ color: 'var(--text)' }}>
                        {p.name}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {strategyLabels[p.strategy]}
                        {' · '}
                        <span style={{ color: online.length > 0 ? '#10b981' : '#ef4444' }}>
                          {online.length}/{members.length} chip{members.length !== 1 ? 's' : ''} online
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className="p-1.5 rounded-lg hover:bg-white/10 transition"
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p.id, p.name)}
                      disabled={deleting === p.id}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition disabled:opacity-50"
                      title="Excluir"
                    >
                      {deleting === p.id
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: '#ef4444' }} />
                        : <Trash2 className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />}
                    </button>
                  </div>
                </div>

                {/* Chips do pool */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {members.length === 0 ? (
                    <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Nenhum chip válido (chips podem ter sido removidos).
                    </span>
                  ) : (
                    members.map((c, idx) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{
                          background: c.status === ConnectionStatus.CONNECTED
                            ? 'rgba(16,185,129,0.12)'
                            : 'rgba(239,68,68,0.1)',
                          color: c.status === ConnectionStatus.CONNECTED ? '#10b981' : '#ef4444',
                          border: `1px solid ${c.status === ConnectionStatus.CONNECTED ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`,
                        }}
                      >
                        {p.strategy === 'priority' && (
                          <span className="font-bold">#{idx + 1}</span>
                        )}
                        {c.status === ConnectionStatus.CONNECTED
                          ? <Wifi className="w-2.5 h-2.5" />
                          : <WifiOff className="w-2.5 h-2.5" />}
                        {c.name}
                      </span>
                    ))
                  )}
                </div>

                {/* Badges de recursos */}
                <div className="mt-2 flex gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                    <Zap className="w-2.5 h-2.5" /> Failover automático
                  </span>
                  {online.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                      <Shield className="w-2.5 h-2.5" /> {online.length} chip{online.length !== 1 ? 's' : ''} ativo{online.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
