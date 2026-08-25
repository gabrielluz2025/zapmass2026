import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Clock,
  Flame,
  MessageSquare,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Send,
  Settings2,
  UserPlus,
  Users,
  Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useZapMassConnectionsSlice } from '../../context/ZapMassContext';
import { Button, Card, Input, SectionHeader } from '../ui';
import { NurtureStepEditor, type PendingStepMedia } from './NurtureStepEditor';
import {
  cancelNurtureEnrollment,
  dispatchNurtureNow,
  ENROLLMENT_STATUS_COLOR,
  ENROLLMENT_STATUS_LABEL,
  enrollContactInNurture,
  fetchNurtureJourney,
  saveNurtureJourney,
  uploadNurtureMedia,
  type NurtureEnrollment,
  type NurtureJourneyDoc,
  type NurtureMetrics,
  type NurtureStep,
  type NurtureStepOption
} from '../../services/nurtureApi';

type TabId = 'sequencia' | 'inscritos' | 'enviar';

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

function defaultWaitReplyOptions(): NurtureStepOption[] {
  return [
    { id: '1', tokens: ['1', 'sim'], reply: 'Perfeito! Em breve alguém fala com você.', handoff: true },
    { id: '2', tokens: ['2', 'depois', 'nao', 'não'], reply: 'Sem problemas! Continuamos por aqui.' }
  ];
}

