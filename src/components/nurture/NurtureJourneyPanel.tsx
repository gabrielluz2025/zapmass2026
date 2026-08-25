import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Clock,
  Flame,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useZapMassConnectionsSlice } from '../../context/ZapMassContext';
import { Button, Card, Input, SectionHeader } from '../ui';
import {
  cancelNurtureEnrollment,
  ENROLLMENT_STATUS_LABEL,
  fetchNurtureJourney,
  saveNurtureJourney,
  WEEKDAY_LABELS,
  type NurtureEnrollment,
  type NurtureJourneyDoc,
  type NurtureMetrics,
  type NurtureStep
} from '../../services/nurtureApi';

const DEFAULT_DOC: NurtureJourneyDoc = {
  enabled: false,
  name: 'Material para leads quentes',
  connectionIds: [],
  scheduleMode: 'relative',
  entryRules: { autoEnrollOnOptIn: true, requireMarketingOptIn: true },
  steps: [],
  businessHours: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    weekdays: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '20:00'
  },
  stopOnHumanClaim: true,
  globalOptOutKeywords: ['parar', 'sair', 'cancelar'],
  maxMessagesPerDayPerContact: 1
};

function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) {
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  return d || '—';
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function newStep(index: number): NurtureStep {
  return {
    id: `step-${Date.now()}-${index}`,
    label: `Passo ${index + 1}`,
    kind: 'message',
    body: '',
    delayHours: index === 0 ? 0 : 24
  };
}

export const NurtureJourneyPanel: React.FC = () => {
  const connections = useZapMassConnectionsSlice();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [journeyId, setJourneyId] = useState('');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [doc, setDoc] = useState<NurtureJourneyDoc>(DEFAULT_DOC);
  const [metrics, setMetrics] = useState<NurtureMetrics>({
    materialsSent: 0,
    repliesReceived: 0,
    handoffs: 0,
    optOuts: 0,
    completed: 0,
    activeEnrollments: 0
  });
  const [enrollments, setEnrollments] = useState<NurtureEnrollment[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchNurtureJourney();
      setJourneyId(data.journey.id);
      setName(data.journey.name);
      setEnabled(data.journey.enabled);
      setDoc(data.journey.doc);
      setMetrics(data.metrics);
      setEnrollments(data.enrollments);
    } catch (e) {
      console.error(e);
      toast.error('Não foi possível carregar a jornada de nutrição.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedIds = useMemo(
    () => connections.filter((c) => c.status === 'CONNECTED').map((c) => c.id),
    [connections]
  );

  const toggleChip = (id: string) => {
    setDoc((prev) => {
      const set = new Set(prev.connectionIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, connectionIds: [...set] };
    });
  };

  const updateStep = (index: number, patch: Partial<NurtureStep>) => {
    setDoc((prev) => {
      const steps = [...prev.steps];
      steps[index] = { ...steps[index], ...patch };
      return { ...prev, steps };
    });
  };

  const addStep = () => {
    setDoc((prev) => ({
      ...prev,
      steps: [...prev.steps, newStep(prev.steps.length)]
    }));
  };

  const removeStep = (index: number) => {
    setDoc((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index)
    }));
  };

  const handleSave = async () => {
    if (!journeyId) return;
    if (doc.steps.length === 0) {
      toast.error('Adicione pelo menos um passo na jornada.');
      return;
    }
    setSaving(true);
    try {
      const result = await saveNurtureJourney({
        journeyId,
        name,
        enabled,
        doc: { ...doc, enabled, name }
      });
      setMetrics(result.metrics);
      toast.success('Jornada de nutrição salva.');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar a jornada.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEnrollment = async (id: string) => {
    setCancellingId(id);
    try {
      const list = await cancelNurtureEnrollment(id);
      setEnrollments(list);
      toast.success('Inscrição cancelada.');
    } catch {
      toast.error('Não foi possível cancelar.');
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Carregando jornada…
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <SectionHeader
        icon={<BookOpen className="w-5 h-5" style={{ color: 'var(--brand-500)' }} />}
        title="Jornada de nutrição"
        description="Sequência programada de materiais para leads quentes — não consome cota de disparo de campanha"
      />

      <Card className="p-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 rounded accent-emerald-500"
          />
          <span className="font-bold text-slate-800 dark:text-white">Ativar jornada de nutrição</span>
        </label>
        <p className="text-xs text-slate-500 mt-2 ml-7">
          Mensagens da jornada são enviadas em conversa 1:1 e <strong>não entram</strong> no limite diário de
          campanhas.
        </p>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Ativos', value: metrics.activeEnrollments, icon: Users, color: 'text-emerald-500' },
          { label: 'Materiais', value: metrics.materialsSent, icon: Zap, color: 'text-sky-500' },
          { label: 'Respostas', value: metrics.repliesReceived, icon: Flame, color: 'text-orange-500' },
          { label: 'Handoffs', value: metrics.handoffs, icon: Users, color: 'text-violet-500' },
          { label: 'Concluídos', value: metrics.completed, icon: BookOpen, color: 'text-emerald-600' },
          { label: 'Opt-outs', value: metrics.optOuts, icon: Trash2, color: 'text-red-400' }
        ].map((k) => (
          <Card key={k.label} className="p-3 text-center">
            <k.icon className={`w-4 h-4 mx-auto mb-1 ${k.color}`} />
            <p className="text-lg font-black tabular-nums">{k.value.toLocaleString('pt-BR')}</p>
            <p className="text-[10px] font-bold uppercase text-slate-400">{k.label}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4 space-y-4">
        <h3 className="text-sm font-black uppercase text-slate-500">Configuração geral</h3>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-500">Nome da jornada</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={doc.entryRules.autoEnrollOnOptIn}
              onChange={(e) =>
                setDoc((p) => ({
                  ...p,
                  entryRules: { ...p.entryRules, autoEnrollOnOptIn: e.target.checked }
                }))
              }
              className="accent-emerald-500"
            />
            Inscrever automaticamente quando virar lead quente (opt-in)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={doc.stopOnHumanClaim}
              onChange={(e) => setDoc((p) => ({ ...p, stopOnHumanClaim: e.target.checked }))}
              className="accent-emerald-500"
            />
            Pausar quando humano assumir no Bate-papo
          </label>
        </div>
        <div>
          <p className="text-xs font-bold text-slate-500 mb-2">Modo de agenda</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDoc((p) => ({ ...p, scheduleMode: 'relative' }))}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                doc.scheduleMode === 'relative'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600'
              }`}
            >
              <Clock className="w-3 h-3 inline mr-1" />
              Relativo (+horas)
            </button>
            <button
              type="button"
              onClick={() => setDoc((p) => ({ ...p, scheduleMode: 'calendar' }))}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                doc.scheduleMode === 'calendar'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600'
              }`}
            >
              <Calendar className="w-3 h-3 inline mr-1" />
              Calendário (dia/hora)
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold text-slate-500 mb-2">Chips (vazio = todos conectados)</p>
          <div className="flex flex-wrap gap-2">
            {connectedIds.length === 0 ? (
              <span className="text-xs text-amber-600">Nenhum chip conectado no momento</span>
            ) : (
              connectedIds.map((id) => {
                const conn = connections.find((c) => c.id === id);
                const on = doc.connectionIds.length === 0 || doc.connectionIds.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleChip(id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                      on
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {conn?.name || id}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase text-slate-500">Passos da sequência</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addStep}>
            <Plus className="w-4 h-4 mr-1" />
            Passo
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Use variáveis como {'{nome}'}, {'{saudacao}'} e spintax {'{Olá|Oi}'} . Palavra PARAR encerra a jornada.
        </p>
        {doc.steps.map((step, index) => (
          <div
            key={step.id}
            className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3"
            style={{ background: 'var(--surface-2)' }}
          >
            <div className="flex items-end justify-between gap-2">
              <label className="flex-1 block space-y-1">
                <span className="text-xs font-bold text-slate-500">Passo {index + 1}</span>
                <Input
                  value={step.label || ''}
                  onChange={(e) => updateStep(index, { label: e.target.value })}
                  placeholder={`Passo ${index + 1}`}
                />
              </label>
              <button
                type="button"
                onClick={() => removeStep(index)}
                className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg shrink-0 mt-5"
                title="Remover passo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="text-xs font-bold text-slate-500">
                Tipo{' '}
                <select
                  value={step.kind}
                  onChange={(e) =>
                    updateStep(index, { kind: e.target.value as NurtureStep['kind'] })
                  }
                  className="ml-1 rounded border px-2 py-1 text-slate-800 dark:text-white dark:bg-slate-900"
                >
                  <option value="message">Mensagem automática</option>
                  <option value="wait_reply">Aguardar resposta</option>
                </select>
              </label>
              {doc.scheduleMode === 'relative' ? (
                <label className="text-xs font-bold text-slate-500">
                  +Horas após anterior{' '}
                  <input
                    type="number"
                    min={0}
                    max={336}
                    value={step.delayHours ?? 0}
                    onChange={(e) =>
                      updateStep(index, { delayHours: Number(e.target.value) || 0 })
                    }
                    className="w-16 ml-1 rounded border px-2 py-1 dark:bg-slate-900"
                  />
                </label>
              ) : (
                <>
                  <label className="text-xs font-bold text-slate-500">
                    Dia{' '}
                    <select
                      value={step.calendar?.weekday ?? 1}
                      onChange={(e) =>
                        updateStep(index, {
                          calendar: {
                            weekday: Number(e.target.value),
                            time: step.calendar?.time || '09:00'
                          }
                        })
                      }
                      className="ml-1 rounded border px-2 py-1 dark:bg-slate-900"
                    >
                      {WEEKDAY_LABELS.map((l, i) => (
                        <option key={l} value={i}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-bold text-slate-500">
                    Hora{' '}
                    <input
                      type="time"
                      value={step.calendar?.time || '09:00'}
                      onChange={(e) =>
                        updateStep(index, {
                          calendar: {
                            weekday: step.calendar?.weekday ?? 1,
                            time: e.target.value
                          }
                        })
                      }
                      className="ml-1 rounded border px-2 py-1 dark:bg-slate-900"
                    />
                  </label>
                </>
              )}
            </div>
            <textarea
              value={step.body}
              onChange={(e) => updateStep(index, { body: e.target.value })}
              rows={4}
              placeholder="Texto do material ou pergunta com opções 1 / 2…"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm dark:bg-slate-900"
            />
            {step.kind === 'wait_reply' && (
              <p className="text-[10px] text-slate-400">
                Inclua opções numeradas no texto (ex.: 1 — Sim, 2 — Depois). Respostas avançam a jornada.
              </p>
            )}
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-black uppercase text-slate-500 mb-3">Inscritos recentes</h3>
        {enrollments.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ninguém inscrito ainda. Leads quentes entram automaticamente se opt-in estiver ativo, ou inscreva pelo
            fluxo de campanha / bot.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-400">
                  <th className="pb-2 pr-2">Telefone</th>
                  <th className="pb-2 pr-2">Passo</th>
                  <th className="pb-2 pr-2">Status</th>
                  <th className="pb-2 pr-2">Próximo envio</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {enrollments.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-2 font-mono text-xs">{formatPhone(row.contactPhone)}</td>
                    <td className="py-2 pr-2 tabular-nums">{row.currentStepIndex + 1}</td>
                    <td className="py-2 pr-2">
                      {ENROLLMENT_STATUS_LABEL[row.status] || row.status}
                    </td>
                    <td className="py-2 pr-2 text-xs">{formatWhen(row.nextRunAt)}</td>
                    <td className="py-2 text-right">
                      {['enrolled', 'active', 'waiting_reply', 'paused'].includes(row.status) && (
                        <button
                          type="button"
                          disabled={cancellingId === row.id}
                          onClick={() => void handleCancelEnrollment(row.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Salvando…' : 'Salvar jornada'}
        </Button>
      </div>
    </div>
  );
};
