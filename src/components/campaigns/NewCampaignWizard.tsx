import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  X,
  Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  CampaignReplyFlow,
  CampaignScheduleSlot,
  Contact,
  ContactList,
  ConnectionStatus,
  WhatsAppConnection
} from '../../types';
import type { CampaignWizardDraft } from '../../types/campaignMission';
import { parseWeddingDayMonth, yearsCelebratingAtNextAnniversary } from '../../utils/weddingAnniversary';
import { campaignRecipientNameVars } from '../../utils/contactNameNormalize';
import { analyzeMessageRisk } from '../../utils/messageRiskScore';
import {
  computeNextRunIso,
  dayOfWeekForCalendarDateInZone,
  formatTodayYmdInZone,
  localDateTimeToUtcIso
} from '../../utils/campaignSchedule';
import {
  computeContactTemperatures,
  CONTACT_TEMP_LABEL,
  type ContactTemperature,
  type TempStats
} from '../../utils/contactTemperature';
import { useZapMassCore, useZapMassConversations } from '../../context/ZapMassContext';
import { Badge, Button, Card, Input, SectionHeader, Textarea } from '../ui';
import { SegmentCampaignIdeas } from '../segment/SegmentCampaignIdeas';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import { applyCampaignMessagePreviewVars, insertCampaignTokenIntoTextarea } from '../../utils/campaignMessageVariables';
import { prepareCampaignAttachmentForSend } from '../../utils/campaignMediaCompress';
import {
  explainWhatsAppMediaFallback,
  mediaShouldSendAsDocument
} from '../../utils/whatsappMediaLimits';
import { normPhoneKey } from '../../utils/brPhoneNormalize';

type CampaignFlowMode = 'sequential' | 'reply';

type MessageStageOptionDraft = {
  id: string;
  tokensText: string;
  reply: string;
  marketingEffect: 'none' | 'opt_in' | 'opt_out';
};

type MessageStageDraft = {
  id: string;
  body: string;
  acceptAnyReply: boolean;
  validTokensText: string;
  invalidReplyBody: string;
  /** Quando a resposta for válida nesta etapa (fluxo por respostas). */
  marketingEffect: 'none' | 'opt_in' | 'opt_out';
  optionsMode?: 'linear' | 'conditional';
  options?: MessageStageOptionDraft[];
};