export const NurtureJourneyPanel: React.FC = () => {
  const connections = useZapMassConnectionsSlice();
  const [tab, setTab] = useState<TabId>('sequencia');
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
  const [selectedStep, setSelectedStep] = useState(0);
  const [pendingMediaByStep, setPendingMediaByStep] = useState<Record<string, PendingStepMedia>>({});
  const [enrollFilter, setEnrollFilter] = useState('all');
  const [enrollSearch, setEnrollSearch] = useState('');
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<Set<string>>(new Set());
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [enrollPhone, setEnrollPhone] = useState('');
  const [enrollConnectionId, setEnrollConnectionId] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const connectedChips = useMemo(
    () => connections.filter((c) => c.status === 'CONNECTED'),
    [connections]
  );

  const chipName = useMemo(() => {
    const id = doc.connectionIds[0] || connectedChips[0]?.id;
    return connections.find((c) => c.id === id)?.name;
  }, [connections, connectedChips, doc.connectionIds]);

  const load = useCallback(async () => {
    try {
      const data = await fetchNurtureJourney({
        status: enrollFilter,
        search: enrollSearch
      });
      setJourneyId(data.journey.id);
      setName(data.journey.name);
      setEnabled(data.journey.enabled);
      setDoc(data.journey.doc);
      setMetrics(data.metrics);
      setEnrollments(data.enrollments);
      setSelectedStep((i) => Math.min(i, Math.max(0, data.journey.doc.steps.length - 1)));
    } catch (e) {
      console.error(e);
      toast.error('Não foi possível carregar a jornada.');
    } finally {
      setLoading(false);
    }
  }, [enrollFilter, enrollSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enrollConnectionId && connectedChips[0]?.id) {
      setEnrollConnectionId(connectedChips[0].id);
    }
  }, [connectedChips, enrollConnectionId]);

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

  const setStepKind = (index: number, kind: NurtureStep['kind']) => {
    const step = doc.steps[index];
    if (kind === 'wait_reply' && (!step.options || step.options.length === 0)) {
      updateStep(index, { kind, options: defaultWaitReplyOptions() });
    } else {
      updateStep(index, { kind });
    }
  };

  const uploadPendingMedia = async (steps: NurtureStep[]): Promise<NurtureStep[]> => {
    const out = [...steps];
    for (let i = 0; i < out.length; i++) {
      const pending = pendingMediaByStep[out[i].id];
      if (!pending?.dataBase64) continue;
      const url = await uploadNurtureMedia({
        dataBase64: pending.dataBase64,
        mimeType: pending.mimeType,
        fileName: pending.fileName
      });
      out[i] = {
        ...out[i],
        media: {
          url,
          mimeType: pending.mimeType,
          fileName: pending.fileName,
          sendAsDocument: pending.sendMediaAsDocument
        }
      };
    }
    return out;
  };

  const handleSave = async () => {
    if (!journeyId) return;
    if (doc.steps.length === 0) {
      toast.error('Adicione pelo menos um passo.');
      return;
    }
    setSaving(true);
    try {
      const steps = await uploadPendingMedia(doc.steps);
      const result = await saveNurtureJourney({
        journeyId,
        name,
        enabled,
        doc: { ...doc, steps, enabled, name }
      });
      setDoc(result.journey.doc);
      setMetrics(result.metrics);
      setPendingMediaByStep({});
      toast.success('Jornada salva.');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDispatch = async (allActive: boolean) => {
    if (!journeyId) return;
    setDispatchBusy(true);
    try {
      const ids = allActive ? undefined : [...selectedEnrollmentIds];
      const result = await dispatchNurtureNow({
        journeyId,
        allActive,
        enrollmentIds: ids
      });
      setEnrollments(result.enrollments);
      toast.success(`${result.queued} envio(s) enfileirado(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao disparar.');
    } finally {
      setDispatchBusy(false);
    }
  };

  const handleManualEnroll = async () => {
    const phone = enrollPhone.replace(/\D/g, '');
    if (!phone || !enrollConnectionId) {
      toast.error('Informe telefone e chip.');
      return;
    }
    setEnrollBusy(true);
    try {
      await enrollContactInNurture({ contactPhone: phone, connectionId: enrollConnectionId, journeyId });
      await load();
      setEnrollPhone('');
      toast.success('Contato inscrito na jornada.');
    } catch {
      toast.error('Não foi possível inscrever.');
    } finally {
      setEnrollBusy(false);
    }
  };

  const toggleEnrollmentSelect = (id: string) => {
    setSelectedEnrollmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const interactingCount = enrollments.filter((e) => e.status === 'waiting_reply').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Carregando jornada…
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'sequencia', label: 'Sequência', icon: <BookOpen className="w-4 h-4" /> },
    {
      id: 'inscritos',
      label: 'Inscritos',
      icon: <Users className="w-4 h-4" />,
      badge: interactingCount || metrics.activeEnrollments || undefined
    },
    { id: 'enviar', label: 'Enviar / Inscrever', icon: <Rocket className="w-4 h-4" /> }
  ];

  const currentStep = doc.steps[selectedStep];

  return (
    <div className="space-y-5 pb-12 max-w-6xl mx-auto">
      <div
        className="rounded-2xl p-5 border overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(20,184,166,0.12) 0%, rgba(16,185,129,0.04) 50%, transparent 100%)',
          borderColor: 'var(--border-subtle)'
        }}
      >
        <SectionHeader
          icon={<BookOpen className="w-5 h-5 text-teal-600" />}
          title="Jornada de nutrição"
          description="Sequência profissional para leads quentes — fora da cota de campanha, com mídia, links e acompanhamento em tempo real"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-white/80 dark:bg-slate-900/80 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-teal-500"
            />
            <span className="text-sm font-bold">Jornada ativa</span>
          </label>
          <Button type="button" onClick={() => void handleSave()} disabled={saving} size="sm">
            <Save className="w-4 h-4 mr-1" />
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { label: 'Ativos', value: metrics.activeEnrollments, icon: Users, tone: 'text-teal-600' },
          { label: 'Interagindo', value: interactingCount, icon: MessageSquare, tone: 'text-amber-600' },
          { label: 'Materiais', value: metrics.materialsSent, icon: Zap, tone: 'text-sky-600' },
          { label: 'Respostas', value: metrics.repliesReceived, icon: Flame, tone: 'text-orange-500' },
          { label: 'Handoffs', value: metrics.handoffs, icon: UserPlus, tone: 'text-violet-600' },
          { label: 'Concluídos', value: metrics.completed, icon: BookOpen, tone: 'text-emerald-700' }
        ].map((k) => (
          <Card key={k.label} className="p-3 border-0 shadow-sm">
            <k.icon className={`w-4 h-4 mb-1 ${k.tone}`} />
            <p className="text-xl font-black tabular-nums">{k.value.toLocaleString('pt-BR')}</p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
          </Card>
        ))}
      </div>

      <div
        className="flex gap-1 p-1 rounded-xl overflow-x-auto"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition ${
              tab === t.id
                ? 'bg-white dark:bg-slate-800 shadow text-teal-700 dark:text-teal-300'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-white">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'sequencia' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
              <Settings2 className="w-4 h-4" />
              Configuração
            </div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da jornada" />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDoc((p) => ({ ...p, scheduleMode: 'relative' }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${doc.scheduleMode === 'relative' ? 'bg-teal-500 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
              >
                <Clock className="w-3 h-3 inline mr-1" />
                Relativo
              </button>
              <button
                type="button"
                onClick={() => setDoc((p) => ({ ...p, scheduleMode: 'calendar' }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${doc.scheduleMode === 'calendar' ? 'bg-teal-500 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
              >
                <Calendar className="w-3 h-3 inline mr-1" />
                Calendário
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {connectedChips.map((c) => {
                const on = doc.connectionIds.length === 0 || doc.connectionIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChip(c.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${on ? 'border-teal-500 bg-teal-500/10 text-teal-800' : 'border-slate-200 text-slate-500'}`}
                  >
                    {c.name || c.id}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={doc.entryRules.autoEnrollOnOptIn}
                onChange={(e) =>
                  setDoc((p) => ({ ...p, entryRules: { ...p.entryRules, autoEnrollOnOptIn: e.target.checked } }))
                }
              />
              Auto-inscrever leads quentes (opt-in)
            </label>
          </Card>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {doc.steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedStep(i)}
                className={`shrink-0 px-3 py-2 rounded-xl border text-left min-w-[120px] transition ${
                  selectedStep === i
                    ? 'border-teal-500 bg-teal-500/10 ring-2 ring-teal-500/30'
                    : 'border-slate-200 dark:border-slate-700 hover:border-teal-300'
                }`}
              >
                <span className="text-[10px] font-black text-teal-600">PASSO {i + 1}</span>
                <p className="text-xs font-bold truncate">{s.label || `Passo ${i + 1}`}</p>
                <p className="text-[10px] text-slate-400">{s.kind === 'wait_reply' ? 'Resposta' : 'Mensagem'}</p>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setDoc((p) => ({ ...p, steps: [...p.steps, newStep(p.steps.length)] }));
                setSelectedStep(doc.steps.length);
              }}
              className="shrink-0 px-3 py-2 rounded-xl border border-dashed border-teal-400 text-teal-600 text-xs font-bold flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Passo
            </button>
          </div>

          {currentStep && (
            <Card className="p-4 md:p-5">
              <NurtureStepEditor
                step={currentStep}
                index={selectedStep}
                doc={doc}
                chipName={chipName}
                pendingMedia={pendingMediaByStep[currentStep.id] || null}
                onChange={(patch) => updateStep(selectedStep, patch)}
                onOptionsChange={(options) => updateStep(selectedStep, { options })}
                onSetKind={(kind) => setStepKind(selectedStep, kind)}
                onPendingMedia={(payload) =>
                  setPendingMediaByStep((prev) => {
                    const next = { ...prev };
                    if (payload) next[currentStep.id] = payload;
                    else delete next[currentStep.id];
                    return next;
                  })
                }
                onRemove={() => {
                  setDoc((p) => ({ ...p, steps: p.steps.filter((_, i) => i !== selectedStep) }));
                  setSelectedStep(Math.max(0, selectedStep - 1));
                }}
              />
            </Card>
          )}
        </div>
      )}

      {tab === 'inscritos' && (
        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={enrollSearch}
                onChange={(e) => setEnrollSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void load()}
                placeholder="Buscar nome ou telefone…"
                className="pl-9"
              />
            </div>
            <select
              value={enrollFilter}
              onChange={(e) => setEnrollFilter(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm dark:bg-slate-900"
            >
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="waiting_reply">Interagindo agora</option>
              <option value="paused">Pausados</option>
              <option value="completed">Concluídos</option>
            </select>
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {enrollments.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">Nenhum inscrito encontrado.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/80">
                  <tr className="text-left text-[10px] uppercase text-slate-400">
                    <th className="p-2 w-8" />
                    <th className="p-2">Contato</th>
                    <th className="p-2">Passo</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Próximo</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((row) => {
                    const statusClass = ENROLLMENT_STATUS_COLOR[row.status] || ENROLLMENT_STATUS_COLOR.active;
                    const active = ['enrolled', 'active', 'waiting_reply', 'paused'].includes(row.status);
                    return (
                      <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="p-2">
                          {active && (
                            <input
                              type="checkbox"
                              checked={selectedEnrollmentIds.has(row.id)}
                              onChange={() => toggleEnrollmentSelect(row.id)}
                            />
                          )}
                        </td>
                        <td className="p-2">
                          <p className="font-semibold text-slate-800 dark:text-white">
                            {row.contactName?.trim() || 'Sem nome no CRM'}
                          </p>
                          <p className="text-xs font-mono text-slate-500">{formatPhone(row.contactPhone)}</p>
                        </td>
                        <td className="p-2 tabular-nums font-bold">{row.currentStepIndex + 1}</td>
                        <td className="p-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-bold ${statusClass}`}>
                            {ENROLLMENT_STATUS_LABEL[row.status] || row.status}
                          </span>
                          {row.pauseReason && (
                            <p className="text-[10px] text-slate-400 mt-0.5">{row.pauseReason}</p>
                          )}
                        </td>
                        <td className="p-2 text-xs">{formatWhen(row.nextRunAt)}</td>
                        <td className="p-2 text-right">
                          {active && (
                            <button
                              type="button"
                              disabled={cancellingId === row.id}
                              onClick={async () => {
                                setCancellingId(row.id);
                                try {
                                  const list = await cancelNurtureEnrollment(row.id);
                                  setEnrollments(list);
                                  toast.success('Inscrição cancelada.');
                                } catch {
                                  toast.error('Erro ao cancelar.');
                                } finally {
                                  setCancellingId(null);
                                }
                              }}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Cancelar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selectedEnrollmentIds.size > 0 && (
            <div className="flex justify-end">
              <Button type="button" size="sm" disabled={dispatchBusy} onClick={() => void handleDispatch(false)}>
                <Send className="w-4 h-4 mr-1" />
                Enviar passo atual para {selectedEnrollmentIds.size} selecionado(s)
              </Button>
            </div>
          )}
        </Card>
      )}

      {tab === 'enviar' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5 space-y-4">
            <h3 className="font-black text-slate-700 dark:text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-teal-600" />
              Inscrever contato
            </h3>
            <p className="text-xs text-slate-500">Uma pessoa entra na sequência a partir do passo 1.</p>
            <Input
              value={enrollPhone}
              onChange={(e) => setEnrollPhone(e.target.value)}
              placeholder="Telefone (WhatsApp)"
            />
            <select
              value={enrollConnectionId}
              onChange={(e) => setEnrollConnectionId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-900"
            >
              {connectedChips.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
            <Button type="button" disabled={enrollBusy} onClick={() => void handleManualEnroll()} className="w-full">
              Inscrever na jornada
            </Button>
          </Card>

          <Card className="p-5 space-y-4">
            <h3 className="font-black text-slate-700 dark:text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-teal-600" />
              Disparar agora
            </h3>
            <p className="text-xs text-slate-500">
              Força o envio imediato do passo atual (teste ou reenvio). Não consome cota de campanha.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={dispatchBusy || metrics.activeEnrollments === 0}
              onClick={() => void handleDispatch(true)}
              className="w-full"
            >
              <Users className="w-4 h-4 mr-1" />
              Enviar para todos os ativos ({metrics.activeEnrollments})
            </Button>
            <Button
              type="button"
              disabled={dispatchBusy || selectedEnrollmentIds.size === 0}
              onClick={() => void handleDispatch(false)}
              className="w-full"
            >
              Enviar só para selecionados ({selectedEnrollmentIds.size})
            </Button>
            <p className="text-[10px] text-slate-400">
              Selecione contatos na aba Inscritos antes de usar &quot;só selecionados&quot;.
            </p>
          </Card>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Salvando…' : 'Salvar jornada'}
        </Button>
      </div>
    </div>
  );
};
