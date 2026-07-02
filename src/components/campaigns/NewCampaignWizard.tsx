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
  Layers,
  MapPin,
  Phone,
  Plus,
  Search,
  MessageSquare,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  Wifi,
  X,
  Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import { type ConnectionPool, listConnectionPools } from '../../services/connectionPoolsApi';
import {
  CampaignReplyFlow,
  CampaignScheduleSlot,
  CampaignStageConfig,
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
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import { CampaignReplyFlowEditor } from './CampaignReplyFlowEditor';
import { CampaignFlowModePicker, type CampaignFlowMode } from './CampaignFlowModePicker';
import { CampaignSingleMessageEditor } from './CampaignSingleMessageEditor';
import { CampaignMessageSetupProgress } from './CampaignMessageSetupProgress';
import { createLibraryItem } from '../../services/campaignLibraryApi';
import { apiCheckScheduledDuplicates } from '../../services/campaignsApi';
import { applyCampaignMessagePreviewVars, insertCampaignTokenIntoTextarea, type CampaignPreviewSample } from '../../utils/campaignMessageVariables';
import { prepareCampaignAttachmentForSend } from '../../utils/campaignMediaCompress';
import {
  explainWhatsAppMediaFallback,
  mediaShouldSendAsDocument
} from '../../utils/whatsappMediaLimits';
import { normPhoneKey } from '../../utils/brPhoneNormalize';

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
    delaySecondsMax?: number;
    humanizedPauses?: boolean;
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
    /** Gatilhos avançados por etapa (motor multi-etapas persistente). Opcional. */
    stageConfigs?: CampaignStageConfig[];
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
    /** Mídia da mensagem automática após a resposta (fluxo por respostas). */
    followUpMediaAttachment?: {
      dataBase64: string;
      mimeType: string;
      fileName: string;
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
  const [messageStages, setMessageStages] = useState<MessageStageDraft[]>(() => [newMessageStage()]);
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [campaignFlowMode, setCampaignFlowMode] = useState<CampaignFlowMode>('single');
  const [flowModeChosen, setFlowModeChosen] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [selectedListId, setSelectedListId] = useState('');
  const [dailyScheduleEnabled, setDailyScheduleEnabled] = useState(false);
  const [dailyScheduleDays, setDailyScheduleDays] = useState<Array<{ dayIndex: number; limitPerChannel: number }>>([]);
  const [duplicatedContacts, setDuplicatedContacts] = useState<Array<{ phone: string; campaignName: string; campaignId: string }>>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [showDuplicateWarningModal, setShowDuplicateWarningModal] = useState(false);
  const [excludedDuplicatePhones, setExcludedDuplicatePhones] = useState<Set<string>>(new Set());
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  /** Modo de seleção de chips: 'manual' = individual, 'pool' = usar um pool. */
  const [chipSelectionMode, setChipSelectionMode] = useState<'manual' | 'pool'>('manual');
  const [availablePools, setAvailablePools] = useState<ConnectionPool[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  /** Distribuição de carga entre chips (2+ conectados). */
  const [channelWeightMode, setChannelWeightMode] = useState<'equal' | 'custom'>('equal');
  const [channelWeightsById, setChannelWeightsById] = useState<Record<string, number>>({});
  const [delaySeconds, setDelaySeconds] = useState(45);
  const [delaySecondsMax, setDelaySecondsMax] = useState(90);
  const [humanizedPauses, setHumanizedPauses] = useState(true);
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
  const [followUpAttachment, setFollowUpAttachment] = useState<{
    file: File;
    previewUrl: string | null;
    sendAsDocument: boolean;
  } | null>(null);
  const followUpAttachmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (campaignAttachment?.previewUrl) URL.revokeObjectURL(campaignAttachment.previewUrl);
    };
  }, [campaignAttachment]);

  useEffect(() => {
    return () => {
      if (followUpAttachment?.previewUrl) URL.revokeObjectURL(followUpAttachment.previewUrl);
    };
  }, [followUpAttachment]);

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

  const onPickFollowUpAttachment = (file?: File | null) => {
    if (!file) return;
    if (file.size > CAMPAIGN_ATTACHMENT_LIMIT_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      toast.error(
        `Arquivo de ${sizeMb} MB excede o limite de ${CAMPAIGN_ATTACHMENT_LIMIT_MB} MB.`,
        { duration: 6000 }
      );
      if (followUpAttachmentInputRef.current) followUpAttachmentInputRef.current.value = '';
      return;
    }
    const sendAsDocument = mediaShouldSendAsDocument(file);
    const fallbackHint = explainWhatsAppMediaFallback(file);
    if (fallbackHint) toast(fallbackHint, { duration: 7000 });
    if (followUpAttachment?.previewUrl) URL.revokeObjectURL(followUpAttachment.previewUrl);
    const isMedia = file.type.startsWith('image/') || file.type.startsWith('video/');
    setFollowUpAttachment({
      file,
      previewUrl: isMedia ? URL.createObjectURL(file) : null,
      sendAsDocument
    });
    if (followUpAttachmentInputRef.current) followUpAttachmentInputRef.current.value = '';
  };

  const removeFollowUpAttachment = () => {
    if (followUpAttachment?.previewUrl) URL.revokeObjectURL(followUpAttachment.previewUrl);
    setFollowUpAttachment(null);
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

  // Carrega pools disponíveis para o seletor do passo 3
  useEffect(() => {
    listConnectionPools()
      .then((pools) => setAvailablePools(pools))
      .catch(() => {}); // silencioso — pools são opcionais
  }, []);

  // Quando o usuário escolhe um pool, expande os IDs dos chips do pool
  const selectedPool = availablePools.find((p) => p.id === selectedPoolId);
  const resolvedConnectionIds: string[] =
    chipSelectionMode === 'pool' && selectedPool
      ? selectedPool.connectionIds
      : selectedConnectionIds;

  const getConnectedSelectedIds = () => {
    const connectedIdSet = new Set(onlineConnections.map((conn) => conn.id));
    return resolvedConnectionIds.filter((id) => connectedIdSet.has(id));
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
    if (!initialDraft) return;
    setName(initialDraft.name);
    setSendMode(initialDraft.sendMode);
    setManualNumbers(initialDraft.manualNumbers);
    setSelectedListId(initialDraft.selectedListId);
    setSelectedConnectionIds(initialDraft.selectedConnectionIds);
    setDelaySeconds(initialDraft.delaySeconds);
    if (initialDraft.delaySecondsMax) setDelaySecondsMax(initialDraft.delaySecondsMax);
    if (typeof initialDraft.humanizedPauses === 'boolean') setHumanizedPauses(initialDraft.humanizedPauses);
    const draftMode = initialDraft.campaignFlowMode;
    if (draftMode === 'sequential') {
      toast('O modo sequência automática foi descontinuado. Usamos disparo único com a primeira mensagem.', {
        icon: 'ℹ️',
        duration: 6000
      });
      setCampaignFlowMode('single');
      setMessageStages(
        initialDraft.messageStages.length > 0
          ? [
              {
                ...newMessageStage(),
                ...initialDraft.messageStages[0],
                id: initialDraft.messageStages[0].id || newMessageStage().id,
                marketingEffect: initialDraft.messageStages[0].marketingEffect ?? 'none'
              }
            ]
          : [newMessageStage()]
      );
    } else {
      setCampaignFlowMode(draftMode);
    setMessageStages(
      initialDraft.messageStages.map((s) => ({
        ...newMessageStage(),
        ...s,
        id: s.id || newMessageStage().id,
        marketingEffect: s.marketingEffect ?? 'none'
      }))
    );
    }
    // Draft/template/clone já traz o modo definido — não força reescolha.
    setFlowModeChosen(true);
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
    setActiveStageIdx(0);
    setStep(1);
    onDraftConsumed?.();
  }, [initialDraft, onDraftConsumed]);

  const buildCurrentDraft = (): CampaignWizardDraft => ({
    name: name.trim(),
    sendMode,
    selectedListId,
    manualNumbers,
    selectedConnectionIds,
    channelWeightMode,
    channelWeights: channelWeightsById,
    delaySeconds,
    delaySecondsMax: delaySecondsMax > delaySeconds ? delaySecondsMax : undefined,
    humanizedPauses,
    campaignFlowMode,
    messageStages: messageStages.map((s) => ({
      id: s.id,
      body: s.body,
      acceptAnyReply: s.acceptAnyReply,
      validTokensText: s.validTokensText,
      invalidReplyBody: s.invalidReplyBody,
      marketingEffect: s.marketingEffect ?? 'none'
    })),
    filterCities: Array.from(filterCities),
    filterChurches: Array.from(filterChurches),
    filterRoles: Array.from(filterRoles),
    filterProfessions: Array.from(filterProfessions),
    filterDDDs: Array.from(filterDDDs),
    filterTemps: Array.from(filterTemps),
    filterSearch,
    selectedContactPhones: Array.from(selectedContactPhones),
    manualSelection
  });

  const setActiveMessageBody = (body: string) => {
    setMessageStages((prev) => prev.map((s, i) => (i === activeStageIdx ? { ...s, body } : s)));
  };

  const patchActiveStage = (patch: Partial<MessageStageDraft>) => {
    setMessageStages((prev) => prev.map((s, i) => (i === activeStageIdx ? { ...s, ...patch } : s)));
  };

  const setFlowMode = (mode: CampaignFlowMode) => {
    const nextMode: CampaignFlowMode = mode === 'sequential' ? 'single' : mode;
    if (mode === 'sequential') {
      toast('Sequência automática não está mais disponível. Use disparo único ou fluxo por respostas.', {
        icon: 'ℹ️',
        duration: 5000
      });
      setMessageStages((prev) => (prev.length === 0 ? [newMessageStage()] : [prev[0]]));
      setActiveStageIdx(0);
    } else if (nextMode === 'reply') {
      setMessageStages((prev) => (prev.length < 2 ? [...prev, newMessageStage()] : prev));
    } else if (nextMode === 'single') {
      setMessageStages((prev) => (prev.length === 0 ? [newMessageStage()] : [prev[0]]));
      setActiveStageIdx(0);
    }
    setCampaignFlowMode(nextMode);
    setFlowModeChosen(true);
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
    const stageIdx = campaignFlowMode === 'reply' ? 0 : activeStageIdx;
    const cur = messageStages[stageIdx]?.invalidReplyBody ?? '';
    insertCampaignTokenIntoTextarea(invalidReplyRef.current, cur, variable, (next) =>
      setMessageStages((prev) => prev.map((s, i) => (i === stageIdx ? { ...s, invalidReplyBody: next } : s)))
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

  const rawNumbers =
    sendMode === 'list'
      ? selectedListNumbers
      : sendMode === 'manual'
      ? manualNumbersForSend
      : filteredNumbers;

  const numbers = useMemo(() => {
    return rawNumbers.filter((n) => !excludedDuplicatePhones.has(normPhoneKey(n)));
  }, [rawNumbers, excludedDuplicatePhones]);
  const connectedIds = getConnectedSelectedIds();

  const previewSample = useMemo((): CampaignPreviewSample => {
    const pick = (c: Contact) => {
      const wedding = (c.religiousMemberProfile?.weddingDate || '').trim();
      const conjuge = (c.religiousMemberProfile?.spouseName || '').trim();
      const mdWed = parseWeddingDayMonth(wedding);
      const anosCasamento =
        mdWed?.fullYear != null ? yearsCelebratingAtNextAnniversary(mdWed) : null;
      const nv = campaignRecipientNameVars(c.name || '');
      return {
        nome: nv.nome,
        nome_completo: nv.nome_completo,
        telefone: c.phone || '',
        email: c.email || '',
        cidade: c.city || '',
        igreja: c.church || '',
        cargo: c.role || '',
        profissao: c.profession || '',
        aniversario: c.birthday || '',
        conjuge,
        data_bodas: wedding,
        anos_casamento: anosCasamento != null ? String(anosCasamento) : '',
      };
    };
    if (sendMode === 'list' && selectedListContactsForSend[0]) return pick(selectedListContactsForSend[0]);
    if (sendMode === 'filter' && filteredContacts[0]) return pick(filteredContacts[0]);
    return {};
  }, [sendMode, selectedListContactsForSend, filteredContacts]);

  const previewDisplayName = previewSample.nome || 'Maria';
  const messageStepHint =
    campaignFlowMode === 'single'
      ? 'Escreva o texto que cada contato receberá no WhatsApp — use modelos ou variáveis como {nome}.'
      : 'Configure a abertura e o que enviar quando o contato responder.';

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

  const stageCountOk =
    campaignFlowMode === 'single'
      ? messageStages.length >= 1
      : messageStages[0]?.optionsMode === 'conditional'
      ? messageStages.length >= 1
      : messageStages.length >= 2;
  const canGoFromMessage =
    flowModeChosen &&
    name.trim().length > 0 &&
    messageStages.length > 0 &&
    messageStages.every((s) => s.body.trim().length > 0) &&
    replyFlowGatesOk &&
    stageCountOk;
  const canGoFromChannels = connectedIds.length > 0;
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
  const scheduleOk = launchMode === 'now' || scheduleSlots.length > 0;
  const canSubmit =
    canGoFromAudience &&
    canGoFromMessage &&
    canGoFromChannels &&
    !isSubmitting &&
    scheduleOk;

  useEffect(() => {
    if (step !== 4) return;
    setPreflightAck({ audience: false, messages: false, responsibility: false });
  }, [step, launchMode]);

  useEffect(() => {
    if (step !== 4) setQuickTestSentOk(false);
  }, [step]);

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
    // Antes nao havia timeout: se o servidor nao respondesse, o botao
    // ficava 'busy' para sempre e o listener vazava ao desmontar.
    let finished = false;
    const cleanup = () => {
      socket?.off('test-dispatch-result', onResult);
      clearTimeout(timeoutId);
    };
    const onResult = (result: { success?: boolean; message?: string; error?: string }) => {
      if (finished) return;
      finished = true;
      cleanup();
      setQuickTestBusy(false);
      if (result?.success) {
        toast.success(result.message || 'Teste enviado com sucesso.');
        setQuickTestSentOk(true);
      } else {
        toast.error(result?.error || 'Falha ao enviar teste.');
      }
    };
    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      setQuickTestBusy(false);
      toast.error('Tempo esgotado aguardando resposta do servidor.');
    }, 30_000);
    socket.on('test-dispatch-result', onResult);
    socket.emit('test-dispatch', {
      fromConnectionId: fromId,
      toPhone: quickTestPhone.trim(),
      message: firstMessageStageBody
    });
  };

  const handleNextStep = async () => {
    if (step === 1) {
      if (numbers.length === 0) {
        toast.error('Selecione pelo menos um contato antes de avançar.');
        return;
      }
      setCheckingDuplicates(true);
      try {
        const dups = await apiCheckScheduledDuplicates(numbers);
        if (dups.length > 0) {
          setDuplicatedContacts(dups);
          setShowDuplicateWarningModal(true);
          return; // Interrompe e abre o modal explicativo
        }
      } catch (e) {
        console.error('[DuplicateCheck Error]', e);
      } finally {
        setCheckingDuplicates(false);
      }
    }
    setStep((step + 1) as 1 | 2 | 3 | 4);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    /**
     * Anexo so funciona em "disparar agora" — agendamento exigiria persistir
     * o base64 no Firestore (limite de doc ~1 MB) ou subir para Storage.
     * Vamos avisar o usuario para escolher: ou tira o anexo ou tira o agendamento.
     */
    if ((campaignAttachment || followUpAttachment) && launchMode === 'schedule') {
      toast.error(
        'Anexos so funcionam em disparo imediato. Remova o anexo ou desative o agendamento.',
        { duration: 7000 }
      );
      return;
    }
    const buildMediaPayload = async (
      att: { file: File; sendAsDocument: boolean } | null
    ): Promise<
      | { dataBase64: string; mimeType: string; fileName: string; sendMediaAsDocument?: boolean }
      | undefined
    > => {
      if (!att?.file) return undefined;
      const prepToast = `campaign-attachment-prep-${Math.random().toString(36).slice(2, 8)}`;
      try {
        toast.loading('A preparar anexo…', { id: prepToast, duration: 60000 });
        const prep = await prepareCampaignAttachmentForSend(att.file);
        toast.dismiss(prepToast);
        for (const h of prep.hints) toast(h, { duration: 6000 });
        const read = await readAttachmentAsBase64(prep.file);
        return {
          ...read,
          ...(prep.sendMediaAsDocument ? { sendMediaAsDocument: true } : {})
        };
      } catch (err) {
        toast.dismiss(prepToast);
        throw err;
      }
    };
    let mediaPayload:
      | { dataBase64: string; mimeType: string; fileName: string; sendMediaAsDocument?: boolean }
      | undefined;
    let followUpMediaPayload:
      | { dataBase64: string; mimeType: string; fileName: string; sendMediaAsDocument?: boolean }
      | undefined;
    try {
      mediaPayload = await buildMediaPayload(campaignAttachment);
      followUpMediaPayload = await buildMediaPayload(followUpAttachment);
    } catch (err) {
        const m = err instanceof Error ? err.message : 'Falha ao ler anexo.';
        toast.error(m);
        return;
    }
    const stagesBodies = messageStages.map((s) => s.body.trim()).filter((b) => b.length > 0);
    const useReplyFlow = campaignFlowMode === 'reply';
    const replyFlow: CampaignReplyFlow | undefined = useReplyFlow
        ? {
            enabled: true,
          steps: messageStages.map((s) => {
            const hasMenuOptions = Array.isArray(s.options) && s.options.length > 0;
            return {
              body: s.body.trim(),
            acceptAnyReply: hasMenuOptions ? false : s.acceptAnyReply,
              validTokens: parseValidTokensText(s.validTokensText),
              invalidReplyBody: s.invalidReplyBody.trim(),
            marketingEffect: s.marketingEffect ?? 'none',
            ...(hasMenuOptions
              ? {
                  options: s.options!.map((opt) => ({
                    tokens: parseValidTokensText(opt.tokensText),
                    reply: opt.reply.trim(),
                    marketingEffect: opt.marketingEffect ?? 'none'
                  }))
                }
              : {})
          };
          })
          }
        : undefined;
    const contactListMeta =
      sendMode === 'list' && selectedList
        ? { id: selectedList.id, name: selectedList.name }
        : sendMode === 'filter'
        ? { id: undefined, name: buildFilterLabel() }
        : { id: undefined, name: 'Envio manual' };

    const runSingle = async () => {
      const cw = buildChannelWeightsPayload();
      const base = {
        name: name.trim(),
        message: stagesBodies[0] || '',
        messageStages: campaignFlowMode === 'single' ? [] : stagesBodies.slice(1),
        replyFlow: campaignFlowMode === 'reply' ? replyFlow : undefined,
        connectedIds,
        numbers,
        recipients: buildRecipients(),
        contactListMeta,
        delaySeconds,
        ...(cw ? { channelWeights: cw } : {}),
        ...(mediaPayload ? { mediaAttachment: mediaPayload } : {}),
        ...(followUpMediaPayload ? { followUpMediaAttachment: followUpMediaPayload } : {}),
        ...(dailyScheduleEnabled ? {
          dailySchedule: {
            enabled: true,
            days: dailyScheduleDays
          }
        } : {})
      };
      if (launchMode === 'schedule') {
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

      setIsSubmitting(true);
    const submitToastId = 'campaign-submit';
    toast.loading('Iniciando disparo no servidor…', { id: submitToastId, duration: 120_000 });
    try {
      await runSingle();
      toast.dismiss(submitToastId);
    } catch (err) {
      toast.dismiss(submitToastId);
      const errorMessage = err instanceof Error ? err.message : 'Falha ao iniciar campanha.';
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const stagePreviewBodies = messageStages
    .map((s) => applyCampaignMessagePreviewVars(s.body, previewSample))
    .filter((b) => b.trim().length > 0);

  const replyPreviewMeta = useMemo(() => {
    if (campaignFlowMode !== 'reply') return undefined;
    const first = messageStages[0];
    if (!first) return undefined;
    const isAnyReply = Boolean(first.acceptAnyReply ?? true);
    if (isAnyReply) {
      const followUp = messageStages[1]?.body?.trim();
      return {
        isAnyReply: true as const,
        followUpBody: followUp
          ? applyCampaignMessagePreviewVars(followUp, previewSample)
          : undefined,
      };
    }
    const options = (first.options || []).map((opt, i) => ({
      trigger: (opt.tokensText || String(i + 1)).split(/[,;]/)[0]?.trim() || String(i + 1),
      reply: opt.reply.trim()
        ? applyCampaignMessagePreviewVars(opt.reply, previewSample)
        : '',
    }));
    return { isAnyReply: false as const, menuOptions: options };
  }, [campaignFlowMode, messageStages, previewSample]);

  const messageSetupProgress = useMemo(() => {
    const first = messageStages[0];
    const hasName = name.trim().length > 0;
    const hasMode = flowModeChosen;
    const hasOpening = Boolean(first?.body?.trim());
    if (campaignFlowMode === 'single') {
      return [
        { id: 'name', label: 'Nome da campanha', done: hasName, hint: 'Dê um nome interno' },
        { id: 'mode', label: 'Tipo escolhido', done: hasMode },
        { id: 'body', label: 'Texto da mensagem', done: hasOpening, hint: 'Escreva ou use um modelo' },
      ];
    }
    const isMenu = !first?.acceptAnyReply && first?.optionsMode === 'conditional';
    const hasFollowUp = isMenu
      ? (first?.options || []).every(
          (o) => parseValidTokensText(o.tokensText).length > 0 && o.reply.trim().length > 0
        )
      : Boolean(messageStages[1]?.body?.trim());
    const hasFallback = isMenu ? Boolean(first?.invalidReplyBody?.trim()) : true;
    return [
      { id: 'name', label: 'Nome da campanha', done: hasName, hint: 'Dê um nome interno' },
      { id: 'mode', label: 'Tipo escolhido', done: hasMode },
      { id: 'opening', label: 'Mensagem de abertura', done: hasOpening, hint: 'Primeiro texto enviado' },
      {
        id: 'reply',
        label: isMenu ? 'Rotas do menu preenchidas' : 'Resposta automática',
        done: hasFollowUp,
        hint: isMenu ? 'Cada opção precisa de gatilho e texto' : 'Texto após o contato responder',
      },
      ...(isMenu
        ? [{ id: 'fallback', label: 'Resposta para opção inválida', done: hasFallback, hint: 'Quando não reconhecer' }]
        : []),
    ];
  }, [name, flowModeChosen, campaignFlowMode, messageStages]);

  const estimateMinutes =
    campaignFlowMode === 'reply'
      ? Math.round((numbers.length * delaySeconds) / 60)
      : Math.round((numbers.length * delaySeconds) / 60);

  const estimateLabel =
    campaignFlowMode === 'reply'
      ? `1º envio ~${estimateMinutes} min (proximas etapas quando o contato responder)`
      : `~${estimateMinutes} min`;

  return (
    <div className="max-w-7xl mx-auto pb-10">

      {/* ── Cabeçalho do wizard ── */}
      <div
        className="rounded-2xl px-5 py-4 mb-5 flex items-center justify-between gap-4"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
          borderLeft: '3px solid #06B6D4',
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
              Nova campanha · Broadcast Studio
            </h1>
            <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              Configure passo a passo: público, mensagem, canais e revisão
            </p>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.28)' }}
        >
          <span className="text-[11px] font-bold" style={{ color: '#818cf8' }}>
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
            background: 'linear-gradient(90deg, #06B6D4, #22d3ee)',
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

      <div
        className={
          step === 2
            ? 'grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-6'
            : 'grid grid-cols-1 lg:grid-cols-3 gap-4'
        }
      >
        <div className={step === 2 ? 'xl:col-span-8 space-y-4 min-w-0' : 'lg:col-span-2 space-y-4 min-w-0'}>
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
                    badgeColor: '#06B6D4',
                    badgeBg: 'rgba(99,102,241,0.12)',
                    iconBg: '#06B6D4',
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
            <Card className="cw-msg-step">
              <div className="cw-msg-hero">
                <div className="cw-msg-hero-icon" aria-hidden>
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="ui-title text-[15px] mb-0.5">Qual a mensagem?</h3>
                  <p className="ui-subtitle text-[12px]">{messageStepHint}</p>
                </div>
              </div>

              <div className="cw-msg-section cw-msg-name-row">
                <div>
                  <p className="cw-msg-section-title">Nome da campanha</p>
              <Input
                    placeholder="Ex: Promoção Janeiro — Base VIP"
                value={name}
                onChange={(e) => setName(e.target.value)}
                  />
                  <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                    Só para você organizar — seus contatos não veem este nome.
                  </p>
              </div>
              </div>

              <CampaignFlowModePicker mode={campaignFlowMode} onChange={setFlowMode} />

              {flowModeChosen && (
                <CampaignMessageSetupProgress items={messageSetupProgress} />
              )}

              {flowModeChosen && (
                <div className="cw-msg-editor-zone">
                  {campaignFlowMode === 'single' ? (
                    <CampaignSingleMessageEditor
                      body={messageStages[0]?.body ?? ''}
                      onBodyChange={(body) =>
                        setMessageStages((prev) => {
                          const first = prev[0] ?? newMessageStage();
                          return [{ ...first, body }];
                        })
                      }
                      onInsertVariable={insertVariable}
                      msgRef={msgRef}
                      attachment={campaignAttachment}
                      attachmentInputRef={attachmentInputRef}
                      onPickAttachment={onPickAttachment}
                      onRemoveAttachment={removeAttachment}
                      launchMode={launchMode}
                          />
                        ) : (
                    <CampaignReplyFlowEditor
                      stages={messageStages}
                      setStages={setMessageStages}
                      msgRef={msgRef}
                      invalidReplyRef={invalidReplyRef}
                      attachment={campaignAttachment}
                      attachmentInputRef={attachmentInputRef}
                      onPickAttachment={onPickAttachment}
                      onRemoveAttachment={removeAttachment}
                      followUpAttachment={followUpAttachment}
                      followUpAttachmentInputRef={followUpAttachmentInputRef}
                      onPickFollowUpAttachment={onPickFollowUpAttachment}
                      onRemoveFollowUpAttachment={removeFollowUpAttachment}
                      launchMode={launchMode}
                      newStageOption={newMessageStageOption}
                      newMessageStage={newMessageStage}
                      onInsertInvalidVariable={insertInvalidReplyVariable}
                      campaignBrief={name.trim() || 'Campanha WhatsApp'}
                      previewDisplayName={previewDisplayName}
                          />
                        )}
                      </div>
              )}

              {/* Prévia no celular (telas menores) */}
              <div className="cw-preview-mobile">
                <WizardLivePreview
                    displayName={previewDisplayName}
                    bodies={stagePreviewBodies}
                    numbersCount={numbers.length}
                    chipsCount={connectedIds.length}
                    delaySeconds={delaySeconds}
                    delaySecondsMax={delaySecondsMax}
                    humanizedPauses={humanizedPauses}
                    estimateLabel={estimateLabel}
                    flowMode={campaignFlowMode}
                    replyPreview={replyPreviewMeta}
                  />
                        </div>

              <div className="cw-msg-footer">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={savingTemplate}
                  leftIcon={<Sparkles className="w-3.5 h-3.5" />}
                  onClick={async () => {
                    if (!flowModeChosen || messageStages.every((s) => !s.body.trim())) {
                      toast.error('Escolha o modo e escreva ao menos uma etapa antes de salvar.');
                      return;
                    }
                    const tplName = window.prompt(
                      'Nome do modelo (ficará salvo na sua biblioteca):',
                      name.trim() || 'Meu modelo'
                    );
                    if (!tplName || !tplName.trim()) return;
                    setSavingTemplate(true);
                    try {
                      await createLibraryItem('templates', tplName.trim(), buildCurrentDraft());
                      toast.success('Modelo salvo na sua biblioteca (Centro → Modelos).');
                    } catch {
                      toast.error('Não foi possível salvar o modelo no servidor.');
                    } finally {
                      setSavingTemplate(false);
                    }
                  }}
                >
                  Salvar como modelo
                </Button>

                {activeMessageBody.trim() ? (
                <div className="cw-risk-panel" data-level={messageRisk.level}>
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      Copiloto de risco
                  </span>
                  <Badge
                    variant={
                      messageRisk.level === 'high' ? 'danger' : messageRisk.level === 'medium' ? 'warning' : 'success'
                    }
                  >
                    {messageRisk.level === 'high' ? 'Alto' : messageRisk.level === 'medium' ? 'Médio' : 'Baixo'}
                  </Badge>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                      {messageRisk.score}/100
                  </span>
                </div>
                  {messageRisk.hints.length > 0 && (
                    <ul className="text-[11px] space-y-0.5 list-disc pl-4 mb-1" style={{ color: 'var(--text-2)' }}>
                  {messageRisk.hints.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                  )}
                {messageRisk.level !== 'low' && (
                    <p className="text-[10.5px] flex items-start gap-1.5" style={{ color: 'var(--text-3)' }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-0.5" />
                      Revise o texto antes de escalar volume.
                  </p>
                )}
              </div>
              ) : (
                <div className="cw-risk-tip flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>
                    Dica: mensagens curtas e personalizadas com <code className="font-mono text-[10px]">{'{nome}'}</code>{' '}
                    costumam ter melhor resposta. A prévia mostra como o contato vai ver.
                    </span>
                    </div>
                  )}
                  </div>
            </Card>
          )}

          {/* STEP 3: Channels */}
          {step === 3 && (
            <>
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="ui-title text-[15px]">Chips do WhatsApp</h3>
                    <p className="ui-subtitle text-[12.5px]">Escolha quais canais vão participar do disparo.</p>
                  </div>
                  <Badge variant="neutral">{connectedIds.length} selecionado{connectedIds.length !== 1 ? 's' : ''}</Badge>
                </div>

                {/* Alternância manual / pool */}
                <div className="flex gap-2 mb-3">
                  {[
                    { id: 'manual', label: 'Chips individuais' },
                    { id: 'pool', label: `Pool${availablePools.length > 0 ? ` (${availablePools.length})` : ''}` },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setChipSelectionMode(opt.id as 'manual' | 'pool')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition"
                      style={{
                        background: chipSelectionMode === opt.id ? 'rgba(16,185,129,0.15)' : 'var(--surface-1)',
                        border: `1.5px solid ${chipSelectionMode === opt.id ? 'rgba(16,185,129,0.4)' : 'var(--border-subtle)'}`,
                        color: chipSelectionMode === opt.id ? 'var(--emerald, #10b981)' : 'var(--text-2)',
                      }}
                    >
                      {opt.id === 'pool' ? <Layers className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Seletor de pool */}
                {chipSelectionMode === 'pool' && (
                  <div className="mb-3">
                    {availablePools.length === 0 ? (
                      <div
                        className="rounded-lg px-4 py-3 text-center"
                        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                      >
                        <Layers className="w-5 h-5 mx-auto mb-1.5" style={{ color: 'var(--text-3)' }} />
                        <p className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                          Nenhum pool criado ainda.
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          Crie um pool na aba <strong>Conexões → Pools de Chips</strong> e volte aqui.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {availablePools.map((pool) => {
                          const onlineCount = pool.connectionIds.filter((id) =>
                            onlineConnections.some((c) => c.id === id)
                          ).length;
                          const isSel = selectedPoolId === pool.id;
                          return (
                            <label
                              key={pool.id}
                              className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition"
                              style={{
                                background: isSel ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
                                border: `1.5px solid ${isSel ? 'rgba(16,185,129,0.4)' : 'var(--border-subtle)'}`,
                              }}
                            >
                              <input
                                type="radio"
                                name="selectedPool"
                                checked={isSel}
                                onChange={() => setSelectedPoolId(pool.id)}
                                className="sr-only"
                              />
                              <div
                                className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                                style={isSel ? { background: '#10b981' } : { border: '2px solid var(--border-strong)' }}
                              >
                                {isSel && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                              </div>
                              <Layers className="w-4 h-4 flex-shrink-0" style={{ color: '#10b981' }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>
                                  {pool.name}
                                </p>
                                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                                  {pool.connectionIds.length} chip{pool.connectionIds.length !== 1 ? 's' : ''} ·{' '}
                                  <span style={{ color: onlineCount > 0 ? '#10b981' : '#ef4444' }}>
                                    {onlineCount} online
                                  </span>
                                  {' · '}{pool.strategy === 'round_robin' ? 'Rodízio' : pool.strategy === 'weighted' ? 'Pesos' : 'Prioridade'}
                                  {' · '}⚡ Failover automático
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {chipSelectionMode === 'manual' && (
                <p
                  className="text-[11px] mb-3 rounded-lg px-3 py-2"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-2)'
                  }}
                >
                  Vários chips selecionados: o ZapMass distribui os envios em rodízio entre eles. Se algum ficar offline
                  durante o disparo, o failover automático tenta os demais chips antes de registrar falha.
                </p>
                )}

                {chipSelectionMode === 'manual' && connections.length === 0 ? (
                  <p className="text-[12.5px] py-4 text-center" style={{ color: 'var(--text-3)' }}>
                    Nenhum chip cadastrado.
                  </p>
                ) : chipSelectionMode === 'manual' && onlineConnections.length === 0 ? (
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
                ) : chipSelectionMode === 'manual' ? (
                  /* lista de chips — só renderiza quando modo manual */
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
                            {(() => {
                              const limit = Number(conn.dailyLimit) || 0;
                              if (limit <= 0) return null;
                              const sent = Number(conn.messagesSentToday) || 0;
                              const remaining = Math.max(0, limit - sent);
                              const pct = Math.min(100, Math.round((sent / limit) * 100));
                              const danger = remaining === 0;
                              const warn = !danger && remaining <= Math.max(5, Math.round(limit * 0.15));
                              const barColor = danger ? '#ef4444' : warn ? '#f59e0b' : '#10b981';
                              return (
                                <div className="mt-1">
                                  <div className="flex items-center justify-between text-[10px] mb-0.5" style={{ color: 'var(--text-3)' }}>
                                    <span>Limite hoje</span>
                                    <span style={{ color: barColor, fontWeight: 600 }}>
                                      {remaining} restante{remaining !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                                  </div>
                                </div>
                              );
                            })()}
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
                ) : null}
              </Card>

              {(() => {
                const selOnline = connections.filter(
                  (c) => selectedConnectionIds.includes(c.id) && c.status === ConnectionStatus.CONNECTED
                );
                const withLimit = selOnline.filter((c) => (Number(c.dailyLimit) || 0) > 0);
                if (withLimit.length === 0) return null;
                const totalRemaining = withLimit.reduce(
                  (acc, c) => acc + Math.max(0, (Number(c.dailyLimit) || 0) - (Number(c.messagesSentToday) || 0)),
                  0
                );
                const needed = numbers.length;
                const insufficient = needed > totalRemaining;
                return (
                  <Card>
                    <div className="flex items-start gap-2.5">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: insufficient ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)' }}
                      >
                        {insufficient ? (
                          <AlertCircle className="w-4 h-4" style={{ color: '#ef4444' }} />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" style={{ color: '#10b981' }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                          Capacidade de hoje: {totalRemaining} envio{totalRemaining !== 1 ? 's' : ''} disponíve{totalRemaining !== 1 ? 'is' : 'l'}
                        </p>
                        <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
                          Esta campanha precisa de ~{needed} envio{needed !== 1 ? 's' : ''}.{' '}
                          {insufficient
                            ? 'O excedente fica em fila e sai amanhã, quando os limites zerarem. Adicione outro chip ou aumente o limite para enviar tudo hoje.'
                            : 'Cabe dentro do limite diário dos chips selecionados.'}
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })()}

              {getConnectedSelectedIds().length > 1 && onlineConnections.length > 0 && (
                <Card>
                  <div className="mb-3">
                    <h3 className="ui-title text-[15px]">Carga por canal</h3>
                    <p className="ui-subtitle text-[12.5px]">
                      Defina a proporção entre os chips selecionados. Ex.: pesos 3 e 1 ≈ 75% e 25% dos destinos ao longo
                      da fila.
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
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="ui-title text-[15px]">Intervalo Anti-Ban</h3>
                    <p className="ui-subtitle text-[12px] mt-0.5">
                      Atraso aleatório entre envios — quanto maior e mais variado, menor o risco de bloqueio.
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-xl font-bold tabular-nums" style={{ color: '#f59e0b' }}>
                      {delaySeconds}s – {delaySecondsMax > delaySeconds ? delaySecondsMax : delaySeconds * 2}s
                  </span>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      ~{Math.round(3600 / ((delaySeconds + (delaySecondsMax > delaySeconds ? delaySecondsMax : delaySeconds * 2)) / 2))} msgs/h por chip
                    </p>
                </div>
                </div>

                {/* Min */}
                <div className="mb-3">
                  <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-3)' }}>
                    Mínimo (mais rápido)
                  </p>
                <div className="grid grid-cols-6 gap-1.5">
                    {[10, 20, 30, 45, 60, 90].map((s) => (
                    <button
                      key={s}
                      type="button"
                        onClick={() => {
                          setDelaySeconds(s);
                          if (delaySecondsMax <= s) setDelaySecondsMax(s * 2);
                        }}
                        className="py-1.5 rounded-lg text-[11.5px] font-bold transition-all"
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
                </div>

                {/* Max */}
                <div className="mb-4">
                  <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-3)' }}>
                    Máximo (mais humano)
                  </p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {[30, 60, 90, 120, 180, 240].map((s) => {
                      const invalid = s <= delaySeconds;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => !invalid && setDelaySecondsMax(s)}
                          disabled={invalid}
                          className="py-1.5 rounded-lg text-[11.5px] font-bold transition-all"
                          style={
                            delaySecondsMax === s && !invalid
                              ? { background: '#10b981', color: '#fff' }
                              : invalid
                              ? { background: 'var(--surface-1)', color: 'var(--text-3)', opacity: 0.4, cursor: 'not-allowed', border: '1px solid var(--border-subtle)' }
                              : { background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
                          }
                        >
                          {s}s
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Pausas humanizadas */}
                <div
                  className="flex items-center justify-between p-2.5 rounded-xl cursor-pointer"
                  style={{ background: humanizedPauses ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)', border: '1px solid', borderColor: humanizedPauses ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)' }}
                  onClick={() => setHumanizedPauses(v => !v)}
                >
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      Pausas humanizadas
                    </p>
                    <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                      A cada ~30 msgs, faz uma pausa extra de 2–5 min para simular comportamento humano
                    </p>
                  </div>
                  <div
                    className="w-9 h-5 rounded-full transition-all shrink-0 ml-3 flex items-center"
                    style={{ background: humanizedPauses ? '#10b981' : 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div
                      className="w-3.5 h-3.5 rounded-full bg-white transition-transform"
                      style={{ transform: humanizedPauses ? 'translateX(18px)' : 'translateX(2px)', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                    />
                  </div>
                </div>

                {/* Dica de segurança */}
                <div className="mt-3 flex gap-2 p-2.5 rounded-xl" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <span className="text-[13px] shrink-0">🛡️</span>
                  <p className="text-[10.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
                    <strong style={{ color: 'var(--text-2)' }}>Recomendado para conta nova:</strong> mín 45s, máx 120s + pausas ativadas. Para chip aquecido: mín 20s, máx 60s.
                  </p>
              </div>
              </Card>

              {/* Cronograma de Envio Diário Fracionado */}
              <Card className="mt-4">
                <div className="flex items-center justify-between p-1 cursor-pointer" onClick={() => {
                  const next = !dailyScheduleEnabled;
                  setDailyScheduleEnabled(next);
                  if (next && dailyScheduleDays.length === 0) {
                    const numChips = Math.max(1, selectedConnectionIds.length);
                    const numDays = 5; // Padrão de 5 dias
                    const defaultLimit = Math.ceil(numbers.length / (numChips * numDays));
                    const initialDays = Array.from({ length: numDays }, (_, idx) => ({
                      dayIndex: idx,
                      limitPerChannel: defaultLimit || 50
                    }));
                    setDailyScheduleDays(initialDays);
                  }
                }}>
                  <div className="flex gap-2.5 items-start">
                    <span className="text-lg shrink-0 mt-0.5">📅</span>
                    <div>
                      <h3 className="ui-title text-[14.5px]">Cronograma de Envio Diário</h3>
                      <p className="ui-subtitle text-[11.5px] mt-0.5">
                        Fracionar e distribuir o envio da lista ao longo de múltiplos dias.
                      </p>
                    </div>
                  </div>
                  <div
                    className="w-9 h-5 rounded-full transition-all shrink-0 ml-3 flex items-center"
                    style={{ background: dailyScheduleEnabled ? '#10b981' : 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div
                      className="w-3.5 h-3.5 rounded-full bg-white transition-transform"
                      style={{ transform: dailyScheduleEnabled ? 'translateX(18px)' : 'translateX(2px)', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                    />
                  </div>
                </div>

                {dailyScheduleEnabled && (
                  <div className="mt-4 pt-4 border-t border-white/5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-3)' }}>
                          Duração do Cronograma (Dias)
                        </p>
                        <input
                          type="number"
                          min="1"
                          max="14"
                          value={dailyScheduleDays.length}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(14, parseInt(e.target.value) || 1));
                            const numChips = Math.max(1, selectedConnectionIds.length);
                            const defaultLimit = Math.ceil(numbers.length / (numChips * val));
                            const nextDays = Array.from({ length: val }, (_, idx) => {
                              const prev = dailyScheduleDays[idx];
                              return {
                                dayIndex: idx,
                                limitPerChannel: prev ? prev.limitPerChannel : (defaultLimit || 50)
                              };
                            });
                            setDailyScheduleDays(nextDays);
                          }}
                          className="w-full px-3 py-2 rounded-lg text-[13px] bg-black/40 border text-white"
                          style={{ borderColor: 'var(--border-subtle)' }}
                    />
                  </div>

                      <div>
                        <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-3)' }}>
                          Alterar Limite Padrão (Canal/Dia)
                        </p>
                        <input
                          type="number"
                          min="1"
                          placeholder="Ex: 100"
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (val && val > 0) {
                              setDailyScheduleDays(prev => prev.map(d => ({ ...d, limitPerChannel: val })));
                            }
                          }}
                          className="w-full px-3 py-2 rounded-lg text-[13px] bg-black/40 border text-white"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        />
                      </div>
                    </div>

                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {dailyScheduleDays.map((day, idx) => {
                        const numChips = Math.max(1, selectedConnectionIds.length);
                        const totalForDay = day.limitPerChannel * numChips;
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2.5 rounded-xl text-[12px]"
                            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                          >
                            <span className="font-bold text-zinc-300">
                              Dia {day.dayIndex + 1}
                            </span>
                            
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <span className="text-[10px] text-zinc-500 block">Envio por canal</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={day.limitPerChannel}
                                  onChange={(e) => {
                                    const val = Math.max(1, parseInt(e.target.value) || 1);
                                    setDailyScheduleDays(prev => prev.map(d => d.dayIndex === day.dayIndex ? { ...d, limitPerChannel: val } : d));
                                  }}
                                  className="w-20 px-2 py-1 rounded bg-black/60 border text-white text-center font-bold font-mono text-[11.5px]"
                                  style={{ borderColor: 'var(--border-subtle)' }}
                                />
                </div>

                              <div className="text-right w-24">
                                <span className="text-[10px] text-zinc-500 block">Total do dia</span>
                                <span className="font-bold text-emerald-400 font-mono text-[12.5px]">
                                  {totalForDay} envios
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Resumo do Planejamento */}
                    <div className="p-3 rounded-xl space-y-1 bg-black/20 border border-white/5 text-[11.5px]">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Total de contatos na lista:</span>
                        <span className="font-bold text-white">{numbers.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Total coberto pelo cronograma:</span>
                        {(() => {
                          const numChips = Math.max(1, selectedConnectionIds.length);
                          const totalProgrammed = dailyScheduleDays.reduce((acc, d) => acc + (d.limitPerChannel * numChips), 0);
                          const covered = Math.min(numbers.length, totalProgrammed);
                          return (
                            <span className={`font-bold ${totalProgrammed >= numbers.length ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {covered} contatos ({Math.round((covered / Math.max(1, numbers.length)) * 100)}%)
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
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
                      className="px-3 py-2 rounded-lg text-[12px] font-bold transition-all inline-flex items-center gap-1.5"
                      style={
                        launchMode === 'schedule'
                        ? { background: '#06B6D4', color: '#fff' }
                          : {
                              background: 'var(--surface-0)',
                            color: 'var(--text-2)',
                            border: '1px solid var(--border-subtle)'
                            }
                      }
                    >
                      <Clock className="w-3.5 h-3.5" />
                      Agendar na semana
                    </button>
                  </div>
                {launchMode === 'schedule' && (
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

              {/* ── Saúde dos chips selecionados ── */}
              {(() => {
                const selectedConns = connections.filter((c) => selectedConnectionIds.includes(c.id));
                const offlineConns = selectedConns.filter((c) => c.status !== ConnectionStatus.CONNECTED);
                if (offlineConns.length === 0) return null;
                return (
                  <div
                    className="rounded-lg p-3 flex items-start gap-2.5"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}
                  >
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#d97706' }} />
                      <div>
                      <p className="text-[12px] font-semibold mb-1" style={{ color: '#d97706' }}>
                        {offlineConns.length} chip{offlineConns.length > 1 ? 's' : ''} selecionado{offlineConns.length > 1 ? 's' : ''} não {offlineConns.length > 1 ? 'estão conectados' : 'está conectado'}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {offlineConns.map((c) => (
                          <span
                            key={c.id}
                            className="text-[11px] px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309' }}
                          >
                            {c.name || c.id}
                          </span>
                        ))}
                      </div>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                        Reconecte os chips antes de iniciar ou o disparo pode falhar.
                        </p>
                      </div>
                    </div>
                );
              })()}

              {/* ── Teste rápido antes de disparar ── */}
              <div
                className="rounded-lg p-3"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                  Testar antes de disparar
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="tel"
                    placeholder="Seu número com DDD (ex: 11999990000)"
                    value={quickTestPhone}
                    onChange={(e) => setQuickTestPhone(e.target.value)}
                    className="flex-1 text-[13px] px-3 py-1.5 rounded-lg"
                    style={{
                      background: 'var(--surface-0)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-1)',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={sendWizardQuickTest}
                    disabled={quickTestBusy || !quickTestPhone.trim()}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50"
                    style={{
                      background: quickTestSentOk ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)',
                      color: quickTestSentOk ? '#059669' : '#2563eb',
                      border: `1px solid ${quickTestSentOk ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.3)'}`
                    }}
                  >
                    {quickTestBusy ? 'Enviando…' : quickTestSentOk ? 'Enviado!' : 'Enviar teste'}
                  </button>
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                  Envia a 1ª mensagem com as variáveis preenchidas para o número informado. Confirme que chegou antes de disparar.
                </p>
              </div>

              <div className="space-y-3">
                <ReviewRow label="Nome" value={name} />
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
                <ReviewRow label="Intervalo" value={`${delaySeconds}s – ${delaySecondsMax > delaySeconds ? delaySecondsMax : delaySeconds * 2}s${humanizedPauses ? ' + pausas' : ''}`} />
                <ReviewRow
                  label="Modo"
                  value={
                    campaignFlowMode === 'single'
                      ? 'Disparo único'
                      : 'Fluxo por respostas'
                  }
                />
                <div
                  className="rounded-lg p-3 text-[12px] leading-snug -mt-1"
                  style={{
                    background: 'rgba(59, 130, 246, 0.055)',
                    border: '1px solid rgba(59, 130, 246, 0.16)'
                  }}
                >
                  {campaignFlowMode === 'single' ? (
                    <span style={{ color: 'var(--text-2)' }}>
                      Cada contato recebe apenas uma mensagem. Respostas não disparam follow-up automático.
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-2)' }}>
                      Apenas a 1ª mensagem vai na abertura; a próxima só depois que o contato responder, conforme você
                      configurou no passo Mensagem.
                    </span>
                  )}
                </div>
                <ReviewRow
                  label="Etapas"
                  value={
                    campaignFlowMode === 'single'
                      ? '1 mensagem por contato'
                      : `${messageStages.length} mensagem${messageStages.length !== 1 ? 'ns' : ''} por contato`
                  }
                />
                <ReviewRow label="Estimativa" value={<span>{estimateLabel}</span>} />
                {launchMode === 'schedule' && (
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
                  {launchMode === 'schedule' ? 'Agendar campanha' : 'Iniciar disparo'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Painel de prévia ao vivo ── */}
        <div className={step === 2 ? 'hidden xl:block xl:col-span-4' : 'hidden lg:block'}>
          <div className="sticky top-4">
            <WizardLivePreview
              displayName={previewDisplayName}
              bodies={stagePreviewBodies}
              numbersCount={numbers.length}
              chipsCount={connectedIds.length}
              delaySeconds={delaySeconds}
              delaySecondsMax={delaySecondsMax}
              humanizedPauses={humanizedPauses}
              estimateLabel={estimateLabel}
              flowMode={campaignFlowMode}
              replyPreview={replyPreviewMeta}
            />
          </div>
        </div>
      </div>

      {/* Modal de Alerta de Contatos Duplicados */}
      {showDuplicateWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div 
            className="w-full max-w-lg p-6 rounded-2xl border transition-all"
            style={{ 
              background: 'rgba(20, 20, 25, 0.95)', 
              borderColor: 'rgba(245, 158, 11, 0.3)', // Cor amarela/âmbar de aviso
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)'
            }}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[17px] font-bold text-white">Atenção: Destinatários Programados</h3>
                <p className="text-[12.5px] text-zinc-400 mt-1">
                  Encontramos <span className="text-amber-400 font-bold">{duplicatedContacts.length} contatos</span> da sua lista que já possuem disparos agendados ou em execução em outras campanhas ativas.
                </p>
              </div>
            </div>

            <div 
              className="max-h-[160px] overflow-y-auto rounded-xl p-3 mb-4 border space-y-2 bg-black/35"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              {duplicatedContacts.slice(0, 50).map((dup, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs">
                  <span className="text-zinc-300 font-mono flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-zinc-500" />
                    {dup.phone}
                  </span>
                  <span className="text-amber-400 truncate max-w-[200px]" title={dup.campaignName}>
                    {dup.campaignName}
                  </span>
                </div>
              ))}
              {duplicatedContacts.length > 50 && (
                <p className="text-[10px] text-zinc-500 text-center py-1">
                  E mais {duplicatedContacts.length - 50} contatos...
                </p>
              )}
            </div>

            <p className="text-[12px] text-zinc-300 mb-5">
              O que você deseja fazer com esses contatos duplicados?
            </p>

            <div className="flex flex-col sm:flex-row gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowDuplicateWarningModal(false);
                  setStep((step + 1) as any);
                }}
              >
                Ignorar e Enviar Todos
              </Button>
              <Button
                variant="primary"
                style={{ background: '#10b981', borderColor: '#10b981' }}
                onClick={() => {
                  const toExclude = new Set<string>();
                  for (const dup of duplicatedContacts) {
                    toExclude.add(normPhoneKey(dup.phone));
                  }
                  setExcludedDuplicatePhones(prev => {
                    const next = new Set(prev);
                    for (const num of toExclude) {
                      next.add(num);
                    }
                    return next;
                  });
                  toast.success(`${toExclude.size} contatos duplicados removidos da sua lista!`);
                  setShowDuplicateWarningModal(false);
                  setStep((step + 1) as any);
                }}
              >
                Remover Duplicados (Recomendado)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const WizardLivePreview: React.FC<{
  displayName: string;
  bodies: string[];
  numbersCount: number;
  chipsCount: number;
  delaySeconds: number;
  delaySecondsMax?: number;
  humanizedPauses?: boolean;
  estimateLabel: string;
  flowMode?: CampaignFlowMode;
  replyPreview?: {
    isAnyReply: boolean;
    followUpBody?: string;
    menuOptions?: Array<{ trigger: string; reply: string }>;
  };
}> = ({ displayName, bodies, numbersCount, chipsCount, delaySeconds, delaySecondsMax, humanizedPauses, estimateLabel, flowMode, replyPreview }) => {
  const initial = (displayName || 'C').charAt(0).toUpperCase();
  const isReplyFlow = flowMode === 'reply' && bodies.length > 0;
  const openingBody = bodies[0];
  const menuOptions = replyPreview?.menuOptions?.filter((o) => o.reply.trim()) ?? [];
  return (
    <div className="space-y-3">
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

            <div className="rounded-2xl overflow-hidden" style={{ background: '#0b141a', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div
                className="px-4 py-3 flex items-center gap-3"
                style={{ background: '#1a2228', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', boxShadow: '0 2px 8px rgba(16,185,129,0.3)' }}
                >
            {initial}
                </div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold truncate" style={{ color: '#e9edef' }}>
              {displayName}
            </p>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#10b981' }} />
              <p className="text-[10px]" style={{ color: '#8696a0' }}>
                como seu contato verá
              </p>
                  </div>
                </div>
              </div>

              <div className="p-4 min-h-[180px] flex flex-col justify-end gap-2.5">
          {bodies.length > 0 ? (
            isReplyFlow ? (
              <>
                <div className="self-end max-w-[92%]">
                  <p className="text-[9px] font-semibold mb-1 text-right" style={{ color: '#8696a0' }}>
                    Abertura (disparo)
                  </p>
                  <div
                    className="rounded-xl rounded-tr-none px-3 py-2 text-[12.5px] leading-[18px] whitespace-pre-wrap"
                    style={{
                      background: 'linear-gradient(135deg,#005c4b,#006b58)',
                      color: '#e9edef',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    {openingBody}
                  </div>
                </div>
                {!replyPreview?.isAnyReply && replyPreview?.menuOptions && replyPreview.menuOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 justify-end max-w-[92%] self-end">
                    {replyPreview.menuOptions.map((opt) => (
                      <span
                        key={opt.trigger}
                        className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: 'rgba(255,255,255,0.08)', color: '#53bdeb', border: '1px solid rgba(83,189,235,0.25)' }}
                      >
                        {opt.trigger}
                      </span>
                    ))}
                  </div>
                )}
                <div className="self-start max-w-[78%]">
                  <p className="text-[9px] font-semibold mb-1" style={{ color: '#8696a0' }}>
                    Contato responde
                  </p>
                  <div
                    className="rounded-xl rounded-tl-none px-3 py-2 text-[12px]"
                    style={{ background: '#202c33', color: '#e9edef' }}
                  >
                    {replyPreview?.isAnyReply ? '…' : replyPreview?.menuOptions?.[0]?.trigger || '1'}
                  </div>
                </div>
                {(replyPreview?.isAnyReply && replyPreview.followUpBody) ||
                (!replyPreview?.isAnyReply && menuOptions[0]?.reply) ? (
                  <div className="self-end max-w-[92%]">
                    <p className="text-[9px] font-semibold mb-1 text-right" style={{ color: '#8696a0' }}>
                      Resposta automática
                    </p>
                    <div
                      className="rounded-xl rounded-tr-none px-3 py-2 text-[12.5px] leading-[18px] whitespace-pre-wrap"
                      style={{
                        background: 'linear-gradient(135deg,#005c4b,#006b58)',
                        color: '#e9edef',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                      }}
                    >
                      {replyPreview?.isAnyReply ? replyPreview.followUpBody : menuOptions[0]?.reply}
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-[10px] py-2" style={{ color: '#667781' }}>
                    Configure a resposta automática para ver o follow-up
                  </p>
                )}
              </>
            ) : (
            bodies.map((body, idx) => (
                    <div key={`pv-${idx}`} className="self-end max-w-[92%]">
                {bodies.length > 1 && (
                      <p className="text-[9px] font-semibold mb-1 text-right" style={{ color: '#8696a0' }}>
                        Etapa {idx + 1}
                      </p>
                )}
                      <div
                        className="rounded-xl rounded-tr-none px-3 py-2 text-[12.5px] leading-[18px] whitespace-pre-wrap"
                        style={{
                          background: 'linear-gradient(135deg,#005c4b,#006b58)',
                          color: '#e9edef',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
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
            )
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-50">
                    <Smartphone className="w-8 h-8" style={{ color: '#667781' }} />
              <p className="text-center text-[11px] px-4" style={{ color: '#667781' }}>
                Digite a mensagem — a prévia aparece aqui em tempo real
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div
              className="rounded-xl p-4 space-y-2.5"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
                Resumo
              </p>
        <SummaryRow label="Contatos" value={numbersCount.toLocaleString('pt-BR')} accent="var(--text-1)" />
              <SummaryRow
                label="Chips"
          value={String(chipsCount)}
          accent={chipsCount > 0 ? 'var(--brand-600)' : 'var(--text-3)'}
        />
        <SummaryRow label="Intervalo" value={`${delaySeconds}s–${delaySecondsMax > delaySeconds ? delaySecondsMax : delaySeconds * 2}s${humanizedPauses ? ' 🛡️' : ''}`} accent="#f59e0b" />
        {numbersCount > 0 && <SummaryRow label="Estimativa" value={estimateLabel} accent="#3b82f6" />}
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
