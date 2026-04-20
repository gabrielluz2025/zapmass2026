import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Filter,
  MapPin,
  Phone,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Users,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CampaignReplyFlow, Contact, ContactList, ConnectionStatus, WhatsAppConnection } from '../../types';
import type { CampaignWizardDraft } from '../../types/campaignMission';
import { analyzeMessageRisk } from '../../utils/messageRiskScore';
import { Badge, Button, Card, Input, SectionHeader, Textarea } from '../ui';

type CampaignFlowMode = 'sequential' | 'reply';

type MessageStageDraft = {
  id: string;
  body: string;
  acceptAnyReply: boolean;
  validTokensText: string;
  invalidReplyBody: string;
};

const newMessageStage = (): MessageStageDraft => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  body: '',
  acceptAnyReply: true,
  validTokensText: '1, 2, sim, nao',
  invalidReplyBody: 'Nao entendi. Responda com uma das opcoes indicadas acima.'
});

const parseValidTokensText = (s: string) =>
  s.split(/[,;\n\r]+/).map((t) => t.trim()).filter(Boolean);

type SendMode = 'list' | 'manual' | 'filter';

interface NewCampaignWizardProps {
  connections: WhatsAppConnection[];
  contactLists: ContactList[];
  contacts: Contact[];
  onCancel: () => void;
  onSubmit: (payload: {
    name: string;
    message: string;
    messageStages: string[];
    replyFlow?: CampaignReplyFlow;
    connectedIds: string[];
    numbers: string[];
    recipients: Array<{ phone: string; vars: Record<string, string> }>;
    contactListMeta: { id?: string; name?: string };
    delaySeconds: number;
  }) => Promise<void>;
  /** Reidrata o assistente (clone / modelo). */
  initialDraft?: CampaignWizardDraft | null;
  onDraftConsumed?: () => void;
}

const STEPS = [
  { id: 1, key: 'audience', label: 'Publico', description: 'Defina para quem enviar' },
  { id: 2, key: 'message', label: 'Mensagem', description: 'O que sera enviado' },
  { id: 3, key: 'channels', label: 'Canais', description: 'Quais chips e timing' },
  { id: 4, key: 'review', label: 'Revisao', description: 'Confira e dispare' }
] as const;