const newMessageStageOption = (): MessageStageOptionDraft => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `o-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  tokensText: '1',
  reply: '',
  marketingEffect: 'none'
});

const newMessageStage = (): MessageStageDraft => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  body: '',
  acceptAnyReply: true,
  validTokensText: '1, 2, sim, nao',
  invalidReplyBody: 'Não entendi. Responda com uma das opções válidas.',
  marketingEffect: 'none',
  optionsMode: 'linear',
  options: []
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
    launchMode?: 'now' | 'schedule';
    schedule?: {
      timeZone: string;
      slots: CampaignScheduleSlot[];
      repeatWeekly: boolean;
      onceLocalDate?: string;
      onceLocalTime?: string;
    };
    /** Peso por chip (somente uso real no servidor no modo sequencial; 1 = igual em todos). */
    channelWeights?: Record<string, number>;
    /**
     * Anexo unico (foto, video, audio ou arquivo) que segue junto com a 1a etapa,
     * com o texto da 1a etapa como legenda. Disponivel apenas em "disparar
     * agora" — agendamento ainda nao suporta anexo.
     */
    mediaAttachment?: {
      dataBase64: string;
      mimeType: string;
      fileName: string;
      /** Quando true, força envio como documento para aumentar a entregabilidade. */
      sendMediaAsDocument?: boolean;
    };
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
  /** Conversas globais (socket) — usadas só para calcular temperatura. Tomadas via contexto isolado para evitar prop-drilling pesado e caching deferred. */
  const conversations = useZapMassConversations();
  const deferredConversations = useDeferredValue(conversations);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [sendMode, setSendMode] = useState<SendMode>('list');
  const [manualNumbers, setManualNumbers] = useState('');
  const [name, setName] = useState('');
  const [messageStages, setMessageStages] = useState<MessageStageDraft[]>(() => [newMessageStage(), newMessageStage()]);
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [campaignFlowMode, setCampaignFlowMode] = useState<CampaignFlowMode>('sequential');
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  /** Distribuição de carga entre chips (somente modo sequencial, 2+ conectados). */
  const [channelWeightMode, setChannelWeightMode] = useState<'equal' | 'custom'>('equal');
  const [channelWeightsById, setChannelWeightsById] = useState<Record<string, number>>({});
  const [delaySeconds, setDelaySeconds] = useState(45);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Checklist obrigatoria antes de disparar ou agendar (passo 4). */
  const [preflightAck, setPreflightAck] = useState({
    audience: false,
    messages: false,
    responsibility: false
  });
  const [quickTestPhone, setQuickTestPhone] = useState('');
  const [quickTestBusy, setQuickTestBusy] = useState(false);
  const [quickTestSentOk, setQuickTestSentOk] = useState(false);
  const { socket } = useZapMassCore();
  /** Laboratório A/B: duas campanhas com 1ª mensagem diferente (apenas sequencial). */
  const [abLabEnabled, setAbLabEnabled] = useState(false);
  const [abFirstBodyB, setAbFirstBodyB] = useState('');
  const [abPercentEach, setAbPercentEach] = useState(5);
  const [launchMode, setLaunchMode] = useState<'now' | 'schedule'>('now');
  const [repeatWeekly, setRepeatWeekly] = useState(true);
  const [onceScheduleDate, setOnceScheduleDate] = useState('');
  const [onceScheduleTime, setOnceScheduleTime] = useState('');
  const [dayTimes, setDayTimes] = useState<string[]>(() => Array.from({ length: 7 }, () => ''));
  const scheduleTimeZone = useMemo(
    () => (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '') || 'America/Sao_Paulo',
    []
  );
  const scheduleDateMin = useMemo(() => formatTodayYmdInZone(scheduleTimeZone), [scheduleTimeZone]);
  // Filtros por atributo do contato
  const [filterCities, setFilterCities] = useState<Set<string>>(new Set());
  const [filterChurches, setFilterChurches] = useState<Set<string>>(new Set());
  const [filterRoles, setFilterRoles] = useState<Set<string>>(new Set());
  const [filterProfessions, setFilterProfessions] = useState<Set<string>>(new Set());
  const [filterDDDs, setFilterDDDs] = useState<Set<string>>(new Set());
  /** Vazio = todas; caso contrário filtra por temperatura CRM (lista e modo filtro). */
  const [filterTemps, setFilterTemps] = useState<Set<ContactTemperature>>(new Set());
  const [filterSearch, setFilterSearch] = useState('');
  // Escolha individual: quando nao vazio, sobrescreve a selecao automatica dos filtros
  const [selectedContactPhones, setSelectedContactPhones] = useState<Set<string>>(new Set());
  const [manualSelection, setManualSelection] = useState(false);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const invalidReplyRef = useRef<HTMLTextAreaElement>(null);
  const abFirstBodyBRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Anexo unico da campanha — vai junto com a 1a etapa de cada destinatario,
   * com o texto da 1a etapa funcionando como legenda. Suporta foto, video,
   * audio ou arquivo (PDF/DOC/etc). Para enviar links, basta colar a URL no texto.
   *
   * Limite tecnico do app: alinhado ao chat (200 MB padrao). Para evitar inflar
   * o snapshot agendado com base64, anexos so funcionam em "disparar agora".
   */
  const CAMPAIGN_ATTACHMENT_LIMIT_MB = Math.max(
    1,
    Math.min(2048, Number(import.meta.env.VITE_CHAT_UPLOAD_LIMIT_MB) || 200)
  );
  const CAMPAIGN_ATTACHMENT_LIMIT_BYTES = CAMPAIGN_ATTACHMENT_LIMIT_MB * 1024 * 1024;
  const [campaignAttachment, setCampaignAttachment] = useState<{
    file: File;
    previewUrl: string | null;
    sendAsDocument: boolean;
  } | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (campaignAttachment?.previewUrl) URL.revokeObjectURL(campaignAttachment.previewUrl);
    };
  }, [campaignAttachment]);

  const onPickAttachment = (file?: File | null) => {
    if (!file) return;
    if (file.size > CAMPAIGN_ATTACHMENT_LIMIT_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      toast.error(
        `Arquivo de ${sizeMb} MB excede o limite de ${CAMPAIGN_ATTACHMENT_LIMIT_MB} MB.`,
        { duration: 6000 }
      );
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      return;
    }
    const sendAsDocument = mediaShouldSendAsDocument(file);
    const fallbackHint = explainWhatsAppMediaFallback(file);
    if (fallbackHint) {
      toast(fallbackHint, { duration: 7000 });
    }
    if (campaignAttachment?.previewUrl) URL.revokeObjectURL(campaignAttachment.previewUrl);
    const isMedia = file.type.startsWith('image/') || file.type.startsWith('video/');
    setCampaignAttachment({
      file,
      previewUrl: isMedia ? URL.createObjectURL(file) : null,
      sendAsDocument
    });
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  const removeAttachment = () => {
    if (campaignAttachment?.previewUrl) URL.revokeObjectURL(campaignAttachment.previewUrl);
    setCampaignAttachment(null);
  };

  /** Le o arquivo do anexo como base64 para enviar pelo socket. */
  const readAttachmentAsBase64 = async (
    file: File
  ): Promise<{ dataBase64: string; mimeType: string; fileName: string }> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler arquivo anexado.'));
      reader.readAsDataURL(file);
    });
    const commaIdx = dataUrl.indexOf(',');
    const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
    if (!dataBase64) throw new Error('Nao foi possivel processar o arquivo anexado.');
    return {
      dataBase64,
      mimeType: file.type || 'application/octet-stream',
      fileName: file.name || 'anexo'
    };
  };

  useEffect(() => {
    setChannelWeightsById((prev) => {
      const next = { ...prev };
      for (const id of selectedConnectionIds) {
        const v = next[id];
        if (v == null || !Number.isFinite(Number(v)) || Number(v) < 1) next[id] = 1;
      }
      for (const k of Object.keys(next)) {
        if (!selectedConnectionIds.includes(k)) delete next[k];
      }
      return next;
    });
  }, [selectedConnectionIds]);

  const onlineConnections = useMemo(
    () => connections.filter((conn) => conn.status === ConnectionStatus.CONNECTED),
    [connections]
  );

  /**
   * Temperatura por contato: cálculo pesado roda em `requestIdleCallback` para não travar o passo do assistente
   * a cada `conversations-update` recebido pelo socket.
   */
  const [contactTemps, setContactTemps] = useState<Record<string, TempStats>>({});
  const contactTempsGenRef = useRef(0);
  useEffect(() => {
    const gen = ++contactTempsGenRef.current;
    const c = contacts;
    const conv = deferredConversations;
    const run = () => {
      if (gen !== contactTempsGenRef.current) return;
      const next = computeContactTemperatures(c, conv || []);
      if (gen !== contactTempsGenRef.current) return;
      startTransition(() => setContactTemps(next));
    };
    let idleId: ReturnType<typeof requestIdleCallback> | ReturnType<typeof setTimeout>;
    if (typeof requestIdleCallback !== 'undefined') {
      idleId = requestIdleCallback(run, { timeout: 1500 });
    } else {
      idleId = setTimeout(run, 0);
    }
    return () => {
      if (typeof cancelIdleCallback !== 'undefined' && typeof requestIdleCallback !== 'undefined') {
        cancelIdleCallback(idleId as number);
      } else {
        clearTimeout(idleId as ReturnType<typeof setTimeout>);
      }
    };
  }, [contacts, deferredConversations]);

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

  const marketingOptOutPhoneKeys = useMemo(
    () => new Set(contacts.filter((c) => c.marketingOptOut).map((c) => normPhoneKey(c.phone))),
    [contacts]
  );

  const selectedListContactsForSend = useMemo(() => {
    const withoutOptOut = selectedListContacts.filter((c) => !c.marketingOptOut);
    if (filterTemps.size === 0) return withoutOptOut;
    return withoutOptOut.filter((c) =>
      filterTemps.has((contactTemps[c.id]?.temp ?? 'new') as ContactTemperature)
    );
  }, [selectedListContacts, filterTemps, contactTemps]);

  const listOptOutExcludedCount = useMemo(
    () => selectedListContacts.filter((c) => c.marketingOptOut).length,
    [selectedListContacts]
  );

  const selectedListNumbers = useMemo(
    () => selectedListContactsForSend.map((c) => c.phone),
    [selectedListContactsForSend]
  );

  const invalidSelectedListCount = selectedList
    ? Math.max(selectedList.contactIds.length - selectedListNumbers.length, 0)
    : 0;

  const rawManualNumbers = useMemo(
    () =>
      Array.from(
        new Set(
          manualNumbers
            .split(/[\n,;]/)
            .map((item) => item.replace(/\D/g, ''))
            .filter((item) => item.length >= 10)
        )
      ),
    [manualNumbers]
  );

  const manualNumbersForSend = useMemo(
    () => rawManualNumbers.filter((n) => !marketingOptOutPhoneKeys.has(normPhoneKey(n))),
    [rawManualNumbers, marketingOptOutPhoneKeys]
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
      if (c.marketingOptOut) continue;
      if (filterCities.size > 0 && !filterCities.has(normalize(c.city))) continue;
      if (filterChurches.size > 0 && !filterChurches.has(normalize(c.church))) continue;
      if (filterRoles.size > 0 && !filterRoles.has(normalize(c.role))) continue;
      if (filterProfessions.size > 0 && !filterProfessions.has(normalize(c.profession))) continue;
      if (filterDDDs.size > 0 && !filterDDDs.has(extractDDD(phone))) continue;
      if (filterTemps.size > 0) {
        const tp = (contactTemps[c.id]?.temp ?? 'new') as ContactTemperature;
        if (!filterTemps.has(tp)) continue;
      }
      seen.add(phone);
      out.push({ ...c, phone });
    }
    return out;
  }, [
    sendMode,
    contacts,
    filterCities,
    filterChurches,
    filterRoles,
    filterProfessions,
    filterDDDs,
    filterTemps,
    contactTemps
  ]);

  // Lista visivel no picker (elegiveis + busca textual)
  const visibleContacts = useMemo<Contact[]>(() => {
    const term = filterSearch.trim().toLowerCase();
    if (!term) return eligibleContacts;
    return eligibleContacts.filter((c) => {
      const hay = `${c.name || ''} ${c.city || ''} ${c.church || ''} ${c.role || ''} ${c.profession || ''} ${c.phone}`.toLowerCase();
      return hay.includes(term);
    });
  }, [eligibleContacts, filterSearch]);

  const filterPickerScrollRef = useRef<HTMLDivElement>(null);
  const filterContactsVirtualCount =
    step === 1 && sendMode === 'filter' && eligibleContacts.length > 0 ? visibleContacts.length : 0;
  const filterContactsVirtualizer = useVirtualizer({
    count: filterContactsVirtualCount,
    getScrollElement: () => filterPickerScrollRef.current,
    estimateSize: () => 58,
    overscan: 10,
    getItemKey: (index) => {
      const row = visibleContacts[index];
      return row ? `${row.id || ''}:${row.phone}` : String(index);
    }
  });

  /** Uma passagem O(n) em `visibleContacts` — evita `.every`/`.some` em milhares de linhas a cada render. */
  const visibleSelectionStats = useMemo(() => {
    const n = visibleContacts.length;
    if (!manualSelection || n === 0) {
      return { allVisible: false, someVisible: false };
    }
    let sel = 0;
    for (const c of visibleContacts) {
      if (selectedContactPhones.has(c.phone)) sel++;
    }
    return {
      allVisible: sel === n,
      someVisible: sel > 0 && sel < n
    };
  }, [manualSelection, visibleContacts, selectedContactPhones]);

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
    setFilterTemps(new Set());
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
    if (filterTemps.size > 0) {
      const labels = [...filterTemps].map((k) => CONTACT_TEMP_LABEL[k]).join(', ');
      parts.push(`temp: ${labels}`);
    }
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
    manualSelection && visibleContacts.length > 0 && visibleSelectionStats.allVisible;
  const someVisibleSelected = manualSelection && visibleSelectionStats.someVisible;

  const renderTemperatureFilter = () => (
    <div
      className="mt-4 rounded-xl p-3 space-y-2"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
    >
      <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
        Temperatura do CRM (opcional)
      </p>
      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
        Vazio = todos. Marque uma ou mais faixas para limitar o disparo conforme engajamento nas conversas (quente /
        morno / frio / sem histórico).
      </p>
      <div className="flex flex-wrap gap-2">
        {(['hot', 'warm', 'cold', 'new'] as const).map((key) => {
          const on = filterTemps.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFilterTemps((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors"
              style={{
                borderColor: on ? 'rgba(16,185,129,0.45)' : 'var(--border-subtle)',
                background: on ? 'var(--surface-selected-brand)' : 'var(--surface-0)',
                color: 'var(--text-1)'
              }}
            >
              {CONTACT_TEMP_LABEL[key]}
            </button>
          );
        })}
      </div>
    </div>
  );

  const getConnectedSelectedIds = () => {
    const connectedIdSet = new Set(onlineConnections.map((conn) => conn.id));
    return selectedConnectionIds.filter((id) => connectedIdSet.has(id));
  };

  const activeMessageBody = messageStages[activeStageIdx]?.body ?? '';
  const messageRisk = useMemo(() => analyzeMessageRisk(activeMessageBody), [activeMessageBody]);
  /** Primeira etapa com texto — usada no teste rápido do passo 4. */
  const firstMessageStageBody = useMemo(
    () => messageStages.map((s) => s.body.trim()).find((b) => b.length > 0) || '',
    [messageStages]
  );

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
    setMessageStages(
      initialDraft.messageStages.map((s) => ({
        ...newMessageStage(),
        ...s,
        id: s.id || newMessageStage().id,
        marketingEffect: s.marketingEffect ?? 'none'
      }))
    );
    setFilterCities(new Set(initialDraft.filterCities));
    setFilterChurches(new Set(initialDraft.filterChurches));
    setFilterRoles(new Set(initialDraft.filterRoles));
    setFilterProfessions(new Set(initialDraft.filterProfessions));
    setFilterDDDs(new Set(initialDraft.filterDDDs));
    setFilterTemps(new Set(initialDraft.filterTemps ?? []));
    setFilterSearch(initialDraft.filterSearch);
    setSelectedContactPhones(new Set(initialDraft.selectedContactPhones));
    setManualSelection(initialDraft.manualSelection);
    setChannelWeightMode(initialDraft.channelWeightMode ?? 'equal');
    setChannelWeightsById(
      initialDraft.channelWeights && Object.keys(initialDraft.channelWeights).length > 0
        ? { ...initialDraft.channelWeights }
        : {}
    );
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
    insertCampaignTokenIntoTextarea(msgRef.current, activeMessageBody, variable, (next) =>
      setMessageStages((prev) => prev.map((s, i) => (i === activeStageIdx ? { ...s, body: next } : s)))
    );
  };

  const insertInvalidReplyVariable = (variable: string) => {
    const cur = messageStages[activeStageIdx]?.invalidReplyBody ?? '';
    insertCampaignTokenIntoTextarea(invalidReplyRef.current, cur, variable, (next) =>
      patchActiveStage({ invalidReplyBody: next })
    );
  };

  const addStageOption = () => {
    const stage = messageStages[activeStageIdx];
    if (!stage) return;
    const currentOptions = stage.options || [];
    patchActiveStage({
      options: [...currentOptions, newMessageStageOption()]
    });
  };

  const removeStageOption = (optId: string) => {
    const stage = messageStages[activeStageIdx];
    if (!stage) return;
    const currentOptions = stage.options || [];
    patchActiveStage({
      options: currentOptions.filter((opt) => opt.id !== optId)
    });
  };

  const updateStageOption = (optId: string, patch: Partial<MessageStageOptionDraft>) => {
    const stage = messageStages[activeStageIdx];
    if (!stage) return;
    const currentOptions = stage.options || [];
    patchActiveStage({
      options: currentOptions.map((opt) => (opt.id === optId ? { ...opt, ...patch } : opt))
    });
  };

  const insertAbFirstBodyBVariable = (variable: string) => {
    insertCampaignTokenIntoTextarea(abFirstBodyBRef.current, abFirstBodyB, variable, setAbFirstBodyB);
  };

  const numbers =
    sendMode === 'list'
      ? selectedListNumbers
      : sendMode === 'manual'
      ? manualNumbersForSend
      : filteredNumbers;
  const connectedIds = getConnectedSelectedIds();

  const canGoFromAudience =
    sendMode === 'list'
      ? selectedListNumbers.length > 0
      : sendMode === 'manual'
      ? manualNumbersForSend.length > 0
      : filteredNumbers.length > 0;
  const replyFlowGatesOk =
    campaignFlowMode !== 'reply' ||
    (messageStages.length >= 1 &&
      messageStages.every((s) => {
        if (s.acceptAnyReply) return true;
        if (s.optionsMode === 'conditional') {
          return (
            Array.isArray(s.options) &&
            s.options.length > 0 &&
            s.options.every((opt) => parseValidTokensText(opt.tokensText).length > 0 && opt.reply.trim().length > 0) &&
            s.invalidReplyBody.trim().length > 0
          );
        }
        const toks = parseValidTokensText(s.validTokensText);
        return toks.length > 0 && s.invalidReplyBody.trim().length > 0;
      }));

  const canGoFromMessage =
    name.trim().length > 0 &&
    messageStages.length > 0 &&
    messageStages.every((s) => s.body.trim().length > 0) &&
    replyFlowGatesOk &&
    (campaignFlowMode !== 'reply' || 
      (messageStages[0]?.optionsMode === 'conditional' ? messageStages.length >= 1 : messageStages.length >= 2));
  const canGoFromChannels = connectedIds.length > 0;
  const abLabOk =
    !abLabEnabled ||
    (campaignFlowMode === 'sequential' && abFirstBodyB.trim().length > 0 && messageStages.length >= 1);
  const scheduleSlots = useMemo((): CampaignScheduleSlot[] => {
    if (!repeatWeekly) {
      const ymd = onceScheduleDate.trim();
      const rawT = onceScheduleTime.trim();
      if (!ymd || !rawT) return [];
      const t = rawT.length >= 5 ? rawT.slice(0, 5) : rawT;
      const dow = dayOfWeekForCalendarDateInZone(ymd, scheduleTimeZone);
      return [{ dayOfWeek: dow, time: t }];
    }
    const out: CampaignScheduleSlot[] = [];
    dayTimes.forEach((raw, dow) => {
      const t = (raw || '').trim();
      if (!t) return;
      out.push({ dayOfWeek: dow, time: t.length >= 5 ? t.slice(0, 5) : t });
    });
    return out;
  }, [repeatWeekly, onceScheduleDate, onceScheduleTime, scheduleTimeZone, dayTimes]);
  const nextRunPreview = useMemo(() => {
    if (launchMode !== 'schedule') return null;
    if (!repeatWeekly && onceScheduleDate.trim() && onceScheduleTime.trim()) {
      const t = onceScheduleTime.trim().slice(0, 5);
      return localDateTimeToUtcIso(onceScheduleDate.trim(), t, scheduleTimeZone);
    }
    if (scheduleSlots.length === 0) return null;
    return computeNextRunIso(scheduleSlots, scheduleTimeZone, Date.now());
  }, [
    launchMode,
    repeatWeekly,
    onceScheduleDate,
    onceScheduleTime,
    scheduleSlots,
    scheduleTimeZone
  ]);
  const scheduleOk = launchMode === 'now' || abLabEnabled || scheduleSlots.length > 0;
  const preflightComplete =
    preflightAck.audience && preflightAck.messages && preflightAck.responsibility;
  const canSubmit =
    canGoFromAudience &&
    canGoFromMessage &&
    canGoFromChannels &&
    !isSubmitting &&
    abLabOk &&
    scheduleOk &&
    preflightComplete;

  useEffect(() => {
    if (step !== 4) return;
    setPreflightAck({ audience: false, messages: false, responsibility: false });
  }, [step, launchMode]);

  useEffect(() => {
    if (step !== 4) setQuickTestSentOk(false);
  }, [step]);

  useEffect(() => {
    if (abLabEnabled) setLaunchMode('now');
  }, [abLabEnabled]);

  /** Disparo único: garante uma data inicial no dia corrente (fuso do assistente). */
  useEffect(() => {
    if (launchMode === 'schedule' && !repeatWeekly && !onceScheduleDate) {
      setOnceScheduleDate(formatTodayYmdInZone(scheduleTimeZone));
    }
  }, [launchMode, repeatWeekly, onceScheduleDate, scheduleTimeZone]);

  const buildRecipients = (): Array<{ phone: string; vars: Record<string, string> }> => {
    const fromContact = (c: Contact) => {
      const wedding = (c.religiousMemberProfile?.weddingDate || '').trim();
      const conjuge = (c.religiousMemberProfile?.spouseName || '').trim();
      const mdWed = parseWeddingDayMonth(wedding);
      const anosCasamento =
        mdWed?.fullYear != null ? yearsCelebratingAtNextAnniversary(mdWed) : null;
      const nv = campaignRecipientNameVars(c.name || '');
      return {
        phone: c.phone,
        vars: {
          nome: nv.nome,
          nome_completo: nv.nome_completo,
          telefone: c.phone,
          cidade: c.city || '',
          igreja: c.church || '',
          cargo: c.role || '',
          profissao: c.profession || '',
          aniversario: c.birthday || '',
          email: c.email || '',
          conjuge,
          data_bodas: wedding,
          anos_casamento: anosCasamento != null ? String(anosCasamento) : ''
        }
      };
    };
    if (sendMode === 'list') return selectedListContactsForSend.map(fromContact);
    if (sendMode === 'filter') return filteredContacts.map(fromContact);
    return numbers.map((phone) => ({ phone, vars: { telefone: phone } }));
  };

  const buildChannelWeightsPayload = (): Record<string, number> | undefined => {
    const ids = getConnectedSelectedIds();
    if (ids.length <= 1) return undefined;
    if (channelWeightMode === 'equal') {
      const o: Record<string, number> = {};
      ids.forEach((id) => {
        o[id] = 1;
      });
      return o;
    }
    const o: Record<string, number> = {};
    ids.forEach((id) => {
      o[id] = Math.max(1, Math.min(100, Math.round(Number(channelWeightsById[id]) || 1)));
    });
    return o;
  };

  const sendWizardQuickTest = () => {
    if (!socket?.connected) {
      toast.error('Sem ligação ao servidor. Aguarde ou recarregue a página.');
      return;
    }
    const fromId = getConnectedSelectedIds()[0];
    if (!fromId) {
      toast.error('Selecione um canal conectado (passo Canais).');
      return;
    }
    if (!firstMessageStageBody.trim()) {
      toast.error('Preencha pelo menos a primeira mensagem (passo Mensagem).');
      return;
    }
    const raw = quickTestPhone.replace(/\D/g, '');
    if (raw.length < 10) {
      toast.error('Indique um número válido com DDD.');
      return;
    }
    setQuickTestBusy(true);
    const onResult = (result: { success?: boolean; message?: string; error?: string }) => {
      socket?.off('test-dispatch-result', onResult);
      setQuickTestBusy(false);
      if (result?.success) {
        toast.success(result.message || 'Teste enviado com sucesso.');
        setQuickTestSentOk(true);
      } else {
        toast.error(result?.error || 'Falha ao enviar teste.');
      }
    };
    socket.on('test-dispatch-result', onResult);
    socket.emit('test-dispatch', {
      fromConnectionId: fromId,
      toPhone: quickTestPhone.trim(),
      message: firstMessageStageBody
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    /**
     * Anexo so funciona em "disparar agora" — agendamento exigiria persistir
     * o base64 no Firestore (limite de doc ~1 MB) ou subir para Storage.
     * Vamos avisar o usuario para escolher: ou tira o anexo ou tira o agendamento.
     */
    if (campaignAttachment && launchMode === 'schedule') {
      toast.error(
        'Anexos so funcionam em disparo imediato. Remova o anexo ou desative o agendamento.',
        { duration: 7000 }
      );
      return;
    }
    let mediaPayload:
      | { dataBase64: string; mimeType: string; fileName: string; sendMediaAsDocument?: boolean }
      | undefined;
    if (campaignAttachment?.file) {
      const prepToast = 'campaign-attachment-prep';
      try {
        toast.loading('A preparar anexo…', { id: prepToast, duration: 60000 });
        const prep = await prepareCampaignAttachmentForSend(campaignAttachment.file);
        toast.dismiss(prepToast);
        for (const h of prep.hints) {
          toast(h, { duration: 6000 });
        }
        const read = await readAttachmentAsBase64(prep.file);
        mediaPayload = {
          ...read,
          ...(prep.sendMediaAsDocument ? { sendMediaAsDocument: true } : {})
        };
      } catch (err) {
        toast.dismiss(prepToast);
        const m = err instanceof Error ? err.message : 'Falha ao ler anexo.';
        toast.error(m);
        return;
      }
    }
    const stagesBodies = messageStages.map((s) => s.body.trim()).filter((b) => b.length > 0);
    const replyFlow: CampaignReplyFlow | undefined =
      campaignFlowMode === 'reply'
        ? {
            enabled: true,
            steps: messageStages.map((s) => ({
              body: s.body.trim(),
              acceptAnyReply: s.acceptAnyReply,
              validTokens: parseValidTokensText(s.validTokensText),
              invalidReplyBody: s.invalidReplyBody.trim(),
              marketingEffect: s.marketingEffect ?? 'none'
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
      const base = {
        name: name.trim(),
        message: stagesBodies[0] || '',
        messageStages: stagesBodies,
        replyFlow,
        connectedIds,
        numbers,
        recipients: buildRecipients(),
        contactListMeta,
        delaySeconds,
        ...(campaignFlowMode === 'sequential' ? { channelWeights: buildChannelWeightsPayload() } : {}),
        ...(mediaPayload ? { mediaAttachment: mediaPayload } : {})
      };
      if (launchMode === 'schedule' && !abLabEnabled) {
        await onSubmit({
          ...base,
          launchMode: 'schedule' as const,
          schedule: {
            timeZone: scheduleTimeZone,
            slots: scheduleSlots,
            repeatWeekly,
            ...(repeatWeekly
              ? {}
              : {
                  onceLocalDate: onceScheduleDate.trim(),
                  onceLocalTime: onceScheduleTime.trim().slice(0, 5)
                })
          }
        });
      } else {
        await onSubmit({ ...base, launchMode: 'now' as const });
      }
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
        const cw = buildChannelWeightsPayload();
        await onSubmit({
          name: `${name.trim()} — Var A`,
          message: stagesBodies[0] || '',
          messageStages: stagesBodies,
          replyFlow: undefined,
          connectedIds,
          numbers: numsA,
          recipients: recA.length ? recA : numsA.map((phone) => ({ phone, vars: { telefone: phone } })),
          contactListMeta,
          delaySeconds,
          ...(cw ? { channelWeights: cw } : {}),
          ...(mediaPayload ? { mediaAttachment: mediaPayload } : {})
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
          delaySeconds,
          ...(cw ? { channelWeights: cw } : {}),
          ...(mediaPayload ? { mediaAttachment: mediaPayload } : {})
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

  const stagePreviewBodies = messageStages
    .map((s) => applyCampaignMessagePreviewVars(s.body))
    .filter((b) => b.trim().length > 0);

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

      {/* ── Cabeçalho do wizard ── */}
      <div
        className="rounded-2xl px-5 py-4 mb-5 flex items-center justify-between gap-4"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.06)'
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0 transition-colors hover:bg-[var(--surface-2)]"
            style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
            aria-label="Cancelar e voltar"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[16px] font-bold leading-tight truncate" style={{ color: 'var(--text-1)' }}>
              Nova Campanha
            </h1>
            <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              Configure passo a passo: público, mensagem, canais e revisão
            </p>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ background: 'var(--surface-selected-brand)', border: '1px solid rgba(16,185,129,0.2)' }}
        >
          <span className="text-[11px] font-bold" style={{ color: 'var(--brand-700)' }}>
            Passo {step} de 4
          </span>
        </div>
      </div>

      {/* ── Stepper com linha de progresso ── */}
      <div className="mb-5 relative">
        {/* Linha base */}
        <div
          className="absolute"
          style={{ top: 20, left: '12.5%', right: '12.5%', height: 2, background: 'var(--border-subtle)', zIndex: 0 }}
          aria-hidden
        />
        {/* Linha de progresso preenchida */}
        <div
          className="absolute"
          style={{
            top: 20,
            left: '12.5%',
            width: `${((step - 1) / 3) * 75}%`,
            height: 2,
            background: 'var(--brand-500)',
            zIndex: 0,
            transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)'
          }}
          aria-hidden
        />
        <div className="relative z-10 grid grid-cols-4 gap-2">
          {STEPS.map((s) => {
            const isActive = step === s.id;
            const isDone = step > s.id;
            const canJump =
              s.id <= step ||
              (s.id === 2 && canGoFromAudience) ||
              (s.id === 3 && canGoFromAudience && canGoFromMessage) ||
              (s.id === 4 && canGoFromAudience && canGoFromMessage && canGoFromChannels);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { if (canJump) setStep(s.id); }}
                disabled={!canJump}
                className="flex flex-col items-center gap-2 py-2 px-1 rounded-xl transition-all"
                style={{
                  background: isActive ? 'var(--surface-selected-brand)' : 'transparent',
                  border: isActive ? '1.5px solid rgba(16,185,129,0.3)' : '1.5px solid transparent',
                  cursor: canJump ? 'pointer' : 'default',
                  opacity: !canJump && !isDone && !isActive ? 0.45 : 1
                }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-bold transition-all"
                  style={{
                    background: isDone
                      ? 'var(--brand-500)'
                      : isActive
                      ? 'var(--brand-500)'
                      : 'var(--surface-2)',
                    color: isDone || isActive ? '#fff' : 'var(--text-3)',
                    boxShadow: isActive ? '0 0 0 4px rgba(16,185,129,0.18)' : isDone ? '0 2px 6px rgba(16,185,129,0.25)' : 'none'
                  }}
                >
                  {isDone ? <CheckCircle2 className="w-4.5 h-4.5" /> : s.id}
                </div>
                <div className="text-center hidden sm:block">
                  <p
                    className="text-[12px] font-semibold leading-tight"
                    style={{ color: isActive ? 'var(--brand-700)' : isDone ? 'var(--text-2)' : 'var(--text-3)' }}
                  >
                    {s.label}
                  </p>
                  <p className="text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--text-3)' }}>
                    {s.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* STEP 1: Audience */}
          {step === 1 && (
            <Card>
              {/* Título da etapa */}
              <div className="flex items-center gap-3 mb-5 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--brand-500)', boxShadow: '0 4px 12px rgba(16,185,129,0.28)' }}
                >
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
                    Para quem vamos enviar?
                  </h3>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    Escolha a estratégia de público para esta campanha
                  </p>
                </div>
              </div>

              {/* Cards de modo */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                {[
                  {
                    id: 'list' as const,
                    label: 'Lista de contatos',
                    icon: FileSpreadsheet,
                    desc: 'Use uma lista já criada e organizada na sua base',
                    badge: 'Recomendado',
                    badgeColor: '#10b981',
                    badgeBg: 'rgba(16,185,129,0.12)',
                    iconBg: '#10b981',
                    accent: 'rgba(16,185,129,0.28)'
                  },
                  {
                    id: 'filter' as const,
                    label: 'Por filtros',
                    icon: Filter,
                    desc: 'Segmente por cidade, DDD, cargo ou outro critério',
                    badge: 'Avançado',
                    badgeColor: '#6366f1',
                    badgeBg: 'rgba(99,102,241,0.12)',
                    iconBg: '#6366f1',
                    accent: 'rgba(99,102,241,0.28)'
                  },
                  {
                    id: 'manual' as const,
                    label: 'Números manuais',
                    icon: Phone,
                    desc: 'Cole uma lista de números avulsos diretamente',
                    badge: 'Rápido',
                    badgeColor: '#f59e0b',
                    badgeBg: 'rgba(245,158,11,0.12)',
                    iconBg: '#f59e0b',
                    accent: 'rgba(245,158,11,0.28)'
                  }
                ].map((m) => {
                  const isSel = sendMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSendMode(m.id)}
                      className="flex flex-col gap-3 p-4 rounded-xl text-left transition-all relative"
                      style={{
                        background: isSel ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
                        border: isSel ? `2px solid ${m.iconBg}` : '2px solid var(--border-subtle)',
                        boxShadow: isSel ? `0 4px 18px ${m.accent}` : 'none',
                        transform: isSel ? 'translateY(-1px)' : 'none'
                      }}
                    >
                      {/* Badge de tipo */}
                      <span
                        className="self-start text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                        style={{ background: m.badgeBg, color: m.badgeColor }}
                      >
                        {m.badge}
                      </span>
                      {/* Ícone */}
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center"
                        style={{
                          background: isSel ? m.iconBg : 'var(--surface-2)',
                          boxShadow: isSel ? `0 4px 12px ${m.accent}` : 'none'
                        }}
                      >
                        <m.icon
                          className="w-5 h-5"
                          style={{ color: isSel ? '#fff' : 'var(--text-2)' }}
                        />
                      </div>
                      {/* Texto */}
                      <div>
                        <p className="text-[13.5px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
                          {m.label}
                        </p>
                        <p className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                          {m.desc}
                        </p>
                      </div>
                      {/* Checkmark selecionado */}
                      {isSel && (
                        <CheckCircle2
                          className="w-4 h-4 absolute top-3 right-3"
                          style={{ color: m.iconBg }}
                        />
                      )}
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
                          background: isSel ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
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

              {sendMode === 'list' && selectedList && renderTemperatureFilter()}

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
                  {rawManualNumbers.length > 0 && (
                    <p
                      className="text-[11.5px] mt-1 font-semibold"
                      style={{ color: 'var(--brand-600)' }}
                    >
                      ✓ {manualNumbersForSend.length} número{manualNumbersForSend.length !== 1 ? 's' : ''} para
                      envio
                      {rawManualNumbers.length > manualNumbersForSend.length && (
                        <span style={{ color: 'var(--text-3)' }}>
                          {' '}
                          ({rawManualNumbers.length - manualNumbersForSend.length} na lista negra de marketing, ignorados)
                        </span>
                      )}
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
                      background: finalContacts.length > 0 ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
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
                    {(filterCities.size +
                      filterChurches.size +
                      filterRoles.size +
                      filterProfessions.size +
                      filterDDDs.size +
                      filterTemps.size +
                      (manualSelection ? 1 : 0)) >
                      0 && (
                      <Button variant="ghost" size="sm" leftIcon={<X className="w-3.5 h-3.5" />} onClick={clearAllFilters}>
                        Limpar tudo
                      </Button>
                    )}
                  </div>

                  {renderTemperatureFilter()}

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
                      <div
                        ref={filterPickerScrollRef}
                        className="max-h-72 min-h-0 overflow-y-auto divide-y"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        {visibleContacts.length === 0 ? (
                          <div className="text-center py-6 text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                            Nenhum contato bate com a busca.
                          </div>
                        ) : (
                          <div
                            className="divide-y"
                            style={{
                              height: filterContactsVirtualizer.getTotalSize(),
                              width: '100%',
                              position: 'relative',
                              borderColor: 'var(--border-subtle)'
                            }}
                          >
                            {filterContactsVirtualizer.getVirtualItems().map((vRow) => {
                              const c = visibleContacts[vRow.index];
                              if (!c) return null;
                              const effectivelySelected = manualSelection
                                ? selectedContactPhones.has(c.phone)
                                : true;
                              return (
                                <div
                                  key={`${c.id || ''}:${c.phone}`}
                                  data-index={vRow.index}
                                  ref={filterContactsVirtualizer.measureElement}
                                  className="absolute left-0 top-0 w-full"
                                  style={{ transform: `translateY(${vRow.start}px)` }}
                                >
                                  <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[var(--surface-2)] transition-colors border-b border-[var(--border-subtle)]">
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
                                      <span
                                        className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded hidden sm:inline"
                                        style={{
                                          background: 'var(--surface-0)',
                                          color: 'var(--text-3)',
                                          border: '1px solid var(--border-subtle)'
                                        }}
                                      >
                                        {c.church}
                                      </span>
                                    )}
                                  </label>
                                </div>
                              );
                            })}
                          </div>
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
                  {listOptOutExcludedCount > 0 && (
                    <div className="flex items-center justify-between text-[12px] mt-1">
                      <span style={{ color: 'var(--text-3)' }}>Lista negra de marketing (não recebem disparo)</span>
                      <span className="font-semibold" style={{ color: '#64748b' }}>
                        {listOptOutExcludedCount}
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
                  ? 'Fluxo por respostas: a etapa 1 é enviada na abertura. Quando o contato responder, o sistema envia a etapa 2 (e assim por diante), conforme as regras abaixo. Opcional: exija respostas como 1 ou 2 e defina um texto se errar.'
                  : 'Envio em sequência automática: cada contato recebe todas as etapas em ordem, uma após a outra, respeitando o intervalo anti-ban entre cada envio. Use variáveis dinâmicas para personalizar.'}
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
                    desc: 'Aguarda a resposta do contato antes da próxima mensagem.'
                  },
                  {
                    id: 'sequential' as const,
                    title: 'Sequência automática',
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
                        background: sel ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
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

              <div
                className="mb-4 rounded-xl p-3.5 text-[12px] leading-relaxed"
                style={{
                  background: 'rgba(59, 130, 246, 0.06)',
                  border: '1px solid rgba(59, 130, 246, 0.18)'
                }}
              >
                <p className="font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                  {campaignFlowMode === 'sequential' ? 'Sequência automática — como funciona' : 'Fluxo por respostas — como funciona'}
                </p>
                {campaignFlowMode === 'sequential' ? (
                  <p style={{ color: 'var(--text-2)' }}>
                    Todas as etapas entram na fila ao iniciar a campanha: cada contato recebe a etapa 1, depois a 2, etc.,{' '}
                    <strong style={{ color: 'var(--text-1)' }}>sem precisar responder</strong>. O intervalo entre envios vale
                    entre cada mensagem. Escolha este modo se você quer disparar várias mensagens em sequência.
                  </p>
                ) : (
                  <p style={{ color: 'var(--text-2)' }}>
                    Só a <strong style={{ color: 'var(--text-1)' }}>primeira</strong> etapa é enviada na abertura. As
                    seguintes só saem <strong style={{ color: 'var(--text-1)' }}>depois que o contato responder</strong>{' '}
                    e passar pela regra da etapa em espera (aceitar qualquer resposta ou palavras definidas em cada etapa).
                    Se parecer que “travou na primeira mensagem”, confira estas regras ou troque para sequência automática.
                    Em cada etapa você pode marcar efeito de CRM: quando a resposta for válida, registrar{' '}
                    <strong style={{ color: 'var(--text-1)' }}>autorização de marketing</strong> (lead quente) ou{' '}
                    <strong style={{ color: 'var(--text-1)' }}>lista negra</strong>, gravando o texto que a pessoa enviou.
                  </p>
                )}
              </div>

              {campaignFlowMode === 'sequential' ? (
                <>
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

                  <CampaignMessageVariableChips onInsert={insertVariable} density="full" />

                  <SegmentCampaignIdeas onApplyTemplate={(body) => setActiveMessageBody(body)} />

                  <Textarea
                    key={messageStages[activeStageIdx]?.id}
                    ref={msgRef}
                    placeholder="Ola {nome}! Temos uma oferta especial para voce em {cidade}..."
                    value={activeMessageBody}
                    onChange={(e) => setActiveMessageBody(e.target.value)}
                    style={{ minHeight: '160px' }}
                  />

                  {/* ============================ ANEXO DA CAMPANHA ============================
                      Foto / video / audio / arquivo enviado JUNTO com a 1a etapa, com o texto da 1a
                      etapa funcionando como legenda. Para enviar links, basta colar a URL no
                      texto — o WhatsApp gera o preview automaticamente. */}
                  {activeStageIdx === 0 && (
                    <div
                      className="mt-3 rounded-xl p-3.5"
                      style={{
                        background: 'var(--surface-1)',
                        border: '1px dashed var(--border-subtle)'
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                            Anexo da campanha
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                            Foto, video, audio ou arquivo enviado junto com a 1a etapa. O texto acima vira a legenda.
                          </p>
                        </div>
                        {!campaignAttachment && (
                          <>
                            <input
                              ref={attachmentInputRef}
                              type="file"
                              className="hidden"
                              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,application/*"
                              onChange={(e) => onPickAttachment(e.target.files?.[0] || null)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => attachmentInputRef.current?.click()}
                            >
                              Anexar
                            </Button>
                          </>
                        )}
                      </div>

                      {campaignAttachment ? (
                        <div
                          className="flex items-start gap-3 rounded-lg p-2.5"
                          style={{
                            background: 'var(--surface-0)',
                            border: '1px solid var(--border-subtle)'
                          }}
                        >
                          <div
                            className="rounded-md overflow-hidden flex items-center justify-center shrink-0"
                            style={{
                              width: 72,
                              height: 72,
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border-subtle)'
                            }}
                          >
                            {campaignAttachment.file.type.startsWith('image/') &&
                            campaignAttachment.previewUrl ? (
                              <img
                                src={campaignAttachment.previewUrl}
                                alt="anexo"
                                className="w-full h-full object-cover"
                              />
                            ) : campaignAttachment.file.type.startsWith('video/') &&
                              campaignAttachment.previewUrl ? (
                              <video
                                src={campaignAttachment.previewUrl}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                              />
                            ) : (
                              <FileSpreadsheet
                                className="w-8 h-8"
                                style={{ color: 'var(--text-3)' }}
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-[12.5px] font-semibold truncate"
                              style={{ color: 'var(--text-1)' }}
                              title={campaignAttachment.file.name}
                            >
                              {campaignAttachment.file.name}
                            </p>
                            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                              {(campaignAttachment.file.size / (1024 * 1024)).toFixed(2)} MB ·{' '}
                              {campaignAttachment.file.type || 'arquivo'}
                            </p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                onClick={removeAttachment}
                              >
                                Remover anexo
                              </Button>
                              {launchMode === 'schedule' && (
                                <span
                                  className="text-[10.5px] font-semibold"
                                  style={{ color: '#f59e0b' }}
                                >
                                  Anexos so funcionam em disparo imediato
                                </span>
                              )}
                              {campaignAttachment.sendAsDocument && (
                                <span
                                  className="text-[10.5px] font-semibold"
                                  style={{ color: '#0ea5e9' }}
                                >
                                  Sera enviado como documento para maior entrega
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11.5px] flex items-start gap-2" style={{ color: 'var(--text-3)' }}>
                          <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
                          <span>
                            Para enviar <strong>links</strong>, basta colar a URL no texto da etapa — o WhatsApp gera
                            o preview automaticamente.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-5 pt-1">
                  {/* CARD 1: MENSAGEM INICIAL */}
                  <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-0)] shadow-sm space-y-4">
                    <div className="flex items-center gap-2.5 pb-2.5 border-b border-[var(--border-subtle)]">
                      <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-black">1</div>
                      <div>
                        <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Mensagem de Abertura (Início do Fluxo)</h4>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Esta mensagem é enviada de imediato para iniciar o contato.</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Texto da Mensagem</label>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-1)] text-[var(--text-3)]">
                        {(messageStages[0]?.body || '').length} chars
                      </span>
                    </div>

                    <CampaignMessageVariableChips onInsert={(variable) => {
                      insertCampaignTokenIntoTextarea(msgRef.current, messageStages[0]?.body || '', variable, (next) =>
                        setMessageStages((prev) => prev.map((s, i) => (i === 0 ? { ...s, body: next } : s)))
                      )
                    }} density="full" />

                    <SegmentCampaignIdeas onApplyTemplate={(body) => {
                      setMessageStages((prev) => prev.map((s, i) => (i === 0 ? { ...s, body } : s)))
                    }} />

                    <Textarea
                      ref={msgRef}
                      placeholder="Olá {nome}! Tudo bem? Responda com 1 para Sim ou 2 para Não..."
                      value={messageStages[0]?.body || ''}
                      onChange={(e) => {
                        setMessageStages((prev) => prev.map((s, i) => (i === 0 ? { ...s, body: e.target.value } : s)))
                      }}
                      style={{ minHeight: '140px' }}
                    />
                    
                    {/* Anexo da campanha */}
                    <div className="pt-2 border-t border-[var(--border-subtle)]">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                            Anexo da campanha (Opcional)
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                            Foto, vídeo ou arquivo enviado junto com a mensagem de abertura.
                          </p>
                        </div>
                        {!campaignAttachment && (
                          <>
                            <input
                              ref={attachmentInputRef}
                              type="file"
                              className="hidden"
                              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,application/*"
                              onChange={(e) => onPickAttachment(e.target.files?.[0] || null)}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => attachmentInputRef.current?.click()}
                            >
                              Anexar
                            </Button>
                          </>
                        )}
                      </div>

                      {campaignAttachment ? (
                        <div
                          className="flex items-start gap-3 rounded-lg p-2.5"
                          style={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border-subtle)'
                          }}
                        >
                          <div
                            className="rounded-md overflow-hidden flex items-center justify-center shrink-0"
                            style={{
                              width: 60,
                              height: 60,
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border-subtle)'
                            }}
                          >
                            {campaignAttachment.file.type.startsWith('image/') &&
                            campaignAttachment.previewUrl ? (
                              <img
                                src={campaignAttachment.previewUrl}
                                alt="anexo"
                                className="w-full h-full object-cover"
                              />
                            ) : campaignAttachment.file.type.startsWith('video/') &&
                              campaignAttachment.previewUrl ? (
                              <video
                                src={campaignAttachment.previewUrl}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                              />
                            ) : (
                              <FileSpreadsheet
                                className="w-8 h-8"
                                style={{ color: 'var(--text-3)' }}
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                              {campaignAttachment.file.name}
                            </p>
                            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                              {(campaignAttachment.file.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                            <Button type="button" size="xs" variant="ghost" onClick={removeAttachment} className="mt-1">
                              Remover
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                          Sem anexo. Cole links normais no texto acima para o WhatsApp gerar o preview.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* SETA VISUAL */}
                  <div className="flex justify-center -my-2.5">
                    <div className="h-6 w-0.5 bg-dashed border-l-2 border-emerald-500/40"></div>
                  </div>

                  {/* CARD 2: REGRA DE RESPOSTA */}
                  <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-0)] shadow-sm space-y-3.5">
                    <div className="flex items-center gap-2.5 pb-2.5 border-b border-[var(--border-subtle)]">
                      <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-black">2</div>
                      <div>
                        <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Regra de Resposta (Configuração do Robô)</h4>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Escolha como o sistema deve agir quando o cliente responder à sua mensagem inicial.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        className="flex flex-col items-start p-3 rounded-xl border text-left transition-all"
                        style={{
                          background: messageStages[0]?.acceptAnyReply ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
                          borderColor: messageStages[0]?.acceptAnyReply ? 'var(--primary)' : 'var(--border-subtle)'
                        }}
                        onClick={() => {
                          setMessageStages((prev) => {
                            const first = { ...prev[0], acceptAnyReply: true, optionsMode: 'linear' as const };
                            const second = prev[1] || newMessageStage();
                            return [first, second];
                          });
                        }}
                      >
                        <span className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
                          💬 Qualquer Resposta
                        </span>
                        <span className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                          Se o contato responder qualquer texto, ele recebe uma próxima mensagem de resposta automática (Fluxo Linear).
                        </span>
                      </button>

                      <button
                        type="button"
                        className="flex flex-col items-start p-3 rounded-xl border text-left transition-all"
                        style={{
                          background: (!messageStages[0]?.acceptAnyReply && messageStages[0]?.optionsMode === 'conditional') ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
                          borderColor: (!messageStages[0]?.acceptAnyReply && messageStages[0]?.optionsMode === 'conditional') ? 'var(--primary)' : 'var(--border-subtle)'
                        }}
                        onClick={() => {
                          setMessageStages((prev) => {
                            const first = { 
                              ...prev[0], 
                              acceptAnyReply: false, 
                              optionsMode: 'conditional' as const,
                              options: prev[0]?.options && prev[0].options.length > 0 ? prev[0].options : [newMessageStageOption()]
                            };
                            return [first];
                          });
                        }}
                      >
                        <span className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
                          🤖 Menu de Opções (Múltipla Escolha)
                        </span>
                        <span className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                          Respostas direcionadas e específicas para opções exatas digitadas (Ex: se digitar 1, recebe X; se digitar 2, recebe Y).
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* SETA VISUAL */}
                  <div className="flex justify-center -my-2.5">
                    <div className="h-6 w-0.5 bg-dashed border-l-2 border-emerald-500/40"></div>
                  </div>

                  {/* CARD 3: AÇÕES DE RESPOSTA */}
                  {messageStages[0]?.acceptAnyReply ? (
                    <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-0)] shadow-sm space-y-4">
                      <div className="flex items-center gap-2.5 pb-2.5 border-b border-[var(--border-subtle)]">
                        <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-black">3</div>
                        <div>
                          <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Mensagem de Resposta Automática</h4>
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Esta mensagem será enviada automaticamente assim que o cliente responder à primeira mensagem.</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Texto da Resposta</label>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-1)] text-[var(--text-3)]">
                          {(messageStages[1]?.body || '').length} chars
                        </span>
                      </div>

                      <CampaignMessageVariableChips onInsert={(variable) => {
                        insertCampaignTokenIntoTextarea(null, messageStages[1]?.body || '', variable, (next) =>
                          setMessageStages((prev) => prev.map((s, i) => (i === 1 ? { ...s, body: next } : s)))
                        )
                      }} density="compact" />

                      <Textarea
                        placeholder="Obrigado por responder! Aqui estão as informações..."
                        value={messageStages[1]?.body || ''}
                        onChange={(e) => {
                          setMessageStages((prev) => {
                            const copy = [...prev];
                            if (!copy[1]) copy[1] = newMessageStage();
                            copy[1].body = e.target.value;
                            return copy;
                          });
                        }}
                        style={{ minHeight: '110px' }}
                      />

                      <div className="pt-3 mt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-3)' }}>
                          Efeito no CRM ao responder
                        </label>
                        <select
                          className="w-full rounded-lg border px-3 py-2 text-[12.5px]"
                          style={{
                            borderColor: 'var(--border)',
                            background: 'var(--surface-0)',
                            color: 'var(--text-1)'
                          }}
                          value={messageStages[0]?.marketingEffect || 'none'}
                          onChange={(e) => {
                            setMessageStages((prev) => prev.map((s, i) => (i === 0 ? { ...s, marketingEffect: e.target.value as any } : s)))
                          }}
                        >
                          <option value="none">Nenhum efeito extra</option>
                          <option value="opt_in">Autorizou marketing (lead quente) — grava o texto da resposta</option>
                          <option value="opt_out">Lista negra — não autorizou disparos (grava o texto da resposta)</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-0)] shadow-sm space-y-5">
                      <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-subtle)]">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-black">3</div>
                          <div>
                            <h4 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Configuração do Menu de Opções</h4>
                            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Cadastre as respostas para cada opção válida digitada pelo cliente.</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border bg-[var(--surface-1)] hover:bg-[var(--surface-2)] transition flex items-center gap-1.5"
                          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)' }}
                          onClick={addStageOption}
                        >
                          <Plus className="w-3.5 h-3.5" /> Adicionar Opção
                        </button>
                      </div>

                      <div className="space-y-4">
                        {(!messageStages[0]?.options || messageStages[0].options.length === 0) && (
                          <div className="text-center py-6 border border-dashed rounded-xl border-[var(--border-subtle)] text-[12px] text-amber-500">
                            Nenhuma opção cadastrada. Clique no botão acima para adicionar uma opção de resposta.
                          </div>
                        )}

                        {Array.isArray(messageStages[0]?.options) &&
                          messageStages[0].options.map((opt, oIdx) => (
                            <div
                              key={opt.id}
                              className="p-4 rounded-xl border shadow-sm space-y-3 relative transition hover:border-[var(--primary)]"
                              style={{
                                borderColor: 'var(--border-subtle)',
                                background: 'var(--surface-1)'
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                  Opção #{oIdx + 1}
                                </span>
                                <button
                                  type="button"
                                  className="p-1 text-red-500 hover:text-red-700 hover:bg-red-500/10 rounded transition"
                                  onClick={() => removeStageOption(opt.id)}
                                  title="Excluir opção"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                    Se o cliente responder com: (Ex: 1, sim)
                                  </label>
                                  <Input
                                    placeholder="Ex: 1, sim (separar por vírgula)"
                                    value={opt.tokensText}
                                    onChange={(e) => updateStageOption(opt.id, { tokensText: e.target.value })}
                                    className="h-9"
                                  />
                                </div>

                                <div>
                                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                    Efeito CRM
                                  </label>
                                  <select
                                    className="w-full rounded-lg border px-3 py-2 text-xs h-9"
                                    style={{
                                      borderColor: 'var(--border)',
                                      background: 'var(--surface-0)',
                                      color: 'var(--text-1)'
                                    }}
                                    value={opt.marketingEffect}
                                    onChange={(e) =>
                                      updateStageOption(opt.id, {
                                        marketingEffect: e.target.value as any
                                      })
                                    }
                                  >
                                    <option value="none">Nenhum efeito extra</option>
                                    <option value="opt_in">Autorizou marketing (lead quente)</option>
                                    <option value="opt_out">Lista negra (descadastrar)</option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                  Mensagem de resposta automática:
                                </label>
                                <Textarea
                                  placeholder="Excelente! Você escolheu Sim. Aqui está o link..."
                                  value={opt.reply}
                                  onChange={(e) => updateStageOption(opt.id, { reply: e.target.value })}
                                  style={{ minHeight: '65px' }}
                                  className="py-1.5"
                                />
                              </div>
                            </div>
                          ))}
                      </div>

                      {/* SE A RESPOSTA NÃO FOR VÁLIDA */}
                      <div className="pt-4 border-t border-[var(--border-subtle)] space-y-3">
                        <div>
                          <h5 className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>Se o cliente responder qualquer outra coisa (Mensagem de erro):</h5>
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Mensagem automática enviada se a resposta não bater com nenhuma opção acima.</p>
                        </div>

                        <CampaignMessageVariableChips onInsert={insertInvalidReplyVariable} density="compact" />
                        <Textarea
                          ref={invalidReplyRef}
                          placeholder="Opção inválida. Digite 1 para sim ou 2 para não."
                          value={messageStages[0]?.invalidReplyBody || ''}
                          onChange={(e) => {
                            setMessageStages((prev) => prev.map((s, i) => (i === 0 ? { ...s, invalidReplyBody: e.target.value } : s)))
                          }}
                          style={{ minHeight: '80px' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                            invalidReplyBody: s.invalidReplyBody,
                            marketingEffect: s.marketingEffect
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
                        <CampaignMessageVariableChips onInsert={insertInvalidReplyVariable} density="compact" />
                        <Textarea
                          ref={invalidReplyRef}
                          placeholder="Ex: Opcao invalida. Digite 1 para sim ou 2 para nao."
                          value={messageStages[activeStageIdx].invalidReplyBody}
                          onChange={(e) => patchActiveStage({ invalidReplyBody: e.target.value })}
                          style={{ minHeight: '72px' }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="pt-3 mt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-3)' }}>
                      Se a resposta for válida nesta etapa (CRM)
                    </label>
                    <select
                      className="w-full rounded-lg border px-3 py-2 text-[12.5px]"
                      style={{
                        borderColor: 'var(--border)',
                        background: 'var(--surface-0)',
                        color: 'var(--text-1)'
                      }}
                      value={messageStages[activeStageIdx].marketingEffect}
                      onChange={(e) =>
                        patchActiveStage({
                          marketingEffect: e.target.value as 'none' | 'opt_in' | 'opt_out'
                        })
                      }
                    >
                      <option value="none">Nenhum efeito extra</option>
                      <option value="opt_in">Autorizou marketing (lead quente) — grava o texto da resposta</option>
                      <option value="opt_out">Lista negra — não autorizou disparos (grava o texto da resposta)</option>
                    </select>
                    <p className="text-[10.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
                      Combina com “Respostas aceitas” quando você usa opções numeradas (ex.: 1 = sim, 2 = não).
                    </p>
                  </div>
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

                <p
                  className="text-[11px] mb-3 rounded-lg px-3 py-2"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-2)'
                  }}
                >
                  Vários chips selecionados: o ZapMass distribui os envios em rodízio entre eles. Se algum ficar offline
                  ou degradado durante a rodada, apenas os disponíveis entram nas próximas entregas; se todos falharem ao
                  iniciar, ajuste os canais e tente de novo ou retome quando houver pelo menos um pronto.
                </p>

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
                            background: isSel ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
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

              {campaignFlowMode === 'sequential' && getConnectedSelectedIds().length > 1 && onlineConnections.length > 0 && (
                <Card>
                  <div className="mb-3">
                    <h3 className="ui-title text-[15px]">Carga por canal</h3>
                    <p className="ui-subtitle text-[12.5px]">
                      Defina a proporção entre os chips selecionados (somente envio sequencial). Ex.: pesos 3 e 1 ≈ 75% e
                      25% dos destinos ao longo da fila.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(['equal', 'custom'] as const).map((m) => {
                      const sel = channelWeightMode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setChannelWeightMode(m)}
                          className="text-[12px] font-semibold px-3 py-2 rounded-lg border transition-colors"
                          style={{
                            borderColor: sel ? 'rgba(16,185,129,0.45)' : 'var(--border-subtle)',
                            background: sel ? 'var(--surface-selected-brand)' : 'var(--surface-1)',
                            color: 'var(--text-1)'
                          }}
                        >
                          {m === 'equal' ? 'Igual entre todos' : 'Pesos livres'}
                        </button>
                      );
                    })}
                  </div>
                  {channelWeightMode === 'custom' && (
                    <div className="space-y-2">
                      {onlineConnections
                        .filter((c) => selectedConnectionIds.includes(c.id))
                        .map((conn) => (
                          <div key={conn.id} className="flex items-center gap-3 flex-wrap">
                            <span className="text-[12.5px] font-medium min-w-[120px] truncate" style={{ color: 'var(--text-1)' }}>
                              {conn.name}
                            </span>
                            <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                              Peso
                              <input
                                type="number"
                                min={1}
                                max={100}
                                className="w-16 rounded-lg border px-2 py-1 text-[13px]"
                                style={{
                                  borderColor: 'var(--border)',
                                  background: 'var(--surface-0)',
                                  color: 'var(--text-1)'
                                }}
                                value={channelWeightsById[conn.id] ?? 1}
                                onChange={(e) =>
                                  setChannelWeightsById((prev) => ({
                                    ...prev,
                                    [conn.id]: Number(e.target.value) || 1
                                  }))
                                }
                              />
                            </label>
                          </div>
                        ))}
                    </div>
                  )}
                </Card>
              )}

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

              <div
                className="mb-5 p-4 rounded-xl space-y-3"
                style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)' }}
              >
                <p className="text-[12px] font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                  <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
                  Checklist antes do envio
                </p>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Marque cada item para liberar o botão «
                  {launchMode === 'schedule' ? 'Agendar campanha' : 'Iniciar disparo'}».
                </p>
                <label className="flex items-start gap-2.5 cursor-pointer text-[12.5px] leading-snug">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded"
                    checked={preflightAck.audience}
                    onChange={(e) => setPreflightAck((p) => ({ ...p, audience: e.target.checked }))}
                  />
                  <span style={{ color: 'var(--text-2)' }}>
                    Revisei o <strong>público</strong>:{' '}
                    <strong style={{ color: 'var(--text-1)' }}>{numbers.length}</strong> número(s) na fila.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer text-[12.5px] leading-snug">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded"
                    checked={preflightAck.messages}
                    onChange={(e) => setPreflightAck((p) => ({ ...p, messages: e.target.checked }))}
                  />
                  <span style={{ color: 'var(--text-2)' }}>
                    Revisei o(s) <strong>texto(s)</strong>, variáveis e (se houver) o fluxo por respostas.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer text-[12.5px] leading-snug">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded"
                    checked={preflightAck.responsibility}
                    onChange={(e) => setPreflightAck((p) => ({ ...p, responsibility: e.target.checked }))}
                  />
                  <span style={{ color: 'var(--text-2)' }}>
                    Os chips precisam estar <strong>Conectados</strong> no momento do disparo
                    {launchMode === 'schedule'
                      ? ' (na hora agendada ou em cada janela)'
                      : ''}
                    ; intervalo <strong>{delaySeconds}s</strong>; uso alinhado a WhatsApp e legislação (opt-in / spam).
                  </span>
                </label>
                {!preflightComplete && (
                  <p className="text-[11px] font-semibold" style={{ color: '#f59e0b' }}>
                    Marque os três itens acima para continuar.
                  </p>
                )}
              </div>

              <div
                className="mb-5 p-4 rounded-xl space-y-3"
                style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.28)' }}
              >
                <p className="text-[12px] font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                  <Smartphone className="w-4 h-4 text-blue-500" />
                  Teste rápido (recomendado)
                </p>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Envia apenas a <strong>primeira mensagem</strong> do fluxo pelo primeiro canal conectado selecionado.
                  Use o seu número ou um contacto de confiança antes de disparar para toda a lista.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <div className="flex-1 min-w-0">
                    <label className="ui-eyebrow mb-1 block" htmlFor="wizard-quick-test-phone">
                      Número (com DDD)
                    </label>
                    <Input
                      id="wizard-quick-test-phone"
                      value={quickTestPhone}
                      onChange={(e) => setQuickTestPhone(e.target.value)}
                      placeholder="ex. 5511999990000"
                      disabled={quickTestBusy}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    loading={quickTestBusy}
                    disabled={
                      quickTestBusy ||
                      !socket?.connected ||
                      !getConnectedSelectedIds()[0] ||
                      !firstMessageStageBody.trim()
                    }
                    onClick={sendWizardQuickTest}
                    className="shrink-0"
                  >
                    Enviar teste
                  </Button>
                </div>
                {numbers.length >= 25 && (
                  <p className="text-[11px] font-medium" style={{ color: '#6366f1' }}>
                    Lista com {numbers.length} contactos: enviar um teste primeiro reduz risco de erro em massa.
                  </p>
                )}
                {quickTestSentOk && (
                  <p
                    className="text-[11px] font-semibold flex items-center gap-1.5"
                    style={{ color: '#10b981' }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    Teste enviado nesta sessão — pode seguir para o disparo com mais confiança.
                  </p>
                )}
              </div>

              <div
                  className="mb-5 p-4 rounded-xl space-y-3"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                    Quando enviar
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setLaunchMode('now')}
                      className="px-3 py-2 rounded-lg text-[12px] font-bold transition-all"
                      style={
                        launchMode === 'now'
                          ? { background: 'var(--brand-500)', color: '#fff' }
                          : { background: 'var(--surface-0)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
                      }
                    >
                      Iniciar agora
                    </button>
                    <button
                      type="button"
                      onClick={() => setLaunchMode('schedule')}
                      disabled={abLabEnabled}
                      className="px-3 py-2 rounded-lg text-[12px] font-bold transition-all inline-flex items-center gap-1.5"
                      style={
                        launchMode === 'schedule'
                          ? { background: '#6366f1', color: '#fff' }
                          : {
                              background: 'var(--surface-0)',
                              color: abLabEnabled ? 'var(--text-3)' : 'var(--text-2)',
                              border: '1px solid var(--border-subtle)',
                              opacity: abLabEnabled ? 0.55 : 1
                            }
                      }
                    >
                      <Clock className="w-3.5 h-3.5" />
                      Agendar na semana
                    </button>
                  </div>
                  {abLabEnabled && (
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Laboratório A/B só pode ser disparado imediatamente (duas campanhas em sequência).
                    </p>
                  )}
                  {launchMode === 'schedule' && !abLabEnabled && (
                    <div className="space-y-3 pt-1">
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        Fuso: <strong style={{ color: 'var(--text-1)' }}>{scheduleTimeZone}</strong> — horários iguais aos do seu relógio local do navegador.
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer text-[12px]">
                        <input
                          type="checkbox"
                          checked={repeatWeekly}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRepeatWeekly(checked);
                            if (!checked && !onceScheduleDate) {
                              setOnceScheduleDate(formatTodayYmdInZone(scheduleTimeZone));
                            }
                          }}
                        />
                        Repetir toda semana (após cada conclusão, reagenda o próximo disparo igual à grade)
                      </label>
                      {!repeatWeekly ? (
                        <div
                          className="rounded-xl p-3 space-y-2"
                          style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
                        >
                          <p className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                            Data e hora do disparo
                          </p>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                              <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                                Dia
                              </span>
                              <input
                                type="date"
                                min={scheduleDateMin}
                                value={onceScheduleDate}
                                onChange={(e) => setOnceScheduleDate(e.target.value)}
                                className="rounded-md text-[13px] px-2 py-1.5 tabular-nums w-full max-w-[200px]"
                                style={{
                                  background: 'var(--surface-1)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-1)'
                                }}
                              />
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-[120px]">
                              <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                                Hora
                              </span>
                              <input
                                type="time"
                                value={onceScheduleTime}
                                onChange={(e) => setOnceScheduleTime(e.target.value)}
                                className="rounded-md text-[13px] px-2 py-1.5 tabular-nums"
                                style={{
                                  background: 'var(--surface-1)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-1)'
                                }}
                              />
                            </div>
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                            Um disparo só, na data exata escolhida (fuso acima — mesmo do navegador).
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label, dow) => (
                            <div
                              key={label}
                              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                              style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
                            >
                              <span className="text-[12px] font-semibold w-8" style={{ color: 'var(--text-2)' }}>
                                {label}
                              </span>
                              <input
                                type="time"
                                value={dayTimes[dow] || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setDayTimes((prev) => {
                                    const n = [...prev];
                                    n[dow] = v;
                                    return n;
                                  });
                                }}
                                className="rounded-md text-[13px] px-2 py-1 tabular-nums"
                                style={{
                                  background: 'var(--surface-1)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-1)'
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {nextRunPreview && (
                        <p className="text-[12px]" style={{ color: 'var(--brand-700)' }}>
                          Próximo disparo previsto:{' '}
                          <strong>
                            {new Date(nextRunPreview).toLocaleString('pt-BR', {
                              weekday: 'long',
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </strong>
                        </p>
                      )}
                    </div>
                  )}
                </div>

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
                        <CampaignMessageVariableChips onInsert={insertAbFirstBodyBVariable} density="compact" />
                        <Textarea
                          ref={abFirstBodyBRef}
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
                  value={campaignFlowMode === 'reply' ? 'Fluxo por respostas' : 'Sequência automática'}
                />
                <div
                  className="rounded-lg p-3 text-[12px] leading-snug -mt-1"
                  style={{
                    background: 'rgba(59, 130, 246, 0.055)',
                    border: '1px solid rgba(59, 130, 246, 0.16)'
                  }}
                >
                  {campaignFlowMode === 'sequential' ? (
                    <span style={{ color: 'var(--text-2)' }}>
                      Todas as etapas serão enviadas em fila para cada contato (intervalo entre cada envio). Não é
                      necessário que o destinatário responda entre uma mensagem e outra.
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-2)' }}>
                      Apenas a 1ª mensagem vai na abertura; as próximas só depois da resposta do contato e conforme as
                      regras por etapa (abaixo em “Mensagens”). Para disparar todas sem esperar resposta, volte ao passo
                      Mensagem e escolha sequência automática.
                    </span>
                  )}
                </div>
                <ReviewRow
                  label="Etapas"
                  value={`${messageStages.length} mensagem${messageStages.length !== 1 ? 'ns' : ''} por contato`}
                />
                <ReviewRow label="Estimativa" value={<span>{estimateLabel}</span>} />
                {launchMode === 'schedule' && !abLabEnabled && (
                  <ReviewRow
                    label="Agendamento"
                    value={
                      scheduleSlots.length
                        ? repeatWeekly
                          ? `${scheduleSlots.length} horário(s) na grade — repetir toda semana`
                          : `Disparo em ${onceScheduleDate || '—'} às ${(onceScheduleTime || '').slice(0, 5) || '—'} (uma vez)`
                        : repeatWeekly
                        ? 'Defina ao menos um dia da semana e hora'
                        : 'Escolha a data e a hora do disparo'
                    }
                  />
                )}
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
                        {applyCampaignMessagePreviewVars(s.body) || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* ── Barra de navegação ── */}
          <div
            className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 mt-2"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 -1px 8px rgba(0,0,0,0.04)'
            }}
          >
            <Button
              variant="secondary"
              leftIcon={step > 1 ? <ArrowLeft className="w-4 h-4" /> : undefined}
              onClick={() => (step > 1 ? setStep((step - 1) as 1 | 2 | 3 | 4) : onCancel())}
              disabled={isSubmitting}
            >
              {step > 1 ? 'Voltar' : 'Cancelar'}
            </Button>

            <div className="flex items-center gap-3">
              {/* Dots de progresso */}
              <div className="hidden sm:flex items-center gap-1.5">
                {STEPS.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-full transition-all"
                    style={{
                      width: step === s.id ? 20 : 6,
                      height: 6,
                      background: step > s.id
                        ? 'var(--brand-500)'
                        : step === s.id
                        ? 'var(--brand-500)'
                        : 'var(--border-subtle)'
                    }}
                  />
                ))}
              </div>

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
                  Avançar
                </Button>
              ) : (
                <Button
                  variant="primary"
                  leftIcon={<Send className="w-4 h-4" />}
                  onClick={handleSubmit}
                  loading={isSubmitting}
                  disabled={!canSubmit}
                >
                  {abLabEnabled
                    ? 'Iniciar laboratório (2 campanhas)'
                    : launchMode === 'schedule'
                      ? 'Agendar campanha'
                      : 'Iniciar disparo'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Painel de prévia ao vivo ── */}
        <div className="hidden lg:block">
          <div className="sticky top-4 space-y-3">
            {/* Header do painel */}
            <div
              className="rounded-xl px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: '#10b981', boxShadow: '0 0 6px #10b981' }}
              />
              <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>
                Prévia ao vivo
              </p>
            </div>

            {/* Simulador WhatsApp */}
            <div className="rounded-2xl overflow-hidden" style={{ background: '#0b141a', border: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Header contato */}
              <div
                className="px-4 py-3 flex items-center gap-3"
                style={{ background: '#1a2228', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', boxShadow: '0 2px 8px rgba(16,185,129,0.3)' }}
                >
                  Z
                </div>
                <div>
                  <p className="text-[12px] font-semibold" style={{ color: '#e9edef' }}>Contato</p>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#10b981' }} />
                    <p className="text-[10px]" style={{ color: '#10b981' }}>online</p>
                  </div>
                </div>
              </div>

              {/* Mensagens */}
              <div className="p-4 min-h-[180px] flex flex-col justify-end gap-2.5">
                {stagePreviewBodies.length > 0 ? (
                  stagePreviewBodies.map((body, idx) => (
                    <div key={`pv-${idx}`} className="self-end max-w-[92%]">
                      <p className="text-[9px] font-semibold mb-1 text-right" style={{ color: '#8696a0' }}>
                        Etapa {idx + 1}
                      </p>
                      <div
                        className="rounded-xl rounded-tr-none px-3 py-2 text-[12.5px] leading-[18px] whitespace-pre-wrap"
                        style={{
                          background: 'linear-gradient(135deg,#005c4b,#006b58)',
                          color: '#e9edef',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                        }}
                      >
                        {body}
                      </div>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[9px]" style={{ color: '#8696a0' }}>
                          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[10px]" style={{ color: '#53bdeb' }}>✓✓</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-50">
                    <Smartphone className="w-8 h-8" style={{ color: '#667781' }} />
                    <p className="text-center text-[11px]" style={{ color: '#667781' }}>
                      As mensagens aparecem aqui
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Resumo de configuração */}
            <div
              className="rounded-xl p-4 space-y-2.5"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
                Resumo
              </p>
              <SummaryRow label="Números" value={numbers.length.toLocaleString()} accent="var(--text-1)" />
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
          </div>
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