export const NewCampaignWizard: React.FC<NewCampaignWizardProps> = ({
  connections,
  contactLists,
  contacts,
  onCancel,
  onSubmit,
  initialDraft,
  onDraftConsumed
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [sendMode, setSendMode] = useState<SendMode>('list');
  const [manualNumbers, setManualNumbers] = useState('');
  const [name, setName] = useState('');
  const [messageStages, setMessageStages] = useState<MessageStageDraft[]>(() => [newMessageStage(), newMessageStage()]);
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [campaignFlowMode, setCampaignFlowMode] = useState<CampaignFlowMode>('reply');
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [delaySeconds, setDelaySeconds] = useState(45);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Laboratório A/B: duas campanhas com 1ª mensagem diferente (apenas sequencial). */
  const [abLabEnabled, setAbLabEnabled] = useState(false);
  const [abFirstBodyB, setAbFirstBodyB] = useState('');
  const [abPercentEach, setAbPercentEach] = useState(5);
  // Filtros por atributo do contato
  const [filterCities, setFilterCities] = useState<Set<string>>(new Set());
  const [filterChurches, setFilterChurches] = useState<Set<string>>(new Set());
  const [filterRoles, setFilterRoles] = useState<Set<string>>(new Set());
  const [filterProfessions, setFilterProfessions] = useState<Set<string>>(new Set());
  const [filterDDDs, setFilterDDDs] = useState<Set<string>>(new Set());
  const [filterSearch, setFilterSearch] = useState('');
  // Escolha individual: quando nao vazio, sobrescreve a selecao automatica dos filtros
  const [selectedContactPhones, setSelectedContactPhones] = useState<Set<string>>(new Set());
  const [manualSelection, setManualSelection] = useState(false);
  const msgRef = useRef<HTMLTextAreaElement>(null);

  const onlineConnections = useMemo(
    () => connections.filter((conn) => conn.status === ConnectionStatus.CONNECTED),
    [connections]
  );

  const selectedList = useMemo(
    () => contactLists.find((list) => list.id === selectedListId),
    [contactLists, selectedListId]
  );

  const selectedListContacts = useMemo(() => {
    if (!selectedList) return [] as Contact[];
    const contactMap = new Map<string, Contact>();
    for (const contact of contacts) {
      contactMap.set(contact.id, contact);
      for (const aid of contact.aliasContactIds || []) {
        if (aid) contactMap.set(aid, contact);
      }
    }
    const seen = new Set<string>();
    const out: Contact[] = [];
    for (const id of selectedList.contactIds) {
      const c = contactMap.get(id);
      if (!c) continue;
      const phone = c.phone?.replace(/\D/g, '') || '';
      if (phone.length < 10 || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ ...c, phone });
    }
    return out;
  }, [contacts, selectedList]);

  const selectedListNumbers = useMemo(
    () => selectedListContacts.map((c) => c.phone),
    [selectedListContacts]
  );

  const invalidSelectedListCount = selectedList
    ? Math.max(selectedList.contactIds.length - selectedListNumbers.length, 0)
    : 0;

  const parseManualNumbers = () =>
    Array.from(
      new Set(
        manualNumbers
          .split(/[\n,;]/)
          .map((item) => item.replace(/\D/g, ''))
          .filter((item) => item.length >= 10)
      )
    );

  // ============================================================
  // FILTRO POR ATRIBUTO (cidade / igreja / cargo)
  // ============================================================
  const normalize = (v?: string) => (v || '').trim();

  const cityOptions = useMemo(() => {
    const set = new Map<string, number>();
    contacts.forEach((c) => {
      const v = normalize(c.city);
      if (v) set.set(v, (set.get(v) || 0) + 1);
    });
    return Array.from(set.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [contacts]);

  const churchOptions = useMemo(() => {
    const set = new Map<string, number>();
    contacts.forEach((c) => {
      const v = normalize(c.church);
      if (v) set.set(v, (set.get(v) || 0) + 1);
    });
    return Array.from(set.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [contacts]);

  const roleOptions = useMemo(() => {
    const set = new Map<string, number>();
    contacts.forEach((c) => {
      const v = normalize(c.role);
      if (v) set.set(v, (set.get(v) || 0) + 1);
    });
    return Array.from(set.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [contacts]);

  const professionOptions = useMemo(() => {
    const set = new Map<string, number>();
    contacts.forEach((c) => {
      const v = normalize(c.profession);
      if (v) set.set(v, (set.get(v) || 0) + 1);
    });
    return Array.from(set.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [contacts]);

  // Extrai DDD brasileiro do telefone (2 digitos apos o "55"; fallback para os 2 primeiros)
  const extractDDD = (raw: string): string => {
    const p = (raw || '').replace(/\D/g, '');
    if (p.startsWith('55') && p.length >= 12) return p.substring(2, 4);
    if (p.length >= 11) return p.substring(0, 2);
    if (p.length >= 10) return p.substring(0, 2);
    return '';
  };

  const dddOptions = useMemo(() => {
    const set = new Map<string, number>();
    contacts.forEach((c) => {
      const ddd = extractDDD(c.phone || '');
      if (ddd) set.set(ddd, (set.get(ddd) || 0) + 1);
    });
    return Array.from(set.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [contacts]);

  // Contatos que batem com os criterios de filtro (sem considerar a busca textual).
  // Este e o "pool" dentro do qual a selecao individual acontece.
  const eligibleContacts = useMemo<Contact[]>(() => {
    if (sendMode !== 'filter') return [];
    const seen = new Set<string>();
    const out: Contact[] = [];
    for (const c of contacts) {
      const phone = (c.phone || '').replace(/\D/g, '');
      if (phone.length < 10 || seen.has(phone)) continue;
      if (filterCities.size > 0 && !filterCities.has(normalize(c.city))) continue;
      if (filterChurches.size > 0 && !filterChurches.has(normalize(c.church))) continue;
      if (filterRoles.size > 0 && !filterRoles.has(normalize(c.role))) continue;
      if (filterProfessions.size > 0 && !filterProfessions.has(normalize(c.profession))) continue;
      if (filterDDDs.size > 0 && !filterDDDs.has(extractDDD(phone))) continue;
      seen.add(phone);
      out.push({ ...c, phone });
    }
    return out;
  }, [sendMode, contacts, filterCities, filterChurches, filterRoles, filterProfessions, filterDDDs]);

  // Lista visivel no picker (elegiveis + busca textual)
  const visibleContacts = useMemo<Contact[]>(() => {
    const term = filterSearch.trim().toLowerCase();
    if (!term) return eligibleContacts;
    return eligibleContacts.filter((c) => {
      const hay = `${c.name || ''} ${c.city || ''} ${c.church || ''} ${c.role || ''} ${c.profession || ''} ${c.phone}`.toLowerCase();
      return hay.includes(term);
    });
  }, [eligibleContacts, filterSearch]);

  // Contatos que efetivamente irao receber
  const finalContacts = useMemo<Contact[]>(() => {
    if (sendMode !== 'filter') return [];
    if (!manualSelection) return eligibleContacts; // sem selecao individual -> todos elegiveis
    return eligibleContacts.filter((c) => selectedContactPhones.has(c.phone));
  }, [sendMode, eligibleContacts, manualSelection, selectedContactPhones]);

  const filteredNumbers = useMemo(() => finalContacts.map((c) => c.phone), [finalContacts]);
  // Compat: nome antigo usado mais abaixo
  const filteredContacts = finalContacts;

  const toggleFilterValue = (set: Set<string>, setter: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const clearAllFilters = () => {
    setFilterCities(new Set());
    setFilterChurches(new Set());
    setFilterRoles(new Set());
    setFilterProfessions(new Set());
    setFilterDDDs(new Set());
    setFilterSearch('');
    setSelectedContactPhones(new Set());
    setManualSelection(false);
  };

  const buildFilterLabel = (): string => {
    const parts: string[] = [];
    if (filterCities.size > 0) parts.push(`${filterCities.size} cidade${filterCities.size > 1 ? 's' : ''}`);
    if (filterChurches.size > 0) parts.push(`${filterChurches.size} igreja${filterChurches.size > 1 ? 's' : ''}`);
    if (filterRoles.size > 0) parts.push(`${filterRoles.size} cargo${filterRoles.size > 1 ? 's' : ''}`);
    if (filterProfessions.size > 0) parts.push(`${filterProfessions.size} profissao${filterProfessions.size > 1 ? 'es' : ''}`);
    if (filterDDDs.size > 0) parts.push(`${filterDDDs.size} DDD${filterDDDs.size > 1 ? 's' : ''}`);
    if (manualSelection) parts.push(`${selectedContactPhones.size} individual${selectedContactPhones.size === 1 ? '' : 'is'}`);
    return parts.length > 0 ? `Filtro: ${parts.join(' + ')}` : 'Filtro personalizado';
  };

  // Helpers da selecao individual
  const toggleContactPhone = (phone: string) => {
    setManualSelection(true);
    setSelectedContactPhones((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };
  const selectAllVisible = () => {
    setManualSelection(true);
    setSelectedContactPhones((prev) => {
      const next = new Set(prev);
      visibleContacts.forEach((c) => next.add(c.phone));
      return next;
    });
  };
  const deselectAllVisible = () => {
    setManualSelection(true);
    setSelectedContactPhones((prev) => {
      const next = new Set(prev);
      visibleContacts.forEach((c) => next.delete(c.phone));
      return next;
    });
  };
  const clearIndividualSelection = () => {
    setManualSelection(false);
    setSelectedContactPhones(new Set());
  };
  const allVisibleSelected =
    manualSelection &&
    visibleContacts.length > 0 &&
    visibleContacts.every((c) => selectedContactPhones.has(c.phone));
  const someVisibleSelected =
    manualSelection &&
    visibleContacts.some((c) => selectedContactPhones.has(c.phone));

  const getConnectedSelectedIds = () => {
    const connectedIdSet = new Set(onlineConnections.map((conn) => conn.id));
    return selectedConnectionIds.filter((id) => connectedIdSet.has(id));
  };

  const activeMessageBody = messageStages[activeStageIdx]?.body ?? '';
  const messageRisk = useMemo(() => analyzeMessageRisk(activeMessageBody), [activeMessageBody]);

  useEffect(() => {
    if (activeStageIdx >= messageStages.length) {
      setActiveStageIdx(Math.max(0, messageStages.length - 1));
    }
  }, [activeStageIdx, messageStages.length]);

  useEffect(() => {
    if (campaignFlowMode === 'reply') setAbLabEnabled(false);
  }, [campaignFlowMode]);

  useEffect(() => {
    if (!initialDraft) return;
    setName(initialDraft.name);
    setSendMode(initialDraft.sendMode);
    setManualNumbers(initialDraft.manualNumbers);
    setSelectedListId(initialDraft.selectedListId);
    setSelectedConnectionIds(initialDraft.selectedConnectionIds);
    setDelaySeconds(initialDraft.delaySeconds);
    setCampaignFlowMode(initialDraft.campaignFlowMode);
    setMessageStages(initialDraft.messageStages.map((s) => ({ ...s, id: s.id || newMessageStage().id })));
    setFilterCities(new Set(initialDraft.filterCities));
    setFilterChurches(new Set(initialDraft.filterChurches));
    setFilterRoles(new Set(initialDraft.filterRoles));
    setFilterProfessions(new Set(initialDraft.filterProfessions));
    setFilterDDDs(new Set(initialDraft.filterDDDs));
    setFilterSearch(initialDraft.filterSearch);
    setSelectedContactPhones(new Set(initialDraft.selectedContactPhones));
    setManualSelection(initialDraft.manualSelection);
    setAbLabEnabled(false);
    setAbFirstBodyB('');
    setActiveStageIdx(0);
    setStep(1);
    onDraftConsumed?.();
  }, [initialDraft, onDraftConsumed]);

  const setActiveMessageBody = (body: string) => {
    setMessageStages((prev) => prev.map((s, i) => (i === activeStageIdx ? { ...s, body } : s)));
  };

  const patchActiveStage = (patch: Partial<MessageStageDraft>) => {
    setMessageStages((prev) => prev.map((s, i) => (i === activeStageIdx ? { ...s, ...patch } : s)));
  };

  const setFlowMode = (mode: CampaignFlowMode) => {
    if (mode === 'reply') {
      setMessageStages((prev) => (prev.length < 2 ? [...prev, newMessageStage()] : prev));
    }
    setCampaignFlowMode(mode);
  };

  const addMessageStage = () => {
    setMessageStages((prev) => {
      const next = [...prev, newMessageStage()];
      setActiveStageIdx(next.length - 1);
      return next;
    });
  };

  const removeMessageStage = (idx: number) => {
    if (campaignFlowMode === 'reply' && messageStages.length <= 2) {
      toast.error('No fluxo por respostas use pelo menos 2 etapas.');
      return;
    }
    setMessageStages((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      setActiveStageIdx((i) => {
        let ni = i;
        if (ni === idx) ni = Math.max(0, idx - 1);
        else if (ni > idx) ni -= 1;
        return Math.min(ni, Math.max(0, next.length - 1));
      });
      return next;
    });
  };

  const insertVariable = (variable: string) => {
    const el = msgRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const cur = activeMessageBody;
    const newMsg = cur.substring(0, start) + variable + cur.substring(end);
    setMessageStages((prev) => prev.map((s, i) => (i === activeStageIdx ? { ...s, body: newMsg } : s)));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const numbers =
    sendMode === 'list'
      ? selectedListNumbers
      : sendMode === 'manual'
      ? parseManualNumbers()
      : filteredNumbers;
  const connectedIds = getConnectedSelectedIds();

  const canGoFromAudience =
    sendMode === 'list'
      ? selectedListNumbers.length > 0
      : sendMode === 'manual'
      ? parseManualNumbers().length > 0
      : filteredNumbers.length > 0;
  const replyFlowGatesOk =
    campaignFlowMode !== 'reply' ||
    (messageStages.length >= 2 &&
      messageStages.every((s) => {
        if (s.acceptAnyReply) return true;
        const toks = parseValidTokensText(s.validTokensText);
        return toks.length > 0 && s.invalidReplyBody.trim().length > 0;
      }));

  const canGoFromMessage =
    name.trim().length > 0 &&
    messageStages.length > 0 &&
    messageStages.every((s) => s.body.trim().length > 0) &&
    replyFlowGatesOk &&
    (campaignFlowMode !== 'reply' || messageStages.length >= 2);
  const canGoFromChannels = connectedIds.length > 0;
  const abLabOk =
    !abLabEnabled ||
    (campaignFlowMode === 'sequential' && abFirstBodyB.trim().length > 0 && messageStages.length >= 1);
  const canSubmit = canGoFromAudience && canGoFromMessage && canGoFromChannels && !isSubmitting && abLabOk;

  const buildRecipients = (): Array<{ phone: string; vars: Record<string, string> }> => {
    const fromContact = (c: Contact) => ({
      phone: c.phone,
      vars: {
        nome: (c.name || '').split(' ')[0] || c.name || '',
        nome_completo: c.name || '',
        telefone: c.phone,
        cidade: c.city || '',
        igreja: c.church || '',
        cargo: c.role || '',
        profissao: c.profession || '',
        aniversario: c.birthday || '',
        email: c.email || ''
      }
    });
    if (sendMode === 'list') return selectedListContacts.map(fromContact);
    if (sendMode === 'filter') return filteredContacts.map(fromContact);
    return numbers.map((phone) => ({ phone, vars: { telefone: phone } }));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const stagesBodies = messageStages.map((s) => s.body.trim()).filter((b) => b.length > 0);
    const replyFlow: CampaignReplyFlow | undefined =
      campaignFlowMode === 'reply'
        ? {
            enabled: true,
            steps: messageStages.map((s) => ({
              body: s.body.trim(),
              acceptAnyReply: s.acceptAnyReply,
              validTokens: parseValidTokensText(s.validTokensText),
              invalidReplyBody: s.invalidReplyBody.trim()
            }))
          }
        : undefined;
    const contactListMeta =
      sendMode === 'list' && selectedList
        ? { id: selectedList.id, name: selectedList.name }
        : sendMode === 'filter'
        ? { id: undefined, name: buildFilterLabel() }
        : { id: undefined, name: 'Envio manual' };

    const runSingle = async () => {
      await onSubmit({
        name: name.trim(),
        message: stagesBodies[0] || '',
        messageStages: stagesBodies,
        replyFlow,
        connectedIds,
        numbers,
        recipients: buildRecipients(),
        contactListMeta,
        delaySeconds
      });
    };

    if (abLabEnabled && campaignFlowMode === 'sequential' && stagesBodies.length >= 1) {
      const clean = Array.from(
        new Set(numbers.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 10))
      ).sort();
      const each = Math.max(1, Math.floor((clean.length * abPercentEach) / 100));
      const numsA = clean.slice(0, each);
      const numsB = clean.slice(each, each * 2);
      if (numsA.length === 0 || numsB.length === 0) {
        toast.error('Público pequeno para A/B. Aumente a lista ou o percentual por variante.');
        return;
      }
      const stagesB = [...stagesBodies];
      stagesB[0] = abFirstBodyB.trim();
      const recAll = buildRecipients();
      const setPhones = new Set<string>();
      numsA.forEach((p) => setPhones.add(p));
      const recA = recAll.filter((r) => setPhones.has(r.phone.replace(/\D/g, '')));
      const setB = new Set(numsB);
      const recB = recAll.filter((r) => setB.has(r.phone.replace(/\D/g, '')));
      setIsSubmitting(true);
      try {
        await onSubmit({
          name: `${name.trim()} — Var A`,
          message: stagesBodies[0] || '',
          messageStages: stagesBodies,
          replyFlow: undefined,
          connectedIds,
          numbers: numsA,
          recipients: recA.length ? recA : numsA.map((phone) => ({ phone, vars: { telefone: phone } })),
          contactListMeta,
          delaySeconds
        });
        await onSubmit({
          name: `${name.trim()} — Var B`,
          message: stagesB[0] || '',
          messageStages: stagesB,
          replyFlow: undefined,
          connectedIds,
          numbers: numsB,
          recipients: recB.length ? recB : numsB.map((phone) => ({ phone, vars: { telefone: phone } })),
          contactListMeta,
          delaySeconds
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Falha ao iniciar campanha.';
        toast.error(errorMessage);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      await runSingle();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Falha ao iniciar campanha.';
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const applyPreviewVars = (text: string) =>
    text
      .replace(/\{nome\}/g, 'Maria Silva')
      .replace(/\{telefone\}/g, '(11) 98888-7777')
      .replace(/\{cidade\}/g, 'Sao Paulo')
      .replace(/\{igreja\}/g, 'Igreja Exemplo')
      .replace(/\{cargo\}/g, 'Lider de Celula')
      .replace(/\{profissao\}/g, 'Engenheira')
      .replace(/\{data\}/g, new Date().toLocaleDateString('pt-BR'));

  const stagePreviewBodies = messageStages.map((s) => applyPreviewVars(s.body)).filter((b) => b.trim().length > 0);

  const estimateMinutes =
    campaignFlowMode === 'reply'
      ? Math.round((numbers.length * delaySeconds) / 60)
      : Math.round((numbers.length * Math.max(1, messageStages.length) * delaySeconds) / 60);

  const estimateLabel =
    campaignFlowMode === 'reply'
      ? `1º envio ~${estimateMinutes} min (proximas etapas quando o contato responder)`
      : `~${estimateMinutes} min`;

  return (
    <div className="max-w-5xl mx-auto pb-10">
      <SectionHeader
        title="Nova Campanha"
        description="Configure passo a passo: publico, mensagem, canais e revisao."
        actions={
          <Button variant="ghost" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={onCancel}>
            Voltar
          </Button>
        }
      />

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto">
        {STEPS.map((s, i) => {
          const isActive = step === s.id;
          const isDone = step > s.id;
          return (
            <React.Fragment key={s.id}>
              <button
                onClick={() => {
                  if (s.id <= step || (s.id === 2 && canGoFromAudience) || (s.id === 3 && canGoFromAudience && canGoFromMessage) || (s.id === 4 && canGoFromAudience && canGoFromMessage && canGoFromChannels)) {
                    setStep(s.id);
                  }
                }}
                className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl transition-all flex-shrink-0"
                style={{
                  background: isActive
                    ? 'var(--brand-50)'
                    : isDone
                    ? 'var(--surface-1)'
                    : 'transparent',
                  border: isActive ? '1px solid rgba(16,185,129,0.25)' : '1px solid var(--border-subtle)'
                }}
              >
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{
                    background: isActive || isDone ? 'var(--brand-500)' : 'var(--surface-2)',
                    color: isActive || isDone ? '#fff' : 'var(--text-3)'
                  }}
                >
                  {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.id}
                </span>
                <div className="text-left hidden sm:block">
                  <p
                    className="text-[12px] font-semibold"
                    style={{ color: isActive ? 'var(--brand-700)' : 'var(--text-1)' }}
                  >
                    {s.label}
                  </p>
                  <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                    {s.description}
                  </p>
                </div>
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-3)' }} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* STEP 1: Audience */}
          {step === 1 && (
            <Card>
              <h3 className="ui-title text-[15px] mb-1">Para quem vamos enviar?</h3>
              <p className="ui-subtitle text-[12.5px] mb-4">Selecione uma lista existente ou informe numeros manualmente.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                {[
                  { id: 'list' as const, label: 'Lista de contatos', icon: FileSpreadsheet, desc: 'Use uma lista salva' },
                  { id: 'filter' as const, label: 'Por filtros', icon: Filter, desc: 'Cidade, igreja, cargo' },
                  { id: 'manual' as const, label: 'Numeros manuais', icon: Users, desc: 'Cole numeros avulsos' }
                ].map((m) => {
                  const isSel = sendMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSendMode(m.id)}
                      className="flex items-start gap-3 p-3.5 rounded-xl text-left transition-all"
                      style={{
                        background: isSel ? 'var(--brand-50)' : 'var(--surface-1)',
                        border: isSel ? '1.5px solid rgba(16,185,129,0.25)' : '1.5px solid var(--border-subtle)'
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: isSel ? 'var(--brand-500)' : 'var(--surface-2)' }}
                      >
                        <m.icon className="w-4 h-4" style={{ color: isSel ? '#fff' : 'var(--text-2)' }} />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {m.label}
                        </p>
                        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {m.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {sendMode === 'list' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {contactLists.map((list) => {
                    const isSel = selectedListId === list.id;
                    const count = list.count || list.contactIds.length || 0;
                    return (
                      <button
                        key={list.id}
                        type="button"
                        onClick={() => setSelectedListId(list.id)}
                        className="text-left p-3.5 rounded-xl transition-all"
                        style={{
                          background: isSel ? 'var(--brand-50)' : 'var(--surface-1)',
                          border: isSel ? '1.5px solid rgba(16,185,129,0.25)' : '1.5px solid var(--border-subtle)'
                        }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <FileSpreadsheet
                            className="w-4 h-4"
                            style={{ color: isSel ? 'var(--brand-600)' : 'var(--text-3)' }}
                          />
                          {isSel && <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />}
                        </div>
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {list.name}
                        </p>
                        <p className="text-[11.5px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-3)' }}>
                          <Users className="w-3 h-3" />
                          {count.toLocaleString()} contatos
                        </p>
                      </button>
                    );
                  })}
                  {contactLists.length === 0 && (
                    <p
                      className="col-span-2 text-center py-6 text-[12.5px]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      Nenhuma lista. Crie uma na aba Contatos.
                    </p>
                  )}
                </div>
              )}

              {sendMode === 'manual' && (
                <div>
                  <Textarea
                    placeholder="5511999999999&#10;5511988887777&#10;ou separados por virgula"
                    value={manualNumbers}
                    onChange={(e) => setManualNumbers(e.target.value)}
                    style={{ minHeight: '140px' }}
                  />
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                    DDI + DDD + numero - separar por linha, virgula ou ponto e virgula
                  </p>
                  {parseManualNumbers().length > 0 && (
                    <p
                      className="text-[11.5px] mt-1 font-semibold"
                      style={{ color: 'var(--brand-600)' }}
                    >
                      ✓ {parseManualNumbers().length} numero{parseManualNumbers().length > 1 ? 's' : ''} validos
                    </p>
                  )}
                </div>
              )}

              {sendMode === 'filter' && (
                <div className="space-y-3">
                  {/* Resumo do resultado */}
                  <div
                    className="flex items-center justify-between gap-3 p-3 rounded-xl"
                    style={{
                      background: finalContacts.length > 0 ? 'var(--brand-50)' : 'var(--surface-1)',
                      border: finalContacts.length > 0
                        ? '1.5px solid rgba(16,185,129,0.25)'
                        : '1.5px solid var(--border-subtle)'
                    }}
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                        {manualSelection ? 'Contatos selecionados' : 'Contatos que batem com o filtro'}
                      </p>
                      <p className="text-[22px] font-extrabold tabular-nums mt-0.5" style={{ color: finalContacts.length > 0 ? 'var(--brand-700)' : 'var(--text-2)' }}>
                        {finalContacts.length.toLocaleString()}
                        <span className="text-[13px] font-semibold ml-2" style={{ color: 'var(--text-3)' }}>
                          {manualSelection
                            ? `de ${eligibleContacts.length.toLocaleString()} elegiveis`
                            : `de ${contacts.length.toLocaleString()}`}
                        </span>
                      </p>
                    </div>
                    {(filterCities.size + filterChurches.size + filterRoles.size + filterProfessions.size + filterDDDs.size + (manualSelection ? 1 : 0)) > 0 && (
                      <Button variant="ghost" size="sm" leftIcon={<X className="w-3.5 h-3.5" />} onClick={clearAllFilters}>
                        Limpar tudo
                      </Button>
                    )}
                  </div>

                  {/* Busca global dentro dos filtros */}
                  <div className="relative">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                      style={{ color: 'var(--text-3)' }}
                    />
                    <Input
                      placeholder="Buscar por nome, telefone, cidade..."
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      style={{ paddingLeft: '2.25rem' }}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <FilterGroup
                      title="Cidade"
                      icon={<MapPin className="w-4 h-4" />}
                      accent="#3b82f6"
                      options={cityOptions}
                      selected={filterCities}
                      onToggle={(v) => toggleFilterValue(filterCities, setFilterCities, v)}
                      onClear={() => setFilterCities(new Set())}
                    />
                    <FilterGroup
                      title="DDD"
                      icon={<Phone className="w-4 h-4" />}
                      accent="#10b981"
                      options={dddOptions}
                      selected={filterDDDs}
                      onToggle={(v) => toggleFilterValue(filterDDDs, setFilterDDDs, v)}
                      onClear={() => setFilterDDDs(new Set())}
                    />
                    <FilterGroup
                      title="Igreja"
                      icon={<Building2 className="w-4 h-4" />}
                      accent="#8b5cf6"
                      options={churchOptions}
                      selected={filterChurches}
                      onToggle={(v) => toggleFilterValue(filterChurches, setFilterChurches, v)}
                      onClear={() => setFilterChurches(new Set())}
                    />
                    <FilterGroup
                      title="Cargo (Igreja)"
                      icon={<Briefcase className="w-4 h-4" />}
                      accent="#f59e0b"
                      options={roleOptions}
                      selected={filterRoles}
                      onToggle={(v) => toggleFilterValue(filterRoles, setFilterRoles, v)}
                      onClear={() => setFilterRoles(new Set())}
                    />
                    <FilterGroup
                      title="Cargo Profissional"
                      icon={<Briefcase className="w-4 h-4" />}
                      accent="#0ea5e9"
                      options={professionOptions}
                      selected={filterProfessions}
                      onToggle={(v) => toggleFilterValue(filterProfessions, setFilterProfessions, v)}
                      onClear={() => setFilterProfessions(new Set())}
                    />
                  </div>

                  {/* Picker individual dos contatos */}
                  {eligibleContacts.length > 0 && (
                    <div
                      className="rounded-xl overflow-hidden"
                      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div
                        className="flex items-center justify-between px-3 py-2"
                        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}
                      >
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                            }}
                            onChange={() => {
                              if (allVisibleSelected) deselectAllVisible();
                              else selectAllVisible();
                            }}
                            className="w-4 h-4 rounded cursor-pointer"
                            style={{ accentColor: 'var(--brand-500)' }}
                          />
                          <span className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                            {manualSelection ? 'Selecionar individualmente' : 'Todos elegiveis serao enviados'}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                            ({visibleContacts.length} visiveis)
                          </span>
                        </label>
                        <div className="flex items-center gap-1.5">
                          {manualSelection && (
                            <Button variant="ghost" size="sm" onClick={clearIndividualSelection}>
                              Voltar para automatico
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                        {visibleContacts.length === 0 ? (
                          <div className="text-center py-6 text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                            Nenhum contato bate com a busca.
                          </div>
                        ) : (
                          visibleContacts.map((c) => {
                            const effectivelySelected = manualSelection
                              ? selectedContactPhones.has(c.phone)
                              : true;
                            return (
                              <label
                                key={c.id || c.phone}
                                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={effectivelySelected}
                                  onChange={() => toggleContactPhone(c.phone)}
                                  className="w-4 h-4 rounded cursor-pointer flex-shrink-0"
                                  style={{ accentColor: 'var(--brand-500)' }}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                                    {c.name || `+${c.phone}`}
                                  </p>
                                  <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                                    +{c.phone}
                                    {c.city ? ` - ${c.city}` : ''}
                                    {c.role ? ` - ${c.role}` : ''}
                                    {c.profession ? ` - ${c.profession}` : ''}
                                  </p>
                                </div>
                                {c.church && (
                                  <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded hidden sm:inline" style={{ background: 'var(--surface-0)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}>
                                    {c.church}
                                  </span>
                                )}
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {contacts.length === 0 && (
                    <p className="text-center py-6 text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                      Nenhum contato disponivel. Cadastre contatos na aba Contatos.
                    </p>
                  )}
                </div>
              )}

              {sendMode === 'list' && selectedList && (
                <div
                  className="mt-4 rounded-lg px-3 py-2.5"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between text-[12px]">
                    <span style={{ color: 'var(--text-3)' }}>Numeros validos</span>
                    <span className="font-semibold" style={{ color: 'var(--brand-600)' }}>
                      {selectedListNumbers.length}
                    </span>
                  </div>
                  {invalidSelectedListCount > 0 && (
                    <div className="flex items-center justify-between text-[12px] mt-1">
                      <span style={{ color: 'var(--text-3)' }}>Contatos ignorados</span>
                      <span className="font-semibold" style={{ color: '#f59e0b' }}>
                        {invalidSelectedListCount}
                      </span>
                    </div>
                  )}
                  {selectedListNumbers.length === 0 && selectedList.contactIds.length > 0 && (
                    <p className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      Nenhum número válido (mín. 10 dígitos) ou os IDs da lista não existem mais na sua base — por
                      exemplo, após migração Firestore. Atualize a lista na aba Contatos ou use &quot;Números
                      manuais&quot;.
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* STEP 2: Message */}
          {step === 2 && (
            <Card>
              <h3 className="ui-title text-[15px] mb-1">Qual a mensagem?</h3>
              <p className="ui-subtitle text-[12.5px] mb-4">
                {campaignFlowMode === 'reply'
                  ? 'Fluxo por respostas: a etapa 1 e enviada na abertura. Quando o contato responder, o sistema envia a etapa 2 (e assim por diante), conforme as regras abaixo. Opcional: exija respostas como 1 ou 2 e defina um texto se errar.'
                  : 'Envio em sequencia automatica: cada contato recebe todas as etapas em ordem, uma apos a outa, respeitando o intervalo anti-ban entre cada envio. Use variaveis dinamicas para personalizar.'}
              </p>

              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-3)' }}>
                Nome da campanha
              </label>
              <Input
                placeholder="Ex: Promocao Janeiro - Base VIP"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mb-4"
              />

              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                Modo das etapas
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                {[
                  {
                    id: 'reply' as const,
                    title: 'Fluxo por respostas',
                    desc: 'Aguarda a resposta do contato antes da proxima mensagem.'
                  },
                  {
                    id: 'sequential' as const,
                    title: 'Sequencia automatica',
                    desc: 'Envia todas as etapas em fila, sem esperar resposta.'
                  }
                ].map((opt) => {
                  const sel = campaignFlowMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setFlowMode(opt.id)}
                      className="text-left p-3 rounded-xl transition-all"
                      style={{
                        background: sel ? 'var(--brand-50)' : 'var(--surface-1)',
                        border: sel ? '1.5px solid rgba(16,185,129,0.25)' : '1.5px solid var(--border-subtle)'
                      }}
                    >
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                        {opt.title}
                      </p>
                      <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-2">
                {messageStages.map((st, idx) => {
                  const isAct = idx === activeStageIdx;
                  return (
                    <div key={st.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveStageIdx(idx)}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all"
                        style={{
                          background: isAct ? 'var(--brand-500)' : 'var(--surface-1)',
                          color: isAct ? '#fff' : 'var(--text-2)',
                          border: isAct ? 'none' : '1px solid var(--border-subtle)'
                        }}
                      >
                        Etapa {idx + 1}
                      </button>
                      {messageStages.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remover etapa ${idx + 1}`}
                          onClick={() => removeMessageStage(idx)}
                          className="p-1 rounded-md transition-all hover:opacity-90"
                          style={{ color: 'var(--text-3)' }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                  onClick={addMessageStage}
                >
                  Etapa
                </Button>
              </div>

              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Texto da etapa {activeStageIdx + 1}
                </label>
                <span
                  className="text-[10.5px] font-mono tabular-nums px-2 py-0.5 rounded-md"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}
                >
                  {activeMessageBody.length} chars
                </span>
              </div>

              <div className="flex flex-wrap gap-1 mb-2">
                {['{nome}', '{telefone}', '{cidade}', '{igreja}', '{cargo}', '{profissao}', '{data}'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-md transition-all hover:brightness-110"
                    style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <Textarea
                key={messageStages[activeStageIdx]?.id}
                ref={msgRef}
                placeholder="Ola {nome}! Temos uma oferta especial para voce em {cidade}..."
                value={activeMessageBody}
                onChange={(e) => setActiveMessageBody(e.target.value)}
                style={{ minHeight: '160px' }}
              />

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Sparkles className="w-3.5 h-3.5" />}
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        'zapmass:last_wizard_template_payload',
                        JSON.stringify({
                          delaySeconds,
                          campaignFlowMode,
                          stages: messageStages.map((s) => ({
                            body: s.body,
                            acceptAnyReply: s.acceptAnyReply,
                            validTokensText: s.validTokensText,
                            invalidReplyBody: s.invalidReplyBody
                          }))
                        })
                      );
                      toast.success('Rascunho guardado. Em Campanhas → Centro → Modelos, dê um nome e clique em Salvar modelo.');
                    } catch {
                      toast.error('Não foi possível guardar o rascunho.');
                    }
                  }}
                >
                  Guardar como modelo
                </Button>
              </div>

              <div
                className="mt-4 rounded-xl p-3.5 space-y-2"
                style={{
                  background:
                    messageRisk.level === 'high'
                      ? 'rgba(239,68,68,0.08)'
                      : messageRisk.level === 'medium'
                      ? 'rgba(245,158,11,0.1)'
                      : 'var(--surface-1)',
                  border: `1px solid ${
                    messageRisk.level === 'high' ? 'rgba(239,68,68,0.35)' : 'var(--border-subtle)'
                  }`
                }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                    Copiloto de risco (local)
                  </span>
                  <Badge
                    variant={
                      messageRisk.level === 'high' ? 'danger' : messageRisk.level === 'medium' ? 'warning' : 'success'
                    }
                  >
                    {messageRisk.level === 'high' ? 'Alto' : messageRisk.level === 'medium' ? 'Médio' : 'Baixo'}
                  </Badge>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                    score {messageRisk.score}/100
                  </span>
                </div>
                <ul className="text-[11.5px] space-y-1 list-disc pl-4" style={{ color: 'var(--text-2)' }}>
                  {messageRisk.hints.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                {messageRisk.level !== 'low' && (
                  <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--text-3)' }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-0.5" />
                    Revise o texto antes de escalar volume. Esta análise não substitui políticas da Meta nem o aceite de risco do app.
                  </p>
                )}
              </div>

              {campaignFlowMode === 'reply' && messageStages[activeStageIdx] && (
                <div
                  className="mt-4 p-3.5 rounded-xl space-y-3"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                    Depois da etapa {activeStageIdx + 1}
                  </p>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={messageStages[activeStageIdx].acceptAnyReply}
                      onChange={(e) => patchActiveStage({ acceptAnyReply: e.target.checked })}
                    />
                    <span className="text-[12.5px] leading-snug" style={{ color: 'var(--text-1)' }}>
                      {activeStageIdx < messageStages.length - 1
                        ? `Qualquer resposta (texto nao vazio) avanca para a etapa ${activeStageIdx + 2}.`
                        : 'Apos esta etapa enviada, a proxima resposta do contato encerra o fluxo (nao ha mais mensagens automaticas).'}
                    </span>
                  </label>
                  {!messageStages[activeStageIdx].acceptAnyReply && (
                    <div className="space-y-2 pt-1">
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                          Respostas aceitas
                        </label>
                        <Input
                          placeholder="Ex: 1, 2, sim, nao (virgula ou linha)"
                          value={messageStages[activeStageIdx].validTokensText}
                          onChange={(e) => patchActiveStage({ validTokensText: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                          Se nao for aceito, enviar
                        </label>
                        <Textarea
                          placeholder="Ex: Opcao invalida. Digite 1 para sim ou 2 para nao."
                          value={messageStages[activeStageIdx].invalidReplyBody}
                          onChange={(e) => patchActiveStage({ invalidReplyBody: e.target.value })}
                          style={{ minHeight: '72px' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* STEP 3: Channels */}
          {step === 3 && (
            <>
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="ui-title text-[15px]">Chips do WhatsApp</h3>
                    <p className="ui-subtitle text-[12.5px]">Escolha quais canais vao participar do disparo.</p>
                  </div>
                  <Badge variant="neutral">{connectedIds.length} selecionado{connectedIds.length !== 1 ? 's' : ''}</Badge>
                </div>

                {connections.length === 0 ? (
                  <p className="text-[12.5px] py-4 text-center" style={{ color: 'var(--text-3)' }}>
                    Nenhum chip cadastrado.
                  </p>
                ) : onlineConnections.length === 0 ? (
                  <div
                    className="rounded-lg px-4 py-5 text-center"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    <AlertCircle className="w-5 h-5 mx-auto mb-2" style={{ color: '#f59e0b' }} />
                    <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      Nenhum chip conectado agora.
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                      Conecte pelo menos um canal antes de iniciar o disparo.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {connections.map((conn) => {
                      const isOnline = conn.status === ConnectionStatus.CONNECTED;
                      const isSel = selectedConnectionIds.includes(conn.id);
                      return (
                        <label
                          key={conn.id}
                          className="flex items-center gap-2.5 p-2.5 rounded-lg transition-all"
                          style={{
                            background: isSel ? 'var(--brand-50)' : 'var(--surface-1)',
                            border: isSel ? '1.5px solid rgba(16,185,129,0.25)' : '1.5px solid var(--border-subtle)',
                            cursor: isOnline ? 'pointer' : 'not-allowed',
                            opacity: isOnline ? 1 : 0.6
                          }}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={isSel}
                            disabled={!isOnline}
                            onChange={(e) => {
                              const newIds = e.target.checked
                                ? [...selectedConnectionIds, conn.id]
                                : selectedConnectionIds.filter((id) => id !== conn.id);
                              setSelectedConnectionIds(newIds);
                            }}
                          />
                          <div
                            className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                            style={
                              isSel
                                ? { background: 'var(--brand-500)' }
                                : { border: '2px solid var(--border-strong)' }
                            }
                          >
                            {isSel && <span className="text-[10px] font-bold text-white">✓</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                              {conn.name}
                            </p>
                            <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                              {conn.phoneNumber || '—'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant={isOnline ? 'success' : 'danger'} dot>
                              {isOnline ? 'Online' : 'Offline'}
                            </Badge>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="ui-title text-[15px]">Intervalo Anti-Ban</h3>
                    <p className="ui-subtitle text-[12.5px]">
                      Tempo minimo entre cada envio automatico do sistema. No fluxo por respostas, vale entre a abertura
                      e entre cada mensagem disparada apos resposta (e mensagens de erro de validacao).
                    </p>
                  </div>
                  <span className="text-2xl font-bold tabular-nums" style={{ color: '#f59e0b' }}>
                    {delaySeconds}s
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {[15, 30, 45, 60, 90, 120].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDelaySeconds(s)}
                      className="py-2 rounded-lg text-[12px] font-bold transition-all"
                      style={
                        delaySeconds === s
                          ? { background: '#f59e0b', color: '#fff' }
                          : { background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
                      }
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              </Card>
            </>
          )}

          {/* STEP 4: Review */}
          {step === 4 && (
            <Card>
              <h3 className="ui-title text-[15px] mb-1">Revisao final</h3>
              <p className="ui-subtitle text-[12.5px] mb-4">Confira os dados antes de iniciar o disparo.</p>

              {campaignFlowMode === 'sequential' && (
                <div
                  className="mb-5 p-4 rounded-xl space-y-3"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={abLabEnabled}
                      onChange={(e) => setAbLabEnabled(e.target.checked)}
                    />
                    <span className="text-[13px] leading-snug" style={{ color: 'var(--text-1)' }}>
                      <strong>Laboratório A/B</strong> — cria <strong>duas campanhas</strong> com a mesma base de etapas, alterando só a{' '}
                      <strong>primeira mensagem</strong> na variante B. Os destinatários são divididos em dois grupos disjuntos
                      (percentual cada um abaixo). O restante da lista <strong>não</strong> recebe envio neste disparo.
                    </span>
                  </label>
                  {abLabEnabled && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                          Texto da 1ª mensagem — variante B
                        </label>
                        <Textarea
                          placeholder="Mensagem alternativa para teste..."
                          value={abFirstBodyB}
                          onChange={(e) => setAbFirstBodyB(e.target.value)}
                          style={{ minHeight: '100px' }}
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--text-3)' }}>
                          <span>Percentual do público para cada variante</span>
                          <span className="font-mono font-bold text-emerald-600">{abPercentEach}%</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={25}
                          value={abPercentEach}
                          onChange={(e) => setAbPercentEach(Number(e.target.value))}
                          className="w-full accent-emerald-600"
                        />
                        <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                          Ex.: 5% recebem A, 5% recebem B (mín. 1 contato por grupo). Ajuste conforme o tamanho da lista.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <ReviewRow label="Nome" value={abLabEnabled ? `${name} — Var A / Var B` : name} />
                <ReviewRow
                  label="Publico"
                  value={
                    sendMode === 'list'
                      ? selectedList?.name || '—'
                      : sendMode === 'filter'
                      ? buildFilterLabel()
                      : 'Envio manual'
                  }
                />
                <ReviewRow
                  label="Numeros validos"
                  value={<span className="font-semibold" style={{ color: 'var(--brand-600)' }}>{numbers.length.toLocaleString()}</span>}
                />
                <ReviewRow
                  label="Chips"
                  value={`${connectedIds.length} conectado${connectedIds.length !== 1 ? 's' : ''}`}
                />
                <ReviewRow label="Intervalo" value={`${delaySeconds}s entre envios`} />
                <ReviewRow
                  label="Modo"
                  value={campaignFlowMode === 'reply' ? 'Fluxo por respostas' : 'Sequencia automatica'}
                />
                <ReviewRow
                  label="Etapas"
                  value={`${messageStages.length} mensagem${messageStages.length !== 1 ? 'ns' : ''} por contato`}
                />
                <ReviewRow label="Estimativa" value={<span>{estimateLabel}</span>} />
              </div>

              <div
                className="mt-4 rounded-lg p-3.5"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                  Mensagens (ordem)
                </p>
                <div className="space-y-3">
                  {messageStages.map((s, idx) => (
                    <div key={s.id}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--brand-600)' }}>
                        Etapa {idx + 1}
                        {campaignFlowMode === 'reply' &&
                          (s.acceptAnyReply
                            ? ' — qualquer resposta avanca'
                            : ` — aceita: ${parseValidTokensText(s.validTokensText).join(', ') || '—'}`)}
                      </p>
                      <p className="text-[13px] whitespace-pre-wrap" style={{ color: 'var(--text-1)' }}>
                        {applyPreviewVars(s.body) || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              onClick={() => (step > 1 ? setStep((step - 1) as 1 | 2 | 3 | 4) : onCancel())}
              disabled={isSubmitting}
            >
              {step > 1 ? 'Voltar' : 'Cancelar'}
            </Button>

            {step < 4 ? (
              <Button
                variant="primary"
                rightIcon={<ChevronRight className="w-4 h-4" />}
                disabled={
                  (step === 1 && !canGoFromAudience) ||
                  (step === 2 && !canGoFromMessage) ||
                  (step === 3 && !canGoFromChannels)
                }
                onClick={() => setStep((step + 1) as 1 | 2 | 3 | 4)}
              >
                Avancar
              </Button>
            ) : (
              <Button
                variant="primary"
                leftIcon={<Send className="w-4 h-4" />}
                onClick={handleSubmit}
                loading={isSubmitting}
                disabled={!canSubmit}
              >
                {abLabEnabled ? 'Iniciar laboratório (2 campanhas)' : 'Iniciar disparo'}
              </Button>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="hidden lg:block">
          <Card className="sticky top-4">
            <p
              className="text-[10.5px] font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              Previa ao vivo
            </p>
            <div className="rounded-lg overflow-hidden" style={{ background: '#0b141a' }}>
              <div
                className="px-3 py-2 flex items-center gap-2"
                style={{ background: '#1a2228' }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: '#10b981', color: '#fff' }}
                >
                  Z
                </div>
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: '#e9edef' }}>
                    Contato
                  </p>
                  <p className="text-[9px]" style={{ color: '#10b981' }}>
                    online
                  </p>
                </div>
              </div>
              <div className="p-3 min-h-[160px] flex flex-col justify-end gap-2">
                {stagePreviewBodies.length > 0 ? (
                  stagePreviewBodies.map((body, idx) => (
                    <div key={`pv-${idx}`} className="self-end max-w-[90%]">
                      <p className="text-[9px] font-semibold mb-0.5 text-right" style={{ color: '#8696a0' }}>
                        Etapa {idx + 1}
                      </p>
                      <div
                        className="rounded-lg rounded-tr-none px-2.5 py-2 text-[12px] leading-[17px] whitespace-pre-wrap"
                        style={{ background: '#005c4b', color: '#e9edef' }}
                      >
                        {body}
                      </div>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span className="text-[9px]" style={{ color: '#8696a0' }}>
                          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[9px]" style={{ color: '#53bdeb' }}>
                          ✓✓
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-[11px] py-6" style={{ color: '#667781' }}>
                    As mensagens aparecerao aqui...
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <SummaryRow label="Numeros" value={numbers.length.toLocaleString()} accent="var(--text-1)" />
              <SummaryRow
                label="Chips"
                value={String(connectedIds.length)}
                accent={connectedIds.length > 0 ? 'var(--brand-600)' : 'var(--text-3)'}
              />
              <SummaryRow label="Delay" value={`${delaySeconds}s`} accent="#f59e0b" />
              {numbers.length > 0 && (
                <SummaryRow label="Estimativa" value={estimateLabel} accent="#3b82f6" />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const ReviewRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div
    className="flex items-center justify-between py-2 px-3 rounded-lg"
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
      {label}
    </span>
    <span className="text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>
      {value}
    </span>
  </div>
);

const SummaryRow: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div className="flex justify-between text-[11.5px]">
    <span style={{ color: 'var(--text-3)' }}>{label}</span>
    <span className="font-semibold tabular-nums" style={{ color: accent }}>
      {value}
    </span>
  </div>
);

interface FilterGroupProps {
  title: string;
  icon: React.ReactNode;
  accent: string;
  options: { value: string; count: number }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}
const FilterGroup: React.FC<FilterGroupProps> = ({ title, icon, accent, options, selected, onToggle, onClear }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Auto-foca o campo de busca quando abrir
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearch('');
    }
  }, [open]);

  const term = search.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!term) return options;
    return options.filter((o) => o.value.toLowerCase().includes(term));
  }, [options, term]);

  const selectedArr = useMemo(
    () => options.filter((o) => selected.has(o.value)),
    [options, selected]
  );

  const triggerLabel = selected.size === 0
    ? `Selecionar ${title.toLowerCase()}`
    : selected.size === 1
      ? Array.from(selected)[0]
      : `${selected.size} ${title.toLowerCase()}s selecionad${selected.size > 1 ? 'as' : 'a'}`;

  return (
    <div
      ref={rootRef}
      className="relative rounded-xl"
      style={{
        background: 'var(--surface-1)',
        border: selected.size > 0 ? `1.5px solid ${accent}40` : '1px solid var(--border-subtle)'
      }}
    >
      {/* Cabecalho + gatilho do combo */}
      <div className="p-2.5 flex items-center gap-2">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </div>

        <button
          type="button"
          onClick={() => options.length > 0 && setOpen((v) => !v)}
          disabled={options.length === 0}
          className="flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-all min-w-0"
          style={{
            background: 'var(--surface-0)',
            border: open ? `1.5px solid ${accent}` : '1px solid var(--border-subtle)',
            cursor: options.length === 0 ? 'not-allowed' : 'pointer',
            opacity: options.length === 0 ? 0.5 : 1
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-bold uppercase tracking-widest mb-0.5" style={{ color: accent }}>
              {title}
            </div>
            <div className="text-[12.5px] font-semibold truncate" style={{ color: selected.size > 0 ? 'var(--text-1)' : 'var(--text-3)' }}>
              {options.length === 0 ? 'Nenhum valor cadastrado' : triggerLabel}
            </div>
          </div>
          <ChevronDown
            className="w-4 h-4 transition-transform flex-shrink-0"
            style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </button>

        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex-shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md transition-all"
            style={{ color: accent, background: `${accent}14` }}
            title="Limpar selecao"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Chips dos selecionados (sempre visiveis) */}
      {selectedArr.length > 0 && (
        <div className="px-2.5 pb-2.5 flex flex-wrap gap-1.5">
          {selectedArr.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all"
              style={{
                background: accent,
                color: '#fff',
                border: `1px solid ${accent}`,
                boxShadow: `0 2px 8px ${accent}33`
              }}
              title="Remover"
            >
              <span className="truncate max-w-[160px]">{opt.value}</span>
              <X className="w-3 h-3 opacity-80" />
            </button>
          ))}
        </div>
      )}

      {/* Painel de busca / opcoes */}
      {open && (
        <div
          className="absolute left-0 right-0 z-20 rounded-xl overflow-hidden"
          style={{
            top: 'calc(100% + 4px)',
            background: 'var(--surface-0)',
            border: `1.5px solid ${accent}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)'
          }}
        >
          <div
            className="p-2 flex items-center gap-2"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${title.toLowerCase()}... (${options.length} opcoes)`}
              className="flex-1 bg-transparent text-[13px] outline-none"
              style={{ color: 'var(--text-1)' }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-[11px] font-semibold"
                style={{ color: 'var(--text-3)' }}
              >
                limpar
              </button>
            )}
          </div>

          <div
            className="max-h-[280px] overflow-y-auto custom-scrollbar"
            style={{ background: 'var(--surface-0)' }}
          >
            {filteredOptions.length === 0 ? (
              <p className="text-center py-6 text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                Nenhum resultado para "{search}"
              </p>
            ) : (
              filteredOptions.map((opt) => {
                const isSel = selected.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onToggle(opt.value)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all"
                    style={{
                      background: isSel ? `${accent}10` : 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-1)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    <div
                      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        background: isSel ? accent : 'transparent',
                        border: `1.5px solid ${isSel ? accent : 'var(--border-subtle)'}`
                      }}
                    >
                      {isSel && <CheckCircle2 className="w-3 h-3" style={{ color: '#fff' }} />}
                    </div>
                    <span
                      className="flex-1 min-w-0 truncate text-[13px]"
                      style={{ color: 'var(--text-1)', fontWeight: isSel ? 600 : 500 }}
                    >
                      {opt.value}
                    </span>
                    <span
                      className="flex-shrink-0 text-[10.5px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: isSel ? accent : 'var(--surface-2)',
                        color: isSel ? '#fff' : 'var(--text-3)'
                      }}
                    >
                      {opt.count}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Rodape do painel: contagem + atalho fechar */}
          <div
            className="flex items-center justify-between px-3 py-2 text-[11px]"
            style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <span style={{ color: 'var(--text-3)' }}>
              {filteredOptions.length} de {options.length} • {selected.size} selecionad{selected.size === 1 ? 'a' : 'as'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-semibold"
              style={{ color: accent }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
