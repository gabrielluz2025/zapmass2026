import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Filter, Upload, Download, UserPlus, UserMinus, Trash2, CheckCircle2, XCircle, MapPin, Church, User, Users, X, Save, ChevronLeft, ChevronRight, FileSpreadsheet, Phone, Briefcase, ListPlus, Square, CheckSquare, Pencil, AlertCircle, Home, Flame, Snowflake, Sparkles, Wand2, ClipboardPaste, Info, Layers, MessageCircle, Send, Cake, Tag, Copy, Clock, MapPinOff, TrendingUp, Rocket, Smartphone } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Contact, ContactList } from '../types';
import { useZapMass } from '../context/ZapMassContext';
import { useAppView } from '../context/AppViewContext';
import type { CampaignWizardDraft } from '../types/campaignMission';
import toast from 'react-hot-toast';
import { Badge, Button, Card, EmptyState, SectionHeader, StatCard } from './ui';
import { ContactsHeaderBar } from './contacts/workspace/ContactsHeaderBar';
import { ContactsSidebar, type SmartFilterId, type SidebarCounts } from './contacts/workspace/ContactsSidebar';
import { ContactsTableVirtual } from './contacts/workspace/ContactsTableVirtual';
import { ContactsBulkBar } from './contacts/workspace/ContactsBulkBar';
import { ContactDetailDrawer } from './contacts/workspace/ContactDetailDrawer';
import { ContactsInsightsModal } from './contacts/workspace/ContactsInsightsModal';
import { parseVcfText, type ParsedVcfEntry } from '../utils/parseVcf';
import { contactsToVcfString } from '../utils/exportContactsVcf';

const BR_STATES = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

const DEFAULT_CHURCH_ROLES = ['Membro', 'Visitante', 'Lider', 'Diacono', 'Pastor', 'Musico', 'Obreiro', 'Professor'];

// Colunas do modelo de importacao (tambem usadas em todos os exports)
const TEMPLATE_COLUMNS: Array<{ key: keyof Contact | 'tags' | 'status'; label: string; width: number }> = [
  { key: 'name', label: 'Nome', width: 28 },
  { key: 'phone', label: 'Telefone', width: 18 },
  { key: 'birthday', label: 'Aniversario', width: 14 },
  { key: 'email', label: 'Email', width: 28 },
  { key: 'street', label: 'Rua', width: 28 },
  { key: 'number', label: 'Numero', width: 8 },
  { key: 'neighborhood', label: 'Bairro', width: 18 },
  { key: 'city', label: 'Cidade', width: 20 },
  { key: 'state', label: 'UF', width: 6 },
  { key: 'zipCode', label: 'CEP', width: 12 },
  { key: 'church', label: 'Igreja', width: 22 },
  { key: 'role', label: 'Cargo (Igreja)', width: 20 },
  { key: 'profession', label: 'Cargo Profissional', width: 22 },
  { key: 'tags', label: 'Tags (separadas por ;)', width: 22 },
  { key: 'status', label: 'Status', width: 10 }
];

/** Chave unica por telefone (BR: adiciona 55 se faltar) — duplicados e temperatura. */
const normPhoneKey = (p: string): string => {
  let d = (p || '').replace(/\D/g, '');
  if (!d) return '';
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
  return d;
};

type FileImportPreviewFilter = 'all' | 'problem' | 'duplicate' | 'ready';

type FileImportRow = {
  id: string;
  lineNumber: number;
  include: boolean;
  contact: Contact;
};

type FileImportRowView = FileImportRow & {
  duplicate: boolean;
  /** Número já existe na base (CRM). */
  duplicateAgainstBase: boolean;
  /** Mesmo telefone apareceu numa linha anterior deste ficheiro (2ª cópia em diante). */
  duplicateRepeatedInFile: boolean;
  duplicateName?: string;
  problems: string[];
};

type ImportTargetMode = 'none' | 'existing' | 'new';

type SmartRow = {
  id: string;
  include: boolean;
  name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  street: string;
  number: string;
  neighborhood: string;
  zipCode: string;
  church: string;
  role: string;
  profession: string;
  birthday: string;
  notes: string;
  duplicate?: boolean;
  duplicateName?: string;
  problems?: string[];
};

// --- TEMPERATURA DO CONTATO ---
// Calcula o nivel de engajamento com base no historico de campanhas no
// `conversations` global (status de entrega/leitura + respostas).
type Temperature = 'hot' | 'warm' | 'cold' | 'new';

interface TempStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  lastSentTs: number;
  lastReplyTs: number;
  lastReadTs: number;
  temp: Temperature;
  score: number;
}

const TEMP_LABEL: Record<Temperature, string> = {
  hot: 'Quente',
  warm: 'Morno',
  cold: 'Frio',
  new: 'Sem hist.'
};
const TEMP_ACCENT: Record<Temperature, { bg: string; fg: string; border: string }> = {
  hot: { bg: 'bg-red-50 dark:bg-red-950/30', fg: 'text-red-700 dark:text-red-300', border: 'border-red-200 dark:border-red-900/40' },
  warm: { bg: 'bg-amber-50 dark:bg-amber-950/30', fg: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-900/40' },
  cold: { bg: 'bg-sky-50 dark:bg-sky-950/30', fg: 'text-sky-700 dark:text-sky-300', border: 'border-sky-200 dark:border-sky-900/40' },
  new: { bg: 'bg-slate-100 dark:bg-slate-800', fg: 'text-slate-500 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-700' }
};

const classifyTemperature = (stats: Omit<TempStats, 'temp' | 'score'>): { temp: Temperature; score: number } => {
  const now = Date.now();
  const DAY = 86400000;
  const daysSinceReply = stats.lastReplyTs ? (now - stats.lastReplyTs) / DAY : Infinity;
  const daysSinceRead = stats.lastReadTs ? (now - stats.lastReadTs) / DAY : Infinity;
  const daysSinceSent = stats.lastSentTs ? (now - stats.lastSentTs) / DAY : Infinity;

  if (stats.sent === 0) return { temp: 'new', score: 0 };

  // Score ponderado: resposta vale muito mais que leitura.
  // Recencia tambem conta.
  const recencyBonus = daysSinceReply < 30 ? 30 : daysSinceReply < 90 ? 15 : 0;
  const readBonus = daysSinceRead < 30 ? 10 : daysSinceRead < 90 ? 5 : 0;
  const score = Math.round(
    stats.replied * 25 + stats.read * 4 + stats.delivered * 1.5 + recencyBonus + readBonus
  );

  // Classificacao
  if (daysSinceReply <= 30 || stats.replied >= 2) return { temp: 'hot', score };
  if (daysSinceReply <= 90 || daysSinceRead <= 30 || stats.read >= 3) return { temp: 'warm', score };
  if (daysSinceSent <= 180) return { temp: 'cold', score };
  return { temp: 'cold', score };
};

/** Lista contem o contato pelo id canonico ou por id legado em aliasContactIds. */
const listHasContact = (contactIds: string[], contact: Contact): boolean => {
  const set = new Set(contactIds || []);
  if (set.has(contact.id)) return true;
  for (const aid of contact.aliasContactIds || []) {
    if (aid && set.has(aid)) return true;
  }
  return false;
};

const stripContactIdsFromList = (contactIds: string[], contact: Contact): string[] => {
  const strip = new Set([contact.id, ...(contact.aliasContactIds || [])].filter(Boolean));
  return (contactIds || []).filter((id) => !strip.has(id));
};

const mergeContactsIntoListIds = (existing: string[], candidateIds: string[], allContacts: Contact[]): string[] => {
  const next = [...(existing || [])];
  const set = new Set(next);
  for (const id of candidateIds) {
    const c = allContacts.find((x) => x.id === id);
    if (!c) continue;
    if ((c.phone || '').replace(/\D/g, '').length < 10) continue;
    if (listHasContact(next, c)) continue;
    if (!set.has(c.id)) {
      next.push(c.id);
      set.add(c.id);
    }
  }
  return next;
};

/** Telefones normalizados + include inicial (só linhas novas; «já na base» pode marcar depois). */
const enrichSmartImportParsedForInclude = (rows: SmartRow[], existingContacts: Contact[]): SmartRow[] => {
  const existingKeys = new Set(existingContacts.map((c) => normPhoneKey(c.phone)).filter(Boolean));
  const seenPhoneInFile = new Set<string>();
  return rows.map((r) => {
    const phone = normalizeBRPhone(r.phone || '');
    const problems: string[] = [];
    if (!(r.name || '').trim()) problems.push('Nome ausente');
    const d = phone.replace(/\D/g, '');
    if (!d) problems.push('Telefone ausente');
    else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');
    const k = normPhoneKey(phone);
    const duplicateAgainstBase = !!(k && existingKeys.has(k));
    const duplicateRepeatedInFile = !!(k && seenPhoneInFile.has(k));
    if (k) seenPhoneInFile.add(k);
    const include = problems.length === 0 && !duplicateAgainstBase && !duplicateRepeatedInFile;
    return { ...r, phone, include };
  });
};

const mkSmartRow = (partial: Partial<SmartRow> = {}): SmartRow => ({
  id: `sr_${Math.random().toString(36).slice(2, 10)}`,
  include: true,
  name: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  street: '',
  number: '',
  neighborhood: '',
  zipCode: '',
  church: '',
  role: '',
  profession: '',
  birthday: '',
  notes: '',
  ...partial
});

// Normaliza telefone BR: adiciona 55 se vier sem DDI e tiver 10-11 digitos.
const normalizeBRPhone = (raw: string): string => {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
};

const pickPreferredValue = (current?: string, incoming?: string): string => {
  const cur = (current || '').trim();
  const inc = (incoming || '').trim();
  if (!cur) return inc;
  if (!inc) return cur;
  return inc.length > cur.length ? inc : cur;
};

const mergeContactData = (
  existing: Contact,
  incoming: Partial<Contact>,
  extraTags: string[] = []
): Partial<Contact> => {
  const normalizedIncomingPhone = normalizeBRPhone(incoming.phone || '');
  const mergedTags = Array.from(
    new Set([...(existing.tags || []), ...(incoming.tags || []), ...extraTags].map((t) => (t || '').trim()).filter(Boolean))
  );

  const mergedNotes = [existing.notes, incoming.notes]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .join('\n');

  const finalPhone = normalizedIncomingPhone || existing.phone || '';
  const finalDigits = finalPhone.replace(/\D/g, '');

  return {
    name: pickPreferredValue(existing.name, incoming.name) || 'Sem Nome',
    phone: finalPhone,
    city: pickPreferredValue(existing.city, incoming.city),
    state: pickPreferredValue(existing.state, incoming.state).toUpperCase().slice(0, 2),
    street: pickPreferredValue(existing.street, incoming.street),
    number: pickPreferredValue(existing.number, incoming.number),
    neighborhood: pickPreferredValue(existing.neighborhood, incoming.neighborhood),
    zipCode: pickPreferredValue(existing.zipCode, incoming.zipCode),
    church: pickPreferredValue(existing.church, incoming.church),
    role: pickPreferredValue(existing.role, incoming.role),
    profession: pickPreferredValue(existing.profession, incoming.profession),
    birthday: pickPreferredValue(existing.birthday, incoming.birthday),
    email: pickPreferredValue(existing.email, incoming.email),
    notes: mergedNotes,
    tags: mergedTags.length > 0 ? mergedTags : existing.tags || [],
    status: finalDigits.length >= 10 ? 'VALID' : 'INVALID'
  };
};

// Tenta extrair um nome "razoavel" de um token: >= 2 palavras alfabeticas,
// nao contem numeros. Se for so uma palavra, aceita se tiver >= 3 letras.
const looksLikeName = (token: string): boolean => {
  const t = token.trim();
  if (!t) return false;
  if (/\d/.test(t)) return false;
  if (t.length < 3) return false;
  // Ao menos 60% das letras devem ser A-Za-z/acentuadas
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '').length;
  return letters / t.length >= 0.55;
};

const looksLikeEmail = (s: string) => /\S+@\S+\.\S+/.test(s);
const looksLikeCEP = (s: string) => /^\d{5}-?\d{3}$/.test(s.trim());
const looksLikeDate = (s: string) => /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(s.trim()) || /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
const looksLikeState = (s: string) => /^[A-Z]{2}$/.test(s.trim().toUpperCase()) && BR_STATES.has(s.trim().toUpperCase());
const extractPhoneFrom = (s: string): string => {
  // Pega a primeira sequencia de digitos >= 10 (com ou sem mascara)
  const m = s.match(/(?:\+?\d{1,3}\s*)?\(?\d{2}\)?\s*9?\s*\d{4,5}[\s\-.]?\d{4}/);
  if (!m) return '';
  return normalizeBRPhone(m[0]);
};

// Parser principal: recebe texto cru do clipboard e devolve linhas estruturadas.
// Estrategia:
// 1. Divide em linhas.
// 2. Se a primeira linha parece cabecalho (nome, telefone, etc), faz mapeamento por coluna.
// 3. Caso contrario, para cada linha faz deteccao por tipo de token.
const parseSmartText = (text: string): SmartRow[] => {
  const normalized = text.replace(/\r/g, '').replace(/[\u00A0]/g, ' ');
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Detecta delimitador: tab (Excel paste) > ; > , > 2+ spaces
  const sample = lines[0];
  const delim = sample.includes('\t') ? '\t' : sample.includes(';') ? ';' : sample.includes(',') && sample.split(',').length >= 3 ? ',' : /\s{2,}/.test(sample) ? /\s{2,}/ : '\t';

  const split = (line: string) =>
    (typeof delim === 'string' ? line.split(delim) : line.split(delim)).map(c => c.trim()).filter((_v, i, arr) => arr.length > 1 || _v);

  // Cabecalho?
  const firstCols = split(lines[0]);
  const hdrTokens = firstCols.map(c => c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const looksLikeHeader = hdrTokens.some(t => ['nome','telefone','email','cidade','cep','rua','bairro','igreja','cargo','profissao','estado','uf'].includes(t));

  const rows: SmartRow[] = [];
  const HEADER_KEY: Record<string, keyof SmartRow> = {
    nome: 'name', name: 'name',
    telefone: 'phone', celular: 'phone', phone: 'phone', whatsapp: 'phone',
    email: 'email',
    cidade: 'city', city: 'city',
    uf: 'state', estado: 'state', state: 'state',
    rua: 'street', logradouro: 'street', endereco: 'street', street: 'street',
    numero: 'number', 'n': 'number',
    bairro: 'neighborhood',
    cep: 'zipCode',
    igreja: 'church', congregacao: 'church',
    cargo: 'role', 'cargo(igreja)': 'role',
    cargoprofissional: 'profession', profissao: 'profession',
    aniversario: 'birthday', nascimento: 'birthday', datadenascimento: 'birthday',
    obs: 'notes', observacoes: 'notes', notes: 'notes'
  };

  if (looksLikeHeader && firstCols.length >= 2) {
    const keys: Array<keyof SmartRow | null> = hdrTokens.map(t => {
      const cleaned = t.replace(/[^a-z0-9]/g, '');
      return HEADER_KEY[cleaned] || HEADER_KEY[t] || null;
    });
    // Ajuste: se a 1a coluna for "numero" mas ja temos telefone depois, mantem ambos
    // (ja mapeado corretamente por chave distinta).
    for (let i = 1; i < lines.length; i++) {
      const cols = split(lines[i]);
      const r = mkSmartRow();
      keys.forEach((k, idx) => {
        if (!k) return;
        const v = (cols[idx] || '').trim();
        if (!v) return;
        if (k === 'phone') r.phone = normalizeBRPhone(v);
        else if (k === 'state') r.state = v.toUpperCase().slice(0, 2);
        else if (k === 'zipCode') {
          const d = v.replace(/\D/g, '').slice(0, 8);
          r.zipCode = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
        } else if (k === 'birthday') {
          const m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
          if (m) {
            const yyyy = m[3].length === 2 ? `19${m[3]}` : m[3];
            r.birthday = `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
          } else r.birthday = v;
        } else (r as any)[k] = v;
      });
      rows.push(r);
    }
    return rows;
  }

  // Sem cabecalho: heuristica token-a-token.
  for (const line of lines) {
    const cols = split(line).filter(Boolean);
    if (cols.length === 0) continue;
    const r = mkSmartRow();
    const remaining: string[] = [];
    for (const col of cols) {
      const trimmed = col.trim();
      if (!trimmed) continue;
      // Tenta telefone primeiro (pode estar embutido em algo maior)
      const ph = extractPhoneFrom(trimmed);
      if (!r.phone && ph) { r.phone = ph; continue; }
      if (!r.email && looksLikeEmail(trimmed)) { r.email = trimmed; continue; }
      if (!r.zipCode && looksLikeCEP(trimmed)) {
        const d = trimmed.replace(/\D/g, '');
        r.zipCode = `${d.slice(0, 5)}-${d.slice(5)}`;
        continue;
      }
      if (!r.birthday && looksLikeDate(trimmed)) {
        const m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (m) {
          const yyyy = m[3].length === 2 ? `19${m[3]}` : m[3];
          r.birthday = `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        } else r.birthday = trimmed;
        continue;
      }
      if (!r.state && looksLikeState(trimmed)) { r.state = trimmed.toUpperCase(); continue; }
      // Cidade no formato "Sao Paulo - SP"
      const cityState = trimmed.match(/^(.+?)\s*[-\/]\s*([A-Z]{2})$/);
      if (!r.city && cityState && BR_STATES.has(cityState[2].toUpperCase())) {
        r.city = cityState[1].trim();
        if (!r.state) r.state = cityState[2].toUpperCase();
        continue;
      }
      remaining.push(trimmed);
    }
    // Primeiro token alfabetico vira nome; os demais vao para observacoes se nao couberam.
    const nameIdx = remaining.findIndex(looksLikeName);
    if (nameIdx >= 0) {
      r.name = remaining[nameIdx];
      remaining.splice(nameIdx, 1);
    }
    // Se tem 2+ colunas restantes, tenta interpretar: 1a = cidade se nao tiver, 2a = igreja, 3a = cargo
    for (const leftover of remaining) {
      if (!r.city && looksLikeName(leftover)) { r.city = leftover; continue; }
      if (!r.church) { r.church = leftover; continue; }
      if (!r.role) { r.role = leftover; continue; }
      if (!r.profession) { r.profession = leftover; continue; }
      r.notes = [r.notes, leftover].filter(Boolean).join(' | ');
    }
    if (r.name || r.phone) rows.push(r);
  }
  return rows;
};

/** Rascunho de campanha "vazio" — só com destinatário. */
const emptyCampaignDraft = (): CampaignWizardDraft => {
  const stageId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    name: '',
    sendMode: 'list',
    selectedListId: '',
    manualNumbers: '',
    selectedConnectionIds: [],
    delaySeconds: 45,
    campaignFlowMode: 'sequential',
    messageStages: [
      {
        id: stageId,
        body: '',
        acceptAnyReply: true,
        validTokensText: '1, 2, sim, nao',
        invalidReplyBody: 'Não entendi. Responda com uma das opções acima.'
      }
    ],
    filterCities: [],
    filterChurches: [],
    filterRoles: [],
    filterProfessions: [],
    filterDDDs: [],
    filterSearch: '',
    selectedContactPhones: [],
    manualSelection: false
  };
};

export const ContactsTab: React.FC = () => {
  const { contacts, contactLists, conversations, addContact, removeContact, updateContact, createContactList, deleteContactList, updateContactList } = useZapMass();
  const { setCurrentView } = useAppView();
  /** Evita travar a UI quando o socket atualiza conversas em alta frequência — o cálculo de temperatura acompanha com pequeno atraso. */
  const deferredConversations = useDeferredValue(conversations);

  /** Telefones que aparecem mais de uma vez — O(n), usado em filtros e segmentos (antes era O(n²) no segmento duplicados). */
  const phoneDupKeys = useMemo(() => {
    const cnt: Record<string, number> = {};
    for (const c of contacts) {
      const k = normPhoneKey(c.phone);
      if (!k) continue;
      cnt[k] = (cnt[k] || 0) + 1;
    }
    const dup = new Set<string>();
    for (const k in cnt) if (cnt[k] > 1) dup.add(k);
    return dup;
  }, [contacts]);

  const contactByPhoneKey = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) {
      const k = normPhoneKey(c.phone);
      if (!k) continue;
      if (!map.has(k)) map.set(k, c);
    }
    return map;
  }, [contacts]);

  // NOVO LAYOUT: filtro smart único (sidebar) + drawer + modal de insights
  const [activeFilter, setActiveFilter] = useState<SmartFilterId>(() => {
    try {
      const v = localStorage.getItem('zapmass.contactsFilter');
      if (typeof v === 'string' && v.length > 0) return v as SmartFilterId;
    } catch { /* ignore */ }
    return 'all';
  });
  useEffect(() => {
    try { localStorage.setItem('zapmass.contactsFilter', String(activeFilter)); } catch { /* ignore */ }
  }, [activeFilter]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'VALID' | 'INVALID'>('ALL');
  const [filterTag, setFilterTag] = useState('');
  const [filterTemp, setFilterTemp] = useState<'ALL' | Temperature>('ALL');
  const [newContact, setNewContact] = useState<Partial<Contact>>({
    name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '',
    church: '', role: '', profession: '', birthday: '', email: '', notes: ''
  });
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingListName, setEditingListName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vcfInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState('');
  /** Lista aberta para gerir membros (sub-aba Na lista / Adicionar). */
  const [listManageId, setListManageId] = useState<string | null>(null);
  const [listManageSubTab, setListManageSubTab] = useState<'members' | 'add'>('members');
  const [listMemberSearch, setListMemberSearch] = useState('');
  const [listAddSearch, setListAddSearch] = useState('');
  const [listAddSelectedIds, setListAddSelectedIds] = useState<string[]>([]);
  const [addToListSelectId, setAddToListSelectId] = useState('');
  const [quickListName, setQuickListName] = useState('');
  // Smart Import: colar do Excel/Word e interpretar livremente
  const [smartImportOpen, setSmartImportOpen] = useState(false);
  const [smartImportRaw, setSmartImportRaw] = useState('');
  const [smartImportRows, setSmartImportRows] = useState<SmartRow[]>([]);
  const [smartImportPreviewFilter, setSmartImportPreviewFilter] = useState<FileImportPreviewFilter>('all');
  const [fileImportOpen, setFileImportOpen] = useState(false);
  const [fileImportRows, setFileImportRows] = useState<FileImportRow[]>([]);
  const [fileImportFilter, setFileImportFilter] = useState<FileImportPreviewFilter>('all');
  const [fileImportLabel, setFileImportLabel] = useState('');
  const [fileImportTargetMode, setFileImportTargetMode] = useState<ImportTargetMode>('none');
  const [fileImportTargetListId, setFileImportTargetListId] = useState('');
  const [fileImportNewListName, setFileImportNewListName] = useState('');
  const [smartImportTargetMode, setSmartImportTargetMode] = useState<ImportTargetMode>('none');
  const [smartImportTargetListId, setSmartImportTargetListId] = useState('');
  const [smartImportNewListName, setSmartImportNewListName] = useState('');
  const [newContactTargetMode, setNewContactTargetMode] = useState<ImportTargetMode>('none');
  const [newContactTargetListId, setNewContactTargetListId] = useState('');
  const [newContactNewListName, setNewContactNewListName] = useState('');

  useEffect(() => {
    if (listManageId && !contactLists.some((l) => l.id === listManageId)) {
      setListManageId(null);
      setListAddSelectedIds([]);
    }
  }, [contactLists, listManageId]);

  /** Abre a conversa deste contato no Chat (via handshake sessionStorage). */
  const openInChat = useCallback((contact: Contact) => {
    const digits = (contact.phone || '').replace(/\D/g, '');
    if (!digits) {
      toast.error('Contato sem telefone válido.');
      return;
    }
    try {
      // Enviamos um payload JSON completo para que o Chat consiga criar um
      // rascunho de conversa (com nome/telefone) caso ainda não exista
      // histórico com este número — assim o usuário pode iniciar a conversa
      // sem precisar criar campanha nem esperar resposta.
      const payload = JSON.stringify({
        phone: digits,
        name: contact.name || '',
        profilePicUrl: '',
      });
      sessionStorage.setItem('zapmass.openChatByPhone', payload);
    } catch {
      /* ignore */
    }
    setCurrentView('chat');
  }, [setCurrentView]);

  /** Dispara a Wizard de nova campanha com base em um rascunho pré-preenchido. */
  const launchCampaignWithDraft = useCallback((draft: CampaignWizardDraft, toastMsg?: string) => {
    try {
      sessionStorage.setItem('zapmass.pendingCampaignDraft', JSON.stringify(draft));
    } catch {
      /* ignore */
    }
    if (toastMsg) toast.success(toastMsg);
    setCurrentView('campaigns');
  }, [setCurrentView]);

  /** Cria uma campanha para 1 contato (modo manual). */
  const handleCreateCampaignForContact = (contact: Contact) => {
    const digits = (contact.phone || '').replace(/\D/g, '');
    if (!digits || digits.length < 10) {
      toast.error('Telefone inválido. Edite o contato primeiro.');
      return;
    }
    const draft = emptyCampaignDraft();
    draft.sendMode = 'manual';
    draft.manualNumbers = digits;
    draft.name = `Mensagem para ${contact.name || digits}`;
    launchCampaignWithDraft(draft, 'Abrindo novo envio 1:1...');
  };

  /** Cria campanha com a seleção atual (modo manual com vários telefones). */
  const handleCreateCampaignWithSelection = () => {
    const validPhones = selectedIds
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is Contact => !!c)
      .map((c) => (c.phone || '').replace(/\D/g, ''))
      .filter((p) => p.length >= 10);
    if (validPhones.length === 0) {
      toast.error('Selecione contatos com telefone válido.');
      return;
    }
    const draft = emptyCampaignDraft();
    draft.sendMode = 'manual';
    draft.manualNumbers = validPhones.join('\n');
    draft.name = `Campanha (${validPhones.length} contatos)`;
    launchCampaignWithDraft(draft, `Abrindo campanha com ${validPhones.length} contato(s)…`);
  };

  /** Cria campanha usando uma lista já existente. */
  const handleCreateCampaignWithList = (list: ContactList) => {
    const count = (list.contactIds || []).length;
    if (count === 0) {
      toast.error('Esta lista está vazia.');
      return;
    }
    const draft = emptyCampaignDraft();
    draft.sendMode = 'list';
    draft.selectedListId = list.id;
    draft.name = `Campanha — ${list.name}`;
    launchCampaignWithDraft(draft, `Abrindo campanha com "${list.name}" (${count})…`);
  };

  const handleCopyPhone = async (contact: Contact) => {
    const digits = (contact.phone || '').replace(/\D/g, '');
    if (!digits) {
      toast.error('Sem telefone para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(digits);
      toast.success('Telefone copiado.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Remover ${selectedIds.length} contato(s) da base? Esta ação não pode ser desfeita.`)) return;
    const removingToastId = toast.loading('Removendo contatos...');
    const results = await Promise.allSettled(
      selectedIds.map((id) => removeContact(id, { silent: true }))
    );
    const n = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - n;
    setSelectedIds([]);
    if (failed > 0) {
      toast.error(
        `${n} contato(s) removido(s), ${failed} com falha.`,
        { id: removingToastId }
      );
      return;
    }
    // Feedback único e discreto (sem spam de "Contato removido").
    toast.success(`${n} removido(s).`, { id: removingToastId, duration: 1800 });
  };

  const handleBulkExport = () => {
    if (selectedIds.length === 0) return;
    const selected = contacts.filter((c) => selectedIds.includes(c.id));
    const header = TEMPLATE_COLUMNS.map(c => c.label);
    const rows = selected.map(c => TEMPLATE_COLUMNS.map(col => {
      if (col.key === 'tags') return (c.tags || []).join(';');
      if (col.key === 'status') return c.status;
      const v = (c as any)[col.key];
      return v == null ? '' : String(v);
    }));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: c.width }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SeleÃ§Ã£o');
    XLSX.writeFile(wb, `contatos_selecionados_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`${selected.length} contato(s) exportado(s).`);
  };

  const handleBulkAddTag = async () => {
    if (selectedIds.length === 0) return;
    const raw = window.prompt('Nova tag para os contatos selecionados (separe várias com vírgula):', '');
    if (raw == null) return;
    const tags = raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) {
      toast.error('Informe ao menos uma tag.');
      return;
    }
    let n = 0;
    for (const id of selectedIds) {
      const c = contacts.find((x) => x.id === id);
      if (!c) continue;
      const merged = Array.from(new Set([...(c.tags || []), ...tags]));
      await updateContact(id, { tags: merged });
      n++;
    }
    toast.success(`Tag aplicada em ${n} contato(s).`);
  };

  const handleBulkRemoveTag = async () => {
    if (selectedIds.length === 0) return;
    const raw = window.prompt('Tag a remover dos selecionados:', '');
    if (raw == null) return;
    const tag = raw.trim();
    if (!tag) return;
    const lower = tag.toLowerCase();
    let n = 0;
    for (const id of selectedIds) {
      const c = contacts.find((x) => x.id === id);
      if (!c) continue;
      if (!(c.tags || []).some((t) => t.toLowerCase() === lower)) continue;
      await updateContact(id, { tags: (c.tags || []).filter((t) => t.toLowerCase() !== lower) });
      n++;
    }
    toast.success(`Tag "${tag}" removida de ${n} contato(s).`);
  };

  const openListManage = (listId: string) => {
    setListManageId(listId);
    setListManageSubTab('members');
    setListMemberSearch('');
    setListAddSearch('');
    setListAddSelectedIds([]);
  };

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleSelectAll = () =>
    setSelectedIds(prev => prev.length === paginatedContacts.length ? [] : paginatedContacts.map(c => c.id));

  const handleCreateListFromSelection = async () => {
    const validSelectedIds = selectedIds.filter(id => {
      const contact = contacts.find(item => item.id === id);
      return Boolean(contact?.phone?.replace(/\D/g, '').length >= 10);
    });

    if (!newListName.trim()) {
      toast.error('Informe um nome para a lista.');
      return;
    }

    if (validSelectedIds.length === 0) {
      toast.error('Selecione pelo menos um contato com telefone valido.');
      return;
    }

    try {
      await createContactList(newListName.trim(), validSelectedIds, `Lista criada pela aba Contatos com ${validSelectedIds.length} contato(s).`);
      toast.success(`Lista "${newListName.trim()}" criada com ${validSelectedIds.length} contatos!`);
      setNewListName('');
      setShowCreateList(false);
      setSelectedIds([]);
    } catch {
      toast.error('Não foi possível criar a lista agora.');
    }
  };

  const handleCreateQuickList = async () => {
    const baseIds = selectedIds.length > 0 ? selectedIds : filteredContacts.map(contact => contact.id);
    const validIds = baseIds.filter(id => {
      const contact = contacts.find(item => item.id === id);
      return Boolean(contact?.phone?.replace(/\D/g, '').length >= 10);
    });

    if (!quickListName.trim()) {
      toast.error('Informe um nome para a nova lista.');
      return;
    }
    if (validIds.length === 0) {
      toast.error('Selecione contatos validos ou ajuste o filtro antes de criar a lista.');
      return;
    }

    try {
      await createContactList(quickListName.trim(), validIds, `Lista criada rapidamente com ${validIds.length} contato(s).`);
      toast.success(`Lista "${quickListName.trim()}" criada com ${validIds.length} contatos.`);
      setQuickListName('');
    } catch {
      toast.error('Não foi possível criar a lista.');
    }
  };

  // Mapeia rotulos de cabecalho (pt/en, com/sem acento) para chaves do Contact.
  // Garante que XLSX antigos, novos, ou CSVs exportados funcionem.
  const normalizeHeader = (h: string): string =>
    h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  const HEADER_MAP: Record<string, keyof Contact | 'tags'> = {
    nome: 'name', name: 'name', fullname: 'name', nomecompleto: 'name',
    telefone: 'phone', phone: 'phone', celular: 'phone', whatsapp: 'phone', numero: 'phone',
    email: 'email', mail: 'email',
    aniversario: 'birthday', aniversariodddmaaaammdd: 'birthday', birthday: 'birthday', datadenascimento: 'birthday', nascimento: 'birthday',
    cidade: 'city', city: 'city',
    uf: 'state', estado: 'state', state: 'state',
    rua: 'street', logradouro: 'street', endereco: 'street', street: 'street',
    numeroendereco: 'number', numerocasa: 'number', num: 'number',
    bairro: 'neighborhood', neighborhood: 'neighborhood',
    cep: 'zipCode', zipcode: 'zipCode', zip: 'zipCode',
    igreja: 'church', church: 'church', congregacao: 'church',
    cargoigreja: 'role', cargo: 'role', role: 'role', posicionamento: 'role',
    cargoprofissional: 'profession', profissao: 'profession', profession: 'profession',
    tags: 'tags', tag: 'tags', etiquetas: 'tags',
    observacoes: 'notes', obs: 'notes', notes: 'notes'
  };

  // Considera colisao de "numero" (telefone vs numero da casa):
  // se ja tivermos uma coluna identificada como 'phone', o segundo "numero" vira 'number'.
  const buildHeaderIndex = (rawHeaders: string[]) => {
    const index: Array<keyof Contact | 'tags' | null> = [];
    let phoneSeen = false;
    rawHeaders.forEach((raw) => {
      const norm = normalizeHeader(raw);
      // Deteccao por palavra exata primeiro
      let key: keyof Contact | 'tags' | null = HEADER_MAP[norm] || null;
      // Deteccao heuristica: "numero" padrao = telefone. Se ja temos telefone mapeado, vira numero da casa.
      if (norm === 'numero') {
        key = phoneSeen ? 'number' : 'phone';
      }
      if (key === 'phone') phoneSeen = true;
      index.push(key);
    });
    return index;
  };

  /** Monta contato a partir da linha (mesmo incompleto) para revisao antes de importar. */
  const mapHeaderRowToContact = (headerIndex: Array<keyof Contact | 'tags' | null>, row: any[], i: number): Contact => {
    const data: Partial<Contact> & { tags?: string[] } = {};
    headerIndex.forEach((key, idx) => {
      if (!key) return;
      const raw = row[idx];
      const v = raw == null ? '' : String(raw).trim();
      if (!v) return;
      if (key === 'phone') {
        data.phone = v.replace(/\D/g, '');
      } else if (key === 'tags') {
        data.tags = v.split(/[;,]/).map(t => t.trim()).filter(Boolean);
      } else if (key === 'birthday') {
        const iso = /^\d{4}-\d{2}-\d{2}$/;
        const br = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;
        if (iso.test(v)) data.birthday = v;
        else if (br.test(v)) {
          const m = v.match(br)!;
          const yyyy = m[3].length === 2 ? `19${m[3]}` : m[3];
          data.birthday = `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        } else {
          data.birthday = v;
        }
      } else if (key === 'zipCode') {
        const d = v.replace(/\D/g, '').slice(0, 8);
        data.zipCode = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
      } else if (key === 'state') {
        data.state = v.toUpperCase().slice(0, 2);
      } else {
        (data as any)[key] = v;
      }
    });
    const digits = (data.phone || '').replace(/\D/g, '');
    return {
      id: `import_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      name: (data.name as string) || '',
      phone: digits,
      city: data.city || '',
      state: data.state || '',
      street: data.street || '',
      number: data.number || '',
      neighborhood: data.neighborhood || '',
      zipCode: data.zipCode || '',
      church: data.church || '',
      role: data.role || '',
      profession: data.profession || '',
      birthday: data.birthday || '',
      email: data.email || '',
      notes: data.notes || '',
      tags: data.tags && data.tags.length ? data.tags : ['Importado'],
      status: digits.length >= 10 ? 'VALID' : 'INVALID',
      lastMsg: 'Nunca'
    };
  };

  const vcfParsedToContact = (entry: ParsedVcfEntry, i: number): Contact => {
    const digits = (entry.phoneDigits || '').replace(/\D/g, '');
    const zp = (entry.zipCode || '').replace(/\D/g, '').slice(0, 8);
    const zipCode = zp.length > 5 ? `${zp.slice(0, 5)}-${zp.slice(5)}` : zp;
    return {
      id: `import_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      name: entry.name.trim(),
      phone: digits,
      city: entry.city || '',
      state: (entry.state || '').toUpperCase().slice(0, 2),
      street: entry.street || '',
      number: '',
      neighborhood: entry.neighborhood || '',
      zipCode,
      church: entry.church || '',
      role: '',
      profession: entry.profession || '',
      birthday: entry.birthday || '',
      email: entry.email || '',
      notes: entry.notes || '',
      tags: ['Importado', 'vCard'],
      status: digits.length >= 10 ? 'VALID' : 'INVALID',
      lastMsg: 'Nunca'
    };
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const lower = file.name.toLowerCase();
    const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');

    try {
      let rows: any[][] = [];
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: '' });
      } else {
        const text = await file.text();
        const clean = text.replace(/\r/g, '');
        const firstLine = clean.split('\n')[0] || '';
        const delim = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
        rows = clean.split('\n').filter(Boolean).map(line =>
          line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''))
        );
      }

      if (rows.length < 2) { toast.error('Arquivo vazio ou sem dados.'); return; }

      const rawHeaders = rows[0].map((h: any) => String(h || ''));
      const headerIndex = buildHeaderIndex(rawHeaders);
      const hasName = headerIndex.includes('name');
      const hasPhone = headerIndex.includes('phone');
      if (!hasName || !hasPhone) {
        toast.error('Arquivo invalido: nao encontrei colunas de Nome e/ou Telefone.');
        return;
      }

      const existingKeys = new Set(contacts.map(c => normPhoneKey(c.phone)).filter(Boolean));
      const seenPhoneInFile = new Set<string>();
      const preview: FileImportRow[] = [];
      let nProb = 0;

      for (let i = 1; i < rows.length; i++) {
        const contact = mapHeaderRowToContact(headerIndex, rows[i], i);
        const problems: string[] = [];
        if (!contact.name.trim()) problems.push('Nome ausente');
        const d = contact.phone.replace(/\D/g, '');
        if (!d) problems.push('Telefone ausente');
        else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');

        const k = normPhoneKey(contact.phone);
        const duplicateAgainstBase = !!(k && existingKeys.has(k));
        const duplicateRepeatedInFile = !!(k && seenPhoneInFile.has(k));
        const duplicate = duplicateAgainstBase || duplicateRepeatedInFile;
        if (k) seenPhoneInFile.add(k);

        if (problems.length > 0 || duplicate) nProb++;
        /** Novos só: já na base pode marcar para unificar dados e vincular à lista. */
        const include =
          problems.length === 0 && !duplicateRepeatedInFile && !duplicateAgainstBase;
        preview.push({
          id: `fip_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          lineNumber: i + 1,
          include,
          contact
        });
      }

      setFileImportRows(preview);
      setFileImportLabel(file.name);
      setFileImportFilter('all');
      setFileImportTargetMode('none');
      setFileImportTargetListId('');
      setFileImportNewListName('');
      setFileImportOpen(true);
      toast.success(`Arquivo carregado: ${preview.length} linha(s). ${nProb > 0 ? `${nProb} com aviso — revise antes de importar.` : 'Pronto para importar.'}`);
    } catch (err: any) {
      console.error('[ImportContacts]', err);
      toast.error('Falha ao ler o arquivo. Confira o formato e tente novamente.');
    }
  };

  const handleImportVcf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const entries = parseVcfText(text);
      if (entries.length === 0) {
        toast.error('Nenhum vCard (BEGIN:VCARD) encontrado no ficheiro.');
        return;
      }
      const existingKeys = new Set(contacts.map((c) => normPhoneKey(c.phone)).filter(Boolean));
      const seenPhoneInFile = new Set<string>();
      const preview: FileImportRow[] = [];
      let nProb = 0;

      entries.forEach((entry, i) => {
        const contact = vcfParsedToContact(entry, i);
        const problems: string[] = [];
        if (!contact.name.trim()) problems.push('Nome ausente');
        const d = contact.phone.replace(/\D/g, '');
        if (!d) problems.push('Telefone ausente');
        else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');

        const k = normPhoneKey(contact.phone);
        const duplicateAgainstBase = !!(k && existingKeys.has(k));
        const duplicateRepeatedInFile = !!(k && seenPhoneInFile.has(k));
        const duplicate = duplicateAgainstBase || duplicateRepeatedInFile;
        if (k) seenPhoneInFile.add(k);

        if (problems.length > 0 || duplicate) nProb++;
        const include =
          problems.length === 0 && !duplicateRepeatedInFile && !duplicateAgainstBase;
        preview.push({
          id: `fip_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          lineNumber: i + 1,
          include,
          contact
        });
      });

      setFileImportRows(preview);
      setFileImportLabel(file.name);
      setFileImportFilter('all');
      setFileImportTargetMode('none');
      setFileImportTargetListId('');
      setFileImportNewListName('');
      setFileImportOpen(true);
      toast.success(
        `${preview.length} contato(s) no vCard. ${nProb > 0 ? `${nProb} com aviso — revise antes de importar.` : 'Pronto para importar.'}`
      );
    } catch (err: unknown) {
      console.error('[ImportVcf]', err);
      toast.error('Falha ao ler o ficheiro .vcf. Confira o formato e tente novamente.');
    }
  };

  const ITEMS_PER_PAGE = 15;
  const { validCount, topTags, recentContacts } = useMemo(() => {
    const validCount = contacts.filter((c) => c.status === 'VALID').length;
    const tagCounts = contacts.reduce<Record<string, number>>((acc, contact) => {
      contact.tags.forEach((tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    }, {});
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const recentContacts = contacts.slice(0, 5);
    return { validCount, topTags, recentContacts };
  }, [contacts]);

  // Indice de temperatura: Map<contactId, TempStats>.
  // Usa TODAS as mensagens enviadas por voce (nao so campanhas com fromCampaign), para refletir
  // envio / entregue / lido / respondido como no WhatsApp. Chats @lid usam contactPhone.
  const contactTemps = useMemo(() => {
    const byPhone: Record<string, TempStats> = {};
    const stripDigits = (p: string) => (p || '').replace(/\D/g, '');
    const convPrimaryDigits = (conv: { id: string; contactPhone?: string }) => {
      const jid = conv.id || '';
      const [, suffix = ''] = jid.split('@');
      const [user = ''] = jid.split('@');
      if (suffix === 'lid') return stripDigits(conv.contactPhone || '');
      if (/^\d+$/.test(user)) return user;
      return stripDigits(conv.contactPhone || '') || user.replace(/\D/g, '');
    };

    const accum = (phone: string) => {
      if (!byPhone[phone]) {
        byPhone[phone] = {
          sent: 0, delivered: 0, read: 0, replied: 0,
          lastSentTs: 0, lastReplyTs: 0, lastReadTs: 0,
          temp: 'new', score: 0
        };
      }
      return byPhone[phone];
    };

    // Limite por conversa: históricos enormes (milhares de mensagens) não precisam ser
    // varridos na íntegra só para estimar temperatura — evita picos de CPU na aba Contatos.
    const MAX_MESSAGES_SCAN_PER_CONV = 500;

    // Performance: duas passadas sem sort.
    // 1ª passada: acumula envios/leituras/entregas e pega maxOutTs por conversa.
    // 2ª passada: conta respostas (mensagens dela com ts > maxOutTs da conversa).
    // Isso troca O(N log N) por 2×O(N) — em bases com muitas mensagens, é ordens de grandeza mais rápido.
    for (const conv of deferredConversations) {
      const phoneKey = normPhoneKey(convPrimaryDigits(conv));
      if (!phoneKey || phoneKey.length < 12) continue;
      const s = accum(phoneKey);
      const all = conv.messages || [];
      const msgs = all.length > MAX_MESSAGES_SCAN_PER_CONV ? all.slice(all.length - MAX_MESSAGES_SCAN_PER_CONV) : all;
      let maxOutTs = 0;
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        const ts = (m as any).timestampMs || (m.timestamp ? Date.parse(m.timestamp) : 0) || 0;
        if (m.sender === 'me') {
          s.sent++;
          if (ts > s.lastSentTs) s.lastSentTs = ts;
          if (ts > maxOutTs) maxOutTs = ts;
          const st = (m as any).status;
          if (st === 'delivered' || st === 'read') s.delivered++;
          if (st === 'read') {
            s.read++;
            if (ts > s.lastReadTs) s.lastReadTs = ts;
          }
        }
      }
      if (maxOutTs > 0) {
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i];
          if (m.sender !== 'them') continue;
          const ts = (m as any).timestampMs || (m.timestamp ? Date.parse(m.timestamp) : 0) || 0;
          if (ts > maxOutTs) {
            s.replied++;
            if (ts > s.lastReplyTs) s.lastReplyTs = ts;
          }
        }
      }
    }

    const result: Record<string, TempStats> = {};
    for (const c of contacts) {
      const p = normPhoneKey(c.phone);
      const base = byPhone[p] || { sent: 0, delivered: 0, read: 0, replied: 0, lastSentTs: 0, lastReplyTs: 0, lastReadTs: 0 } as Omit<TempStats, 'temp' | 'score'>;
      const cls = classifyTemperature(base);
      result[c.id] = { ...base, temp: cls.temp, score: cls.score };
    }
    return result;
  }, [deferredConversations, contacts]);

  // ============================================================
  //  SMART STATS — métricas acionáveis para aparecer no hero
  // ============================================================
  // Série de 30 dias — crescimento (contatos criados por dia, IDs contêm timestamp).
  const contactsGrowth30d = useMemo(() => {
    const days = 30;
    const buckets = new Array(days).fill(0);
    const now = Date.now();
    const DAY = 86400000;
    for (const c of contacts) {
      const m = (c.id || '').match(/_(\d{13})_/);
      const ts = m ? parseInt(m[1], 10) : null;
      if (!ts || !Number.isFinite(ts)) continue;
      const age = Math.floor((now - ts) / DAY);
      if (age < 0 || age >= days) continue;
      buckets[days - 1 - age]++;
    }
    return buckets;
  }, [contacts]);

  const smartStats = useMemo(() => {
    const today = new Date();
    const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);

    // Aniversariantes hoje + próximos 7 dias
    const parseBirthday = (raw: string): { m: number; d: number } | null => {
      if (!raw) return null;
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return { m: parseInt(iso[2], 10), d: parseInt(iso[3], 10) };
      const br = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (br) return { m: parseInt(br[2], 10), d: parseInt(br[1], 10) };
      return null;
    };

    let bdayToday = 0;
    let bdayWeek = 0;
    for (const c of contacts) {
      const b = parseBirthday(c.birthday || '');
      if (!b) continue;
      const mm = String(b.m).padStart(2, '0');
      const dd = String(b.d).padStart(2, '0');
      if (`${mm}-${dd}` === todayMD) bdayToday++;
      for (let i = 0; i < 7; i++) {
        const dt = new Date(today);
        dt.setDate(dt.getDate() + i);
        if (b.m === dt.getMonth() + 1 && b.d === dt.getDate()) {
          bdayWeek++;
          break;
        }
      }
    }

    const hot = contacts.filter((c) => contactTemps[c.id]?.temp === 'hot').length;
    const warm = contacts.filter((c) => contactTemps[c.id]?.temp === 'warm').length;
    const cold = contacts.filter((c) => contactTemps[c.id]?.temp === 'cold').length;
    const newOnes = contacts.filter((c) => contactTemps[c.id]?.temp === 'new').length;

    // Dormentes: já foi quente/morno mas sem resposta há mais de 30 dias
    const DAY = 86400000;
    const now = Date.now();
    const dormant = contacts.filter((c) => {
      const t = contactTemps[c.id];
      if (!t) return false;
      if (t.sent === 0) return false;
      if (!t.lastReplyTs) return t.sent >= 2 && (now - t.lastSentTs) / DAY > 60;
      return (now - t.lastReplyTs) / DAY > 30 && (now - t.lastReplyTs) / DAY <= 180;
    }).length;

    // Completude: % de contatos com endereço completo
    const addressComplete = contacts.filter(
      (c) => c.street && c.number && c.neighborhood && c.city && c.state && c.zipCode
    ).length;
    const addressPct = contacts.length === 0 ? 0 : Math.round((addressComplete / contacts.length) * 100);

    const noCity = contacts.filter((c) => !(c.city || '').trim()).length;
    const noTag = contacts.filter((c) => (c.tags || []).length === 0).length;
    const invalid = contacts.filter((c) => c.status !== 'VALID').length;

    // Detecta duplicatas de telefone
    const phoneCount: Record<string, number> = {};
    for (const c of contacts) {
      const k = normPhoneKey(c.phone);
      if (!k) continue;
      phoneCount[k] = (phoneCount[k] || 0) + 1;
    }
    const duplicates = contacts.filter((c) => (phoneCount[normPhoneKey(c.phone)] || 0) > 1).length;

    // Novos últimos 7 dias (precisa parsear ID se tiver timestamp)
    // Como fallback, conta contatos cuja tag inclui "Novo"/"Importado" criados recentemente.
    const last7 = contacts.filter((c) => {
      // ids smart_/import_/etc. têm timestamp embutido
      const m = (c.id || '').match(/_(\d{13})_/);
      if (!m) return false;
      const ts = parseInt(m[1], 10);
      return Number.isFinite(ts) && now - ts < 7 * DAY;
    }).length;

    return {
      total: contacts.length,
      hot,
      warm,
      cold,
      newOnes,
      dormant,
      bdayToday,
      bdayWeek,
      addressComplete,
      addressPct,
      noCity,
      noTag,
      invalid,
      duplicates,
      last7
    };
  }, [contacts, contactTemps]);

  // ============================================================
  //  SEGMENTOS INTELIGENTES — chips que aplicam filtros prontos
  // ============================================================
  type SmartSegmentId =
    | 'birthday-week'
    | 'hot-inactive'
    | 'cold-reactivation'
    | 'no-tag'
    | 'no-address'
    | 'duplicates'
    | 'invalid'
    | 'last-7-days';

  const getSmartSegmentMatches = useCallback((id: SmartSegmentId, c: Contact): boolean => {
    const t = contactTemps[c.id];
    const DAY = 86400000;
    const now = Date.now();
    switch (id) {
      case 'birthday-week': {
        if (!c.birthday) return false;
        const iso = c.birthday.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const br = c.birthday.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        const m = iso ? parseInt(iso[2], 10) : br ? parseInt(br[2], 10) : null;
        const d = iso ? parseInt(iso[3], 10) : br ? parseInt(br[1], 10) : null;
        if (!m || !d) return false;
        for (let i = 0; i < 7; i++) {
          const dt = new Date();
          dt.setDate(dt.getDate() + i);
          if (m === dt.getMonth() + 1 && d === dt.getDate()) return true;
        }
        return false;
      }
      case 'hot-inactive':
        return !!t && t.temp === 'hot' && (!t.lastReplyTs || (now - t.lastReplyTs) / DAY > 15);
      case 'cold-reactivation':
        return !!t && t.temp === 'cold' && t.sent > 0;
      case 'no-tag':
        return (c.tags || []).length === 0;
      case 'no-address':
        return !c.street || !c.city || !c.zipCode;
      case 'duplicates': {
        const k = normPhoneKey(c.phone);
        return !!k && phoneDupKeys.has(k);
      }
      case 'invalid':
        return c.status !== 'VALID';
      case 'last-7-days': {
        const m = (c.id || '').match(/_(\d{13})_/);
        if (!m) return false;
        const ts = parseInt(m[1], 10);
        return Number.isFinite(ts) && now - ts < 7 * DAY;
      }
      default:
        return false;
    }
  }, [contactTemps, phoneDupKeys]);

  const [activeSegment, setActiveSegment] = useState<SmartSegmentId | null>(null);

  const smartSegments: Array<{
    id: SmartSegmentId;
    label: string;
    icon: React.ElementType;
    count: number;
    color: string;
    hint: string;
  }> = useMemo(() => {
    const list: Array<{ id: SmartSegmentId; label: string; icon: React.ElementType; color: string; hint: string }> = [
      { id: 'birthday-week',      label: 'Aniversários (7d)',    icon: Cake,        color: 'amber',   hint: 'Faça um envio personalizado' },
      { id: 'hot-inactive',       label: 'Quentes sem contato',  icon: Flame,       color: 'red',     hint: 'Não perca o engajamento' },
      { id: 'cold-reactivation',  label: 'Reativar frios',       icon: Snowflake,   color: 'sky',     hint: 'Campanha de win-back' },
      { id: 'last-7-days',        label: 'Novos (7d)',           icon: Sparkles,    color: 'emerald', hint: 'Acolhida para novatos' },
      { id: 'no-tag',             label: 'Sem tag',              icon: Tag,         color: 'slate',   hint: 'Organize sua base' },
      { id: 'no-address',         label: 'Sem endereço',         icon: MapPinOff,   color: 'slate',   hint: 'Complete os dados' },
      { id: 'duplicates',         label: 'Duplicados',           icon: Layers,      color: 'violet',  hint: 'Mescle ou exclua' },
      { id: 'invalid',            label: 'Inválidos',            icon: AlertCircle, color: 'rose',    hint: 'Corrija os telefones' }
    ];
    return list.map((s) => ({
      ...s,
      count: contacts.filter((c) => getSmartSegmentMatches(s.id, c)).length
    }));
  }, [contacts, getSmartSegmentMatches]);

  const fileImportRowsView = useMemo((): FileImportRowView[] => {
    if (fileImportRows.length === 0) return [];
    const existingKeys = new Set(contacts.map(c => normPhoneKey(c.phone)).filter(Boolean));
    const nameByKey = new Map<string, string>();
    contacts.forEach(c => {
      const k = normPhoneKey(c.phone);
      if (k) nameByKey.set(k, c.name);
    });
    /** Telefones já vistos em linhas anteriores **deste** ficheiro (incl. 1.ª ocorrência). */
    const seenPhoneInFile = new Set<string>();
    return fileImportRows.map(r => {
      const problems: string[] = [];
      if (!r.contact.name.trim()) problems.push('Nome ausente');
      const d = r.contact.phone.replace(/\D/g, '');
      if (!d) problems.push('Telefone ausente');
      else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');
      const k = normPhoneKey(r.contact.phone);
      const duplicateAgainstBase = !!(k && existingKeys.has(k));
      const duplicateRepeatedInFile = !!(k && seenPhoneInFile.has(k));
      const duplicate = duplicateAgainstBase || duplicateRepeatedInFile;
      const duplicateName = k && duplicateAgainstBase ? nameByKey.get(k) : undefined;
      if (k) seenPhoneInFile.add(k);
      return { ...r, problems, duplicate, duplicateAgainstBase, duplicateRepeatedInFile, duplicateName };
    });
  }, [fileImportRows, contacts]);

  /** Resumo da triagem: base vs repetição no arquivo vs novos. */
  const fileImportTriageSummary = useMemo(() => {
    const v = fileImportRowsView;
    const total = v.length;
    const againstBase = v.filter((r) => r.duplicateAgainstBase).length;
    const repeatedInFile = v.filter((r) => r.duplicateRepeatedInFile).length;
    /** 2ª+ vez no ficheiro e o número ainda não estava na base. */
    const repeatedOnlyInFile = v.filter((r) => r.duplicateRepeatedInFile && !r.duplicateAgainstBase).length;
    /** Primeira vez no ficheiro e número novo na base — prontos para importar como novos (se sem outros problemas). */
    const newInFileReady = v.filter(
      (r) => !r.duplicateAgainstBase && !r.duplicateRepeatedInFile && r.problems.length === 0
    ).length;
    return { total, againstBase, repeatedInFile, repeatedOnlyInFile, newInFileReady };
  }, [fileImportRowsView]);

  const contactListMembership = useMemo(() => {
    const counts: Record<string, number> = {};
    const names: Record<string, string[]> = {};
    for (const list of contactLists) {
      for (const cid of list.contactIds || []) {
        counts[cid] = (counts[cid] || 0) + 1;
        if (!names[cid]) names[cid] = [];
        names[cid].push(list.name);
      }
    }
    return { counts, names };
  }, [contactLists]);

  const smartImportRowsView = useMemo(() => {
    if (smartImportRows.length === 0) return [];
    const existingKeys = new Set(contacts.map((c) => normPhoneKey(c.phone)).filter(Boolean));
    const nameByKey = new Map<string, string>();
    contacts.forEach((c) => {
      const k = normPhoneKey(c.phone);
      if (k) nameByKey.set(k, c.name);
    });
    const seenPhoneInFile = new Set<string>();
    return smartImportRows.map((r) => {
      const phone = normalizeBRPhone(r.phone);
      const problems: string[] = [];
      if (!r.name.trim()) problems.push('Nome ausente');
      const d = phone.replace(/\D/g, '');
      if (!d) problems.push('Telefone ausente');
      else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');
      const k = normPhoneKey(phone);
      const duplicateAgainstBase = !!(k && existingKeys.has(k));
      const duplicateRepeatedInFile = !!(k && seenPhoneInFile.has(k));
      if (k) seenPhoneInFile.add(k);
      const duplicate = duplicateAgainstBase || duplicateRepeatedInFile;
      const duplicateName = duplicateAgainstBase && k ? nameByKey.get(k) : undefined;
      return {
        ...r,
        phone,
        problems,
        duplicate,
        duplicateAgainstBase,
        duplicateRepeatedInFile,
        duplicateName
      };
    });
  }, [smartImportRows, contacts]);

  const filteredFileImportRows = useMemo(() => {
    const v = fileImportRowsView;
    if (fileImportFilter === 'all') return v;
    if (fileImportFilter === 'problem') return v.filter(r => r.problems.length > 0 || r.duplicate);
    if (fileImportFilter === 'duplicate') return v.filter(r => r.duplicate);
    if (fileImportFilter === 'ready') return v.filter(r => !r.duplicate && r.problems.length === 0);
    return v;
  }, [fileImportRowsView, fileImportFilter]);

  const filteredSmartImportRows = useMemo(() => {
    const v = smartImportRowsView;
    if (smartImportPreviewFilter === 'all') return v;
    if (smartImportPreviewFilter === 'problem') return v.filter(r => (r.problems?.length || 0) > 0 || r.duplicate);
    if (smartImportPreviewFilter === 'duplicate') return v.filter(r => r.duplicate);
    if (smartImportPreviewFilter === 'ready') return v.filter(r => !r.duplicate && (r.problems?.length || 0) === 0);
    return v;
  }, [smartImportRowsView, smartImportPreviewFilter]);

  // Sugestões para comboboxes — memoizado (antes recalculava 4 passadas em todo render).
  const { roleSuggestions, professionSuggestions, churchSuggestions, citySuggestions } = useMemo(() => {
    const roleSuggestions = Array.from(
      new Set([...DEFAULT_CHURCH_ROLES, ...contacts.map((c) => (c.role || '').trim()).filter(Boolean)])
    ).sort((a, b) => a.localeCompare(b));
    const professionSuggestions = Array.from(
      new Set(contacts.map((c) => (c.profession || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    const churchSuggestions = Array.from(
      new Set(contacts.map((c) => (c.church || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    const citySuggestions = Array.from(
      new Set(contacts.map((c) => (c.city || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    return { roleSuggestions, professionSuggestions, churchSuggestions, citySuggestions };
  }, [contacts]);

  // ============================================================
  //  FILTRO SMART — sidebar do novo layout (all / hot / bday_today / list:xxx / ...)
  // ============================================================
  const matchesSmartFilter = useCallback((c: Contact, filter: SmartFilterId): boolean => {
    if (filter === 'all') return true;
    if (typeof filter === 'string' && filter.startsWith('list:')) {
      const listId = filter.slice(5);
      const list = contactLists.find((l) => l.id === listId);
      return !!list?.contactIds?.includes(c.id);
    }
    const t = contactTemps[c.id];
    switch (filter) {
      case 'hot': return t?.temp === 'hot';
      case 'warm': return t?.temp === 'warm';
      case 'cold': return t?.temp === 'cold';
      case 'new': return !t || t.temp === 'new';
      case 'invalid': return c.status !== 'VALID';
      case 'no_address': return !c.street || !c.city || !c.zipCode;
      case 'duplicates': return phoneDupKeys.has(normPhoneKey(c.phone));
      case 'dormant': {
        if (!t || t.sent === 0) return false;
        const DAY = 86400000;
        const now = Date.now();
        if (!t.lastReplyTs) return t.sent >= 2 && (now - t.lastSentTs) / DAY > 60;
        const d = (now - t.lastReplyTs) / DAY;
        return d > 30 && d <= 180;
      }
      case 'bday_today':
      case 'bday_week': {
        if (!c.birthday) return false;
        const iso = c.birthday.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const br = c.birthday.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        const m = iso ? parseInt(iso[2], 10) : br ? parseInt(br[2], 10) : null;
        const d = iso ? parseInt(iso[3], 10) : br ? parseInt(br[1], 10) : null;
        if (!m || !d) return false;
        const today = new Date();
        if (filter === 'bday_today') return m === today.getMonth() + 1 && d === today.getDate();
        for (let i = 0; i < 7; i++) {
          const dt = new Date(today);
          dt.setDate(dt.getDate() + i);
          if (m === dt.getMonth() + 1 && d === dt.getDate()) return true;
        }
        return false;
      }
      default: return true;
    }
  }, [contactLists, contactTemps, phoneDupKeys]);

  // Filter Logic — memoizado: antes rodava filtro completo em todo re-render (digitar, modal, etc.).
  const filteredContacts = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return contacts.filter((c) => {
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(searchTerm) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        (c.city?.toLowerCase().includes(q) ?? false) ||
        (c.state?.toLowerCase().includes(q) ?? false) ||
        (c.street?.toLowerCase().includes(q) ?? false) ||
        (c.neighborhood?.toLowerCase().includes(q) ?? false) ||
        (c.zipCode?.toLowerCase().includes(q) ?? false) ||
        (c.church?.toLowerCase().includes(q) ?? false) ||
        (c.role?.toLowerCase().includes(q) ?? false) ||
        (c.profession?.toLowerCase().includes(q) ?? false);
      const matchesStatus = filterStatus === 'ALL' || c.status === filterStatus;
      const matchesTag = !filterTag || c.tags.some((t) => t.toLowerCase() === filterTag.toLowerCase());
      const matchesTemp = filterTemp === 'ALL' || contactTemps[c.id]?.temp === filterTemp;
      const matchesSegment = !activeSegment || getSmartSegmentMatches(activeSegment, c);
      const matchesSmart = matchesSmartFilter(c, activeFilter);
      return matchesSearch && matchesStatus && matchesTag && matchesTemp && matchesSegment && matchesSmart;
    });
  }, [
    contacts,
    searchTerm,
    filterStatus,
    filterTag,
    filterTemp,
    activeSegment,
    activeFilter,
    contactTemps,
    matchesSmartFilter,
    getSmartSegmentMatches
  ]);

  const listFilteredContacts = filteredContacts;

  // Pagination Logic
  const totalPages = Math.ceil(listFilteredContacts.length / ITEMS_PER_PAGE);
  const paginatedContacts = useMemo(
    () =>
      listFilteredContacts.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
    [listFilteredContacts, currentPage, ITEMS_PER_PAGE]
  );
  const allPageSelected =
    paginatedContacts.length > 0 && paginatedContacts.every((c) => selectedIds.includes(c.id));

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Tem certeza de que deseja remover este contato da base?')) {
      removeContact(id);
      // Adjust page if empty
      if (paginatedContacts.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      }
    }
  };

  const handleDeleteList = async (id: string, name: string) => {
    if (!window.confirm(`Remover a lista "${name}"? Os contatos permanecem na base.`)) return;
    try {
      await deleteContactList(id);
      toast.success('Lista removida com sucesso.');
      setActiveFilter((prev) => (prev === `list:${id}` ? 'all' : prev));
      setListManageId((prev) => (prev === id ? null : prev));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao remover.';
      toast.error(msg);
    }
  };

  const beginEditContact = (contact: Contact) => {
    setEditingContactId(contact.id);
    setNewContact({
      name: contact.name,
      phone: contact.phone,
      city: contact.city || '',
      state: contact.state || '',
      street: contact.street || '',
      number: contact.number || '',
      neighborhood: contact.neighborhood || '',
      zipCode: contact.zipCode || '',
      church: contact.church || '',
      role: contact.role || '',
      profession: contact.profession || '',
      birthday: contact.birthday || '',
      email: contact.email || '',
      notes: contact.notes || ''
    });
    setNewContactTargetMode('none');
    setNewContactTargetListId('');
    setNewContactNewListName('');
    setIsModalOpen(true);
  };

  const beginEditList = (list: ContactList) => {
    setEditingListId(list.id);
    setEditingListName(list.name);
  };

  const saveListName = async () => {
    if (!editingListId) return;
    if (!editingListName.trim()) {
      toast.error('Informe um nome para a lista.');
      return;
    }
    try {
      await updateContactList(editingListId, { name: editingListName.trim(), lastUpdated: new Date().toISOString() });
      toast.success('Nome da lista atualizado.');
      setEditingListId(null);
      setEditingListName('');
    } catch {
      toast.error('N�o foi poss�vel atualizar a lista.');
    }
  };

  const handleAddSelectionToList = async () => {
    if (!addToListSelectId) {
      toast.error('Escolha uma lista.');
      return;
    }
    const list = contactLists.find((l) => l.id === addToListSelectId);
    if (!list) {
      toast.error('Lista nao encontrada.');
      return;
    }
    const validIds = selectedIds.filter((id) => {
      const c = contacts.find((x) => x.id === id);
      return Boolean(c && (c.phone || '').replace(/\D/g, '').length >= 10);
    });
    if (validIds.length === 0) {
      toast.error('Selecione ao menos um contato com telefone valido.');
      return;
    }
    const nextIds = mergeContactsIntoListIds(list.contactIds || [], validIds, contacts);
    const added = nextIds.length - (list.contactIds?.length || 0);
    if (added === 0) {
      toast.error('Nenhum contato novo para incluir (jÃ¡ estÃ£o na lista ou invÃ¡lidos).');
      return;
    }
    try {
      await updateContactList(addToListSelectId, {
        contactIds: nextIds,
        lastUpdated: new Date().toISOString()
      });
      toast.success(`${added} contato(s) incluido(s) em "${list.name}".`);
      setSelectedIds([]);
    } catch {
      toast.error('N�o foi poss�vel atualizar a lista.');
    }
  };

  const handleRemoveContactFromList = async (listId: string, contact: Contact) => {
    const list = contactLists.find((l) => l.id === listId);
    if (!list) return;
    if (!listHasContact(list.contactIds || [], contact)) {
      toast.error('Este contato nao esta nesta lista.');
      return;
    }
    if (!window.confirm(`Remover "${contact.name}" apenas da lista "${list.name}"?`)) return;
    const nextIds = stripContactIdsFromList(list.contactIds || [], contact);
    try {
      await updateContactList(listId, {
        contactIds: nextIds,
        lastUpdated: new Date().toISOString()
      });
      toast.success('Contato removido da lista.');
    } catch {
      toast.error('N�o foi poss�vel atualizar a lista.');
    }
  };

  const handleAddIdsToList = async (listId: string, ids: string[]) => {
    const list = contactLists.find((l) => l.id === listId);
    if (!list) {
      toast.error('Lista nao encontrada.');
      return;
    }
    const validIds = ids.filter((id) => {
      const c = contacts.find((x) => x.id === id);
      return Boolean(c && (c.phone || '').replace(/\D/g, '').length >= 10);
    });
    if (validIds.length === 0) {
      toast.error('Nenhum contato valido selecionado.');
      return;
    }
    const nextIds = mergeContactsIntoListIds(list.contactIds || [], validIds, contacts);
    const added = nextIds.length - (list.contactIds?.length || 0);
    if (added === 0) {
      toast.error('Nenhum contato novo para incluir (jÃ¡ estÃ£o na lista ou invÃ¡lidos).');
      return;
    }
    try {
      await updateContactList(listId, {
        contactIds: nextIds,
        lastUpdated: new Date().toISOString()
      });
      toast.success(`${added} contato(s) incluido(s) em "${list.name}".`);
      setListAddSelectedIds([]);
    } catch {
      toast.error('N�o foi poss�vel atualizar a lista.');
    }
  };

  const contactMatchesQuickSearch = (c: Contact, q: string): boolean => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      c.name.toLowerCase().includes(t) ||
      (c.phone || '').includes(t) ||
      (c.city || '').toLowerCase().includes(t) ||
      (c.church || '').toLowerCase().includes(t)
    );
  };

  const handleDownloadTemplate = () => {
    const headers = TEMPLATE_COLUMNS.map(c => c.label);
    const exampleRows = [
      ['Maria Silva', '5511999998888', '1990-03-15', 'maria@exemplo.com', 'Av. Paulista', '1578', 'Bela Vista', 'Sao Paulo', 'SP', '01310-200', 'Batista Lagoinha', 'Lider de Celula', 'Dentista', 'VIP;Novos', ''],
      ['Joao Santos', '5521988887777', '', 'joao@exemplo.com', 'Rua das Flores', '42', 'Copacabana', 'Rio de Janeiro', 'RJ', '22010-000', '', 'Membro', 'Professor', '', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
    ws['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: c.width }));

    // Marca a celula de cabecalho em negrito (ref: SheetJS nao aplica estilos na community,
    // mas a primeira linha ja funciona como cabecalho ao abrir no Excel).
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');

    // Aba com instrucoes
    const notes = [
      ['INSTRUCOES DE IMPORTACAO'],
      [''],
      ['1. Mantenha a primeira linha com os nomes das colunas exatamente como esta.'],
      ['2. Os campos Nome e Telefone sao obrigatorios.'],
      ['3. Telefone pode estar com ou sem DDI. Se vier sem 55, o sistema adiciona automaticamente.'],
      ['4. Aniversario: use o formato AAAA-MM-DD (ex: 1990-03-15) OU DD/MM/AAAA.'],
      ['5. CEP: com ou sem hifen (00000-000 ou 00000000).'],
      ['6. UF: sigla de 2 letras (SP, RJ, MG...).'],
      ['7. Tags: separadas por ponto e virgula (Ex: VIP;Novos;Cliente).'],
      ['8. Campos vazios sao permitidos, basta deixar a celula em branco.']
    ];
    const wsNotes = XLSX.utils.aoa_to_sheet(notes);
    wsNotes['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsNotes, 'Instrucoes');

    XLSX.writeFile(wb, 'modelo_importacao_zapmass.xlsx');
    toast.success('Modelo XLSX baixado. Cada campo e uma coluna propria.');
  };

  const handleExport = () => {
    const header = TEMPLATE_COLUMNS.map(c => c.label);
    const rows = contacts.map(c => TEMPLATE_COLUMNS.map(col => {
      if (col.key === 'tags') return (c.tags || []).join(';');
      if (col.key === 'status') return c.status;
      const v = (c as any)[col.key];
      return v == null ? '' : String(v);
    }));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: c.width }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');
    XLSX.writeFile(wb, `base_contatos_zapmass_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exportados ${contacts.length} contatos em XLSX.`);
  };

  const attachContactsToList = useCallback(async (
    contactIds: string[],
    mode: ImportTargetMode,
    selectedListId: string,
    newListName: string,
    originLabel: string
  ): Promise<{ attached: number; listName?: string }> => {
    if (contactIds.length === 0 || mode === 'none') return { attached: 0 };
    if (mode === 'existing') {
      const target = contactLists.find((l) => l.id === selectedListId);
      if (!target) throw new Error('Lista selecionada não encontrada.');
      const nextIds = Array.from(new Set([...(target.contactIds || []), ...contactIds]));
      await updateContactList(target.id, {
        contactIds: nextIds,
        notes: `${target.notes || ''}\nAtualizada por ${originLabel} em ${new Date().toLocaleString()}`.trim()
      });
      return { attached: contactIds.length, listName: target.name };
    }
    const listName = newListName.trim();
    if (!listName) throw new Error('Informe o nome da nova lista.');
    await createContactList(listName, contactIds, `Lista criada por ${originLabel} com ${contactIds.length} contato(s).`);
    return { attached: contactIds.length, listName };
  }, [contactLists, createContactList, updateContactList]);

  const normalizeImportRow = (row: FileImportRow): FileImportRow => {
    const normalizedPhone = normalizeBRPhone(row.contact.phone || '');
    const normalizedContact: Contact = {
      ...row.contact,
      name: (row.contact.name || '').trim(),
      phone: normalizedPhone,
      state: (row.contact.state || '').toUpperCase().slice(0, 2)
    };
    const problems: string[] = [];
    if (!normalizedContact.name) problems.push('Nome ausente');
    const digits = (normalizedPhone || '').replace(/\D/g, '');
    if (!digits) problems.push('Telefone ausente');
    else if (digits.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');
    return {
      ...row,
      contact: normalizedContact,
      include: problems.length === 0,
      problems
    };
  };

  const autoFixFileImportRows = () => {
    setFileImportRows((prev) => prev.map((row) => normalizeImportRow(row)));
  };

  const handleSaveNewContact = async () => {
    if (!newContact.name || !newContact.phone) {
      alert('Por favor, preencha ao menos Nome e Telefone.');
      return;
    }
    const cleanPhone = (newContact.phone || '').replace(/\D/g, '');
    if (newContactTargetMode === 'existing' && !newContactTargetListId) {
      toast.error('Escolha uma lista de destino.');
      return;
    }
    if (newContactTargetMode === 'new' && !newContactNewListName.trim()) {
      toast.error('Informe o nome da nova lista.');
      return;
    }

    if (editingContactId) {
      await updateContact(editingContactId, {
        name: newContact.name || 'Sem Nome',
        phone: cleanPhone,
        city: newContact.city || '',
        state: newContact.state || '',
        street: newContact.street || '',
        number: newContact.number || '',
        neighborhood: newContact.neighborhood || '',
        zipCode: newContact.zipCode || '',
        church: newContact.church || '',
        role: newContact.role || '',
        profession: newContact.profession || '',
        birthday: newContact.birthday || '',
        email: newContact.email || '',
        notes: newContact.notes || '',
        status: cleanPhone.length >= 10 ? 'VALID' : 'INVALID'
      });
      if (newContactTargetMode !== 'none') {
        await attachContactsToList(
          [editingContactId],
          newContactTargetMode,
          newContactTargetListId,
          newContactNewListName,
          'edição de contato'
        );
      }
    } else {
      const incomingContact: Contact = {
        id: Date.now().toString(),
        name: newContact.name || 'Sem Nome',
        phone: cleanPhone,
        city: newContact.city,
        state: newContact.state,
        street: newContact.street,
        number: newContact.number,
        neighborhood: newContact.neighborhood,
        zipCode: newContact.zipCode,
        church: newContact.church,
        role: newContact.role,
        profession: newContact.profession,
        birthday: newContact.birthday,
        email: newContact.email,
        notes: newContact.notes,
        tags: ['Novo'],
        status: cleanPhone.length >= 10 ? 'VALID' : 'INVALID',
        lastMsg: 'Nunca'
      };
      const existingByPhone = contactByPhoneKey.get(normPhoneKey(cleanPhone));
      let targetContactId = '';
      if (existingByPhone) {
        await updateContact(
          existingByPhone.id,
          mergeContactData(existingByPhone, incomingContact, ['Novo'])
        );
        targetContactId = existingByPhone.id;
        toast.success('Contato já existia e foi unificado com os novos dados.');
      } else {
        const createdId = await addContact(incomingContact);
        if (typeof createdId === 'string' && createdId) targetContactId = createdId;
      }
      if (targetContactId && newContactTargetMode !== 'none') {
        await attachContactsToList(
          [targetContactId],
          newContactTargetMode,
          newContactTargetListId,
          newContactNewListName,
          'novo contato'
        );
      }
    }

    setIsModalOpen(false);
    setEditingContactId(null);
    setNewContactTargetMode('none');
    setNewContactTargetListId('');
    setNewContactNewListName('');
    setNewContact({ name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '', church: '', role: '', profession: '', birthday: '', email: '', notes: '' });
  };

  const managedListForView = useMemo(
    () => (listManageId ? contactLists.find((l) => l.id === listManageId) ?? null : null),
    [contactLists, listManageId]
  );

  const manageListMembers = useMemo(() => {
    const list = managedListForView;
    if (!list?.contactIds) return [] as Contact[];
    return contacts
      .filter((c) => listHasContact(list.contactIds, c))
      .filter((c) => contactMatchesQuickSearch(c, listMemberSearch))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, managedListForView, listMemberSearch]);

  const manageListAddPool = useMemo(() => {
    const list = managedListForView;
    if (!list) return [] as Contact[];
    return contacts
      .filter((c) => (c.phone || '').replace(/\D/g, '').length >= 10)
      .filter((c) => !listHasContact(list.contactIds || [], c))
      .filter((c) => contactMatchesQuickSearch(c, listAddSearch))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, managedListForView, listAddSearch]);

  const handleExportManagedListAs = useCallback(
    (fmt: 'xlsx' | 'vcf') => {
      const list = managedListForView;
      if (!list?.contactIds?.length) {
        toast.error('Lista vazia.');
        return;
      }
      const withPhone = contacts.filter(
        (c) => listHasContact(list.contactIds || [], c) && (c.phone || '').replace(/\D/g, '').length >= 10
      );
      if (withPhone.length === 0) {
        toast.error('Nenhum contato válido com telefone nesta lista.');
        return;
      }
      const slug = list.name.replace(/[^\wÀ-ỹ\s\-]/gi, '').trim().replace(/\s+/g, '_').slice(0, 48) || 'lista';
      const day = new Date().toISOString().slice(0, 10);
      if (fmt === 'xlsx') {
        const header = TEMPLATE_COLUMNS.map((c) => c.label);
        const rows = withPhone.map((c) =>
          TEMPLATE_COLUMNS.map((col) => {
            if (col.key === 'tags') return (c.tags || []).join(';');
            if (col.key === 'status') return c.status;
            const v = (c as Record<string, unknown>)[col.key];
            return v == null ? '' : String(v);
          })
        );
        const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
        ws['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: c.width }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Lista');
        XLSX.writeFile(wb, `lista_${slug}_${day}.xlsx`);
        toast.success(`${withPhone.length} contato(s) exportado(s) (XLSX).`);
        return;
      }
      const vcf = contactsToVcfString(withPhone);
      const blob = new Blob(['\ufeff', vcf], { type: 'text/vcard;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lista_${slug}_${day}.vcf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${withPhone.length} contato(s) exportado(s) (vCard).`);
    },
    [managedListForView, contacts]
  );

  const allAddPoolSelected =
    manageListAddPool.length > 0 && manageListAddPool.every((c) => listAddSelectedIds.includes(c.id));

  const toggleListAddSelect = (id: string) => {
    setListAddSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleListAddSelectAll = () => {
    setListAddSelectedIds((prev) => {
      if (allAddPoolSelected) return prev.filter((id) => !manageListAddPool.some((c) => c.id === id));
      const set = new Set(prev);
      manageListAddPool.forEach((c) => set.add(c.id));
      return Array.from(set);
    });
  };

  const openNewContactModal = useCallback(() => {
                setEditingContactId(null);
                setNewContact({ name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '', church: '', role: '', profession: '', birthday: '', email: '', notes: '' });
                setNewContactTargetMode('none');
                setNewContactTargetListId('');
                setNewContactNewListName('');
                setIsModalOpen(true);
  }, []);
  const openSmartImport = useCallback(() => {
    setSmartImportRaw('');
    setSmartImportRows([]);
    setSmartImportTargetMode('none');
    setSmartImportTargetListId('');
    setSmartImportNewListName('');
    setSmartImportOpen(true);
  }, []);
  const openImportXLSX = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const openImportVcf = useCallback(() => {
    vcfInputRef.current?.click();
  }, []);

  // Converte os smartSegments existentes para o formato do painel (mapeia 'red' → 'rose').
  const segmentsForPanel = useMemo(() => smartSegments.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon as unknown as import('lucide-react').LucideIcon,
    color: (s.color === 'red' ? 'rose' : s.color) as 'rose' | 'amber' | 'sky' | 'emerald' | 'violet' | 'slate',
    hint: s.hint,
    count: s.count
  })), [smartSegments]);

  const getSegmentMatchList = useCallback((segId: string): Contact[] =>
    contacts.filter((c) => getSmartSegmentMatches(segId as SmartSegmentId, c)),
  // getSmartSegmentMatches é definido inline no mesmo escopo; conteúdo estável a menos que contacts/contactTemps mudem.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [contacts, contactTemps]);

  const handleSegmentApplyFilter = useCallback((segId: string) => {
    // Mapeia os segmentos do modal de Insights para filtros da nova sidebar.
    const map: Record<string, SmartFilterId> = {
      'birthday-week': 'bday_week',
      'hot-inactive': 'hot',
      'cold-reactivation': 'cold',
      'no-tag': 'all',
      'no-address': 'no_address',
      'duplicates': 'duplicates',
      'invalid': 'invalid',
      'last-7-days': 'all'
    };
    setActiveFilter(map[segId] || 'all');
    setCurrentPage(1);
  }, []);

  const buildDraftFromContacts = useCallback((people: Contact[], nameBase: string): CampaignWizardDraft | null => {
    const validPhones = people
      .map((c) => (c.phone || '').replace(/\D/g, ''))
      .filter((p) => p.length >= 10);
    if (validPhones.length === 0) return null;
    const draft = emptyCampaignDraft();
    draft.sendMode = 'manual';
    draft.manualNumbers = validPhones.join('\n');
    draft.name = nameBase;
    return draft;
  }, []);

  const handleSegmentCreateCampaign = useCallback((matches: Contact[], segmentLabel: string) => {
    const draft = buildDraftFromContacts(matches, `Segmento: ${segmentLabel}`);
    if (!draft) { toast.error('Este segmento não tem contatos com telefone válido.'); return; }
    launchCampaignWithDraft(draft, `Abrindo campanha para "${segmentLabel}"…`);
  }, [buildDraftFromContacts, launchCampaignWithDraft]);

  const handleBirthdayCampaign = useCallback((people: Contact[]) => {
    const name = people.length === 1 ? `Aniversário: ${people[0].name}` : `Aniversariantes (${people.length})`;
    const draft = buildDraftFromContacts(people, name);
    if (!draft) { toast.error('Sem telefones válidos nestes aniversariantes.'); return; }
    launchCampaignWithDraft(draft, 'Abrindo campanha de aniversário…');
  }, [buildDraftFromContacts, launchCampaignWithDraft]);

  const handleCreateCampaignWithFiltered = useCallback(() => {
    const draft = buildDraftFromContacts(filteredContacts, `Campanha (${filteredContacts.length} contatos)`);
    if (!draft) { toast.error('Nenhum contato no filtro atual.'); return; }
    launchCampaignWithDraft(draft);
  }, [buildDraftFromContacts, launchCampaignWithDraft, filteredContacts]);

  /** Contadores para a sidebar (memoizado — recalcula só quando a base ou temps mudam). */
  const sidebarCounts: SidebarCounts = useMemo(() => ({
    all: contacts.length,
    hot: smartStats.hot,
    warm: smartStats.warm,
    cold: smartStats.cold,
    new: smartStats.newOnes,
    bday_today: smartStats.bdayToday,
    bday_week: smartStats.bdayWeek,
    dormant: smartStats.dormant,
    invalid: smartStats.invalid,
    no_address: contacts.filter((c) => !c.street || !c.city || !c.zipCode).length,
    duplicates: smartStats.duplicates
  }), [contacts, smartStats]);

  /** Stats enxutas para o HeaderBar (sem sparklines, sem grids pesados). */
  const headerStats = useMemo(() => ({
    total: smartStats.total,
    valid: validCount,
    newLast7: smartStats.last7,
    hot: smartStats.hot,
    bdayToday: smartStats.bdayToday
  }), [smartStats, validCount]);

  /** Contato em destaque (drawer) — tempStats equivalente. */
  const selectedContactTemps = selectedContact ? contactTemps[selectedContact.id] : undefined;

  const handleCreateListQuick = useCallback(async (name: string) => {
    try {
      await createContactList(name, []);
      toast.success(`Lista "${name}" criada.`);
    } catch {
      toast.error('Não foi possível criar a lista.');
    }
  }, [createContactList]);

  const handleManageList = useCallback((listId: string) => {
    setListManageId(listId);
  }, []);

  const handleRowClick = useCallback((c: Contact) => {
    setSelectedContact(c);
  }, []);

  const handleToggleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const handleToggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const visible = filteredContacts.map((c) => c.id);
      const allSelected = visible.length > 0 && visible.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !visible.includes(id));
      const union = new Set([...prev, ...visible]);
      return Array.from(union);
    });
  }, [filteredContacts]);

  const handleBulkAddToList = useCallback(async () => {
    if (contactLists.length === 0) {
      toast.error('Crie uma lista primeiro na sidebar.');
      return;
    }
    const names = contactLists.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
    const resp = window.prompt(`Em qual lista adicionar ${selectedIds.length} contato(s)?\n\n${names}\n\nDigite o número:`);
    const idx = resp ? parseInt(resp, 10) - 1 : -1;
    const target = contactLists[idx];
    if (!target) { toast.error('Lista inválida.'); return; }
    const merged = Array.from(new Set([...(target.contactIds || []), ...selectedIds]));
    try {
      await updateContactList(target.id, { contactIds: merged });
      toast.success(`${selectedIds.length} contato(s) adicionado(s) a "${target.name}".`);
    } catch {
      toast.error('Não foi possível atualizar a lista.');
    }
  }, [selectedIds, contactLists, updateContactList]);

  const handleAddSingleToList = useCallback(async (c: Contact) => {
    if (contactLists.length === 0) { toast.error('Crie uma lista primeiro.'); return; }
    const names = contactLists.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
    const resp = window.prompt(`Em qual lista adicionar ${c.name}?\n\n${names}\n\nDigite o número:`);
    const idx = resp ? parseInt(resp, 10) - 1 : -1;
    const target = contactLists[idx];
    if (!target) { toast.error('Lista inválida.'); return; }
    if ((target.contactIds || []).includes(c.id)) {
      toast('Contato já está nessa lista.', { icon: 'ℹ️' });
      return;
    }
    try {
      await updateContactList(target.id, { contactIds: [...(target.contactIds || []), c.id] });
      toast.success(`${c.name} adicionado a "${target.name}".`);
    } catch {
      toast.error('Não foi possível atualizar a lista.');
    }
  }, [contactLists, updateContactList]);

  const handleDeleteFromDrawer = useCallback(async (c: Contact) => {
    if (!window.confirm(`Remover ${c.name || 'este contato'}?`)) return;
    await removeContact(c.id);
    setSelectedContact(null);
    toast.success('Contato removido.');
  }, [removeContact]);

  const openInsights = useCallback(() => setInsightsOpen(true), []);
  const closeInsights = useCallback(() => setInsightsOpen(false), []);
  const closeDrawer = useCallback(() => setSelectedContact(null), []);
  const clearBulkSelection = useCallback(() => setSelectedIds([]), []);

  return (
    <div className="space-y-5 pb-10 relative">
      {/* input file escondido, usado pelos botões do hero/tabela */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={handleImportCSV}
            />
            <input
              ref={vcfInputRef}
              type="file"
              accept=".vcf,.vcard,text/vcard,text/x-vcard,text/directory"
              className="hidden"
              onChange={handleImportVcf}
            />

      {!listManageId && (
        <ContactsHeaderBar
          stats={headerStats}
          onNewContact={openNewContactModal}
          onImportXLSX={openImportXLSX}
          onImportVcf={openImportVcf}
          onSmartImport={openSmartImport}
          onDownloadTemplate={handleDownloadTemplate}
          onExport={handleExport}
          onOpenInsights={openInsights}
        />
      )}

      {listManageId && (
        <SectionHeader
          eyebrow={<><Users className="w-3 h-3" />Contatos</>}
          title="Gestão de lista"
          description="Administre os contatos vinculados a esta lista — edite, remova e adicione com facilidade."
          icon={<Users className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        />
      )}

      {listManageId && managedListForView ? (
        <div className="ui-card p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setListManageId(null);
                  setListAddSelectedIds([]);
                }}
                className="ui-btn shrink-0 flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                Voltar
              </button>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{managedListForView.name}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {(managedListForView.contactIds?.length || 0).toLocaleString()} contato
                  {(managedListForView.contactIds?.length || 0) !== 1 ? 's' : ''} na lista — o mesmo contato pode estar em várias listas sem duplicar na base.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 self-start">
              <button
                type="button"
                onClick={() => handleCreateCampaignWithList(managedListForView)}
                className="ui-btn-primary whitespace-nowrap text-xs"
                title="Abrir wizard de campanha com esta lista"
              >
                <Rocket className="w-3.5 h-3.5" />
                Criar campanha
              </button>
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleExportManagedListAs('xlsx')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-slate-700 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700"
                  title="Planilha com os mesmos campos do modelo (mensagens / mail merge)"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600" />
                  XLSX
                </button>
                <button
                  type="button"
                  onClick={() => handleExportManagedListAs('vcf')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/30 text-slate-700 dark:text-slate-200"
                  title="vCard para agenda do telefone (mais pessoal)"
                >
                  <Smartphone className="w-3.5 h-3.5 text-sky-600" />
                  vCard
                </button>
              </div>
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setListManageSubTab('members')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  listManageSubTab === 'members'
                    ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Na lista
              </button>
              <button
                type="button"
                onClick={() => {
                  setListManageSubTab('add');
                  setListAddSelectedIds([]);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  listManageSubTab === 'add'
                    ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Adicionar
              </button>
            </div>
            </div>
          </div>

          {listManageSubTab === 'members' ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={listMemberSearch}
                  onChange={(e) => setListMemberSearch(e.target.value)}
                  placeholder="Filtrar por nome, telefone, cidade..."
                  className="ui-input pl-9 w-full max-w-md"
                />
              </div>
              <div className="max-h-[min(60vh,520px)] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {manageListMembers.length === 0 ? (
                  <p className="p-6 text-sm text-slate-400">Nenhum contato nesta busca ou lista vazia.</p>
                ) : (
                  manageListMembers.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <button
                        type="button"
                        onClick={() => beginEditContact(c)}
                        className="min-w-0 flex-1 text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors"
                        title="Ver e editar dados do contato"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{c.name}</p>
                        <p className="text-xs text-slate-500 font-mono truncate">{c.phone}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveContactFromList(listManageId, c)}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50 hover:opacity-90"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        Remover
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={listAddSearch}
                    onChange={(e) => setListAddSearch(e.target.value)}
                    placeholder="Buscar na base para adicionar..."
                    className="ui-input pl-9 w-full"
                  />
                </div>
                <button
                  type="button"
                  disabled={listAddSelectedIds.length === 0}
                  onClick={() => void handleAddIdsToList(listManageId, listAddSelectedIds)}
                  className="ui-btn-primary whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <UserPlus className="w-4 h-4" />
                  Incluir {listAddSelectedIds.length > 0 ? `(${listAddSelectedIds.length})` : ''}
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button type="button" onClick={toggleListAddSelectAll} className="font-bold text-emerald-600 hover:underline">
                  {allAddPoolSelected ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
                </button>
                <span>·</span>
                <span>{manageListAddPool.length} disponíveis (fora da lista)</span>
              </div>
              <div className="max-h-[min(55vh,480px)] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {manageListAddPool.length === 0 ? (
                  <p className="p-6 text-sm text-slate-400">Todos os contatos validos ja estao nesta lista ou nada encontrado na busca.</p>
                ) : (
                  manageListAddPool.map((c) => {
                    const sel = listAddSelectedIds.includes(c.id);
                    return (
                      <div
                        key={c.id}
                        className={`w-full flex items-center gap-2 sm:gap-3 px-3 py-2.5 transition-colors ${
                          sel ? 'bg-emerald-50/80 dark:bg-emerald-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <button
                          type="button"
                          aria-label={sel ? 'Desmarcar contato' : 'Selecionar contato'}
                          onClick={() => toggleListAddSelect(c.id)}
                          className="shrink-0 p-1 rounded-md text-slate-400 hover:bg-slate-200/80 dark:hover:bg-slate-600/40"
                        >
                          {sel ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => beginEditContact(c)}
                          className="min-w-0 flex-1 text-left rounded-lg py-0.5 -mr-1 pr-1 hover:bg-slate-100/80 dark:hover:bg-slate-700/40 transition-colors"
                          title="Ver e editar dados do contato"
                        >
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{c.name}</p>
                          <p className="text-xs text-slate-500 font-mono truncate">{c.phone}</p>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
      <>
      {/* ========================================================
           NOVO LAYOUT: WORKSPACE (sidebar + tabela virtualizada)
         ======================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <ContactsSidebar
          active={activeFilter}
          onChange={(id) => { setActiveFilter(id); setSelectedIds([]); }}
          counts={sidebarCounts}
          lists={contactLists}
          onCreateList={(name) => void handleCreateListQuick(name)}
          onManageList={handleManageList}
          onDeleteList={(id, name) => void handleDeleteList(id, name)}
          query={searchTerm}
          onQueryChange={setSearchTerm}
        />
        <div className="flex flex-col gap-3 min-w-0">
          <ContactsTableVirtual
            rows={filteredContacts}
            contactTemps={contactTemps}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelectOne}
            onToggleSelectAll={handleToggleSelectAllVisible}
            onRowClick={handleRowClick}
            onEdit={beginEditContact}
            onDelete={(c) => handleDelete(c.id)}
            onOpenChat={openInChat}
            onCreateCampaign={handleCreateCampaignForContact}
            onCopyPhone={handleCopyPhone}
            onAddToList={handleAddSingleToList}
            selectedContactId={selectedContact?.id || null}
            emptyHint={
              searchTerm
                ? <>Nenhum contato casa com "<b>{searchTerm}</b>".</>
                : activeFilter === 'all'
                  ? 'Sua base está vazia. Importe ou crie um contato.'
                  : 'Ajuste o filtro na lateral ou tente outra busca.'
            }
          />
          </div>
      </div>
      <ContactsBulkBar
        count={selectedIds.length}
        onClear={clearBulkSelection}
        onCreateCampaign={handleCreateCampaignWithSelection}
        onAddToList={handleBulkAddToList}
        onAddTag={() => void handleBulkAddTag()}
        onExport={handleBulkExport}
        onDelete={() => void handleBulkDelete()}
      />

      </>
      )}

      {/* Drawer lateral de detalhe do contato */}
      <ContactDetailDrawer
        contact={selectedContact}
        tempStats={selectedContactTemps}
        onClose={closeDrawer}
        onEdit={(c) => { setSelectedContact(null); beginEditContact(c); }}
        onDelete={handleDeleteFromDrawer}
        onOpenChat={(c) => { setSelectedContact(null); openInChat(c); }}
        onCreateCampaign={(c) => { setSelectedContact(null); handleCreateCampaignForContact(c); }}
        onCopyPhone={handleCopyPhone}
        onAddToList={handleAddSingleToList}
      />

      {/* Modal de Insights (lazy — só carrega ao abrir) */}
      <ContactsInsightsModal
        open={insightsOpen}
        onClose={closeInsights}
        contacts={contacts}
        contactTemps={contactTemps}
        segments={segmentsForPanel}
        getSegmentMatches={getSegmentMatchList}
        onOpenChat={openInChat}
        onCreateCampaignFiltered={handleCreateCampaignWithFiltered}
        onApplyFilterOnBase={handleSegmentApplyFilter}
        onSegmentCampaign={handleSegmentCreateCampaign}
        onBirthdayCampaign={handleBirthdayCampaign}
      />
      
      {/* ... Modal Code (unchanged logic, just inside this updated component) ... */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
           <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xl animate-in fade-in zoom-in duration-200 flex flex-col my-auto border border-slate-200 dark:border-slate-800">
              
              {/* Modal Header */}
              <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-2xl">
                 <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                       <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center">
                          <UserPlus className="w-5 h-5" />
                       </div>
                       {editingContactId ? 'Editar Contato' : 'Novo Contato'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5 ml-10">
                      {editingContactId ? 'Atualize os dados e salve as alteraÃ§Ãµes.' : 'Preencha os dados abaixo para cadastrar manualmente.'}
                    </p>
                 </div>
                 <button onClick={() => { setIsModalOpen(false); setEditingContactId(null); setNewContactTargetMode('none'); setNewContactTargetListId(''); setNewContactNewListName(''); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 p-1.5 rounded-full transition-colors">
                    <X className="w-5 h-5" />
                 </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh]">
                 
                 {/* Section: Personal Info */}
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <User className="w-3.5 h-3.5" /> Dados Pessoais
                    </h4>
                    <div className="space-y-4">
                       <div>
                          <label htmlFor="newContactName" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Nome Completo <span className="text-red-500">*</span></label>
                          <div className="relative">
                             <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                             <input 
                               id="newContactName"
                               name="newContactName"
                               type="text" 
                               value={newContact.name}
                               onChange={e => setNewContact({...newContact, name: e.target.value})}
                               className="ui-input pl-10"
                               placeholder="Ex: João da Silva"
                               autoFocus
                             />
                          </div>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div>
                             <label htmlFor="newContactPhone" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">WhatsApp <span className="text-red-500">*</span></label>
                             <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input 
                                  id="newContactPhone"
                                  name="newContactPhone"
                                  type="text" 
                                  value={newContact.phone}
                                  onChange={e => setNewContact({...newContact, phone: e.target.value})}
                                  className="ui-input pl-10"
                                  placeholder="Ex: 11 99999-9999"
                                />
                             </div>
                          </div>
                          <div>
                             <label htmlFor="newContactCity" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Cidade / UF</label>
                             <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input 
                                  id="newContactCity"
                                  name="newContactCity"
                                  type="text" 
                                  list="contact-city-suggestions"
                                  value={newContact.city}
                                  onChange={e => setNewContact({...newContact, city: e.target.value})}
                                  className="ui-input pl-10"
                                  placeholder="Ex: São Paulo - SP"
                                  autoComplete="off"
                                />
                                <datalist id="contact-city-suggestions">
                                  {citySuggestions.map(c => (
                                    <option key={c} value={c} />
                                  ))}
                                </datalist>
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>

                 {/* Divider */}
                 <div className="border-t border-slate-100 dark:border-slate-800"></div>

                 {/* Section: EndereÃ§o */}
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <Home className="w-3.5 h-3.5" /> EndereÃ§o
                    </h4>

                    <div className="bg-amber-50/40 p-4 rounded-xl border border-amber-100/50 space-y-4">
                       <div className="grid grid-cols-12 gap-3">
                          <div className="col-span-12 md:col-span-8">
                             <label htmlFor="newContactStreet" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Rua / Logradouro</label>
                             <input
                               id="newContactStreet"
                               type="text"
                               value={newContact.street || ''}
                               onChange={e => setNewContact({...newContact, street: e.target.value})}
                               className="ui-input"
                               placeholder="Ex: Av. Paulista"
                             />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                             <label htmlFor="newContactNumber" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">NÃºmero</label>
                             <input
                               id="newContactNumber"
                               type="text"
                               value={newContact.number || ''}
                               onChange={e => setNewContact({...newContact, number: e.target.value})}
                               className="ui-input"
                               placeholder="1234"
                             />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                             <label htmlFor="newContactZipCode" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">CEP</label>
                             <input
                               id="newContactZipCode"
                               type="text"
                               inputMode="numeric"
                               value={newContact.zipCode || ''}
                               onChange={e => {
                                 const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                                 const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
                                 setNewContact({...newContact, zipCode: formatted});
                               }}
                               className="ui-input"
                               placeholder="00000-000"
                               maxLength={9}
                             />
                          </div>
                       </div>
                       <div className="grid grid-cols-12 gap-3">
                          <div className="col-span-12 md:col-span-10">
                             <label htmlFor="newContactNeighborhood" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Bairro</label>
                             <input
                               id="newContactNeighborhood"
                               type="text"
                               value={newContact.neighborhood || ''}
                               onChange={e => setNewContact({...newContact, neighborhood: e.target.value})}
                               className="ui-input"
                               placeholder="Ex: Jardins"
                             />
                          </div>
                          <div className="col-span-12 md:col-span-2">
                             <label htmlFor="newContactState" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">UF</label>
                             <input
                               id="newContactState"
                               type="text"
                               value={newContact.state || ''}
                               onChange={e => setNewContact({...newContact, state: e.target.value.toUpperCase().slice(0, 2)})}
                               className="ui-input uppercase"
                               placeholder="SP"
                               maxLength={2}
                             />
                          </div>
                       </div>
                    </div>
                 </div>

                 {/* Divider */}
                 <div className="border-t border-slate-100 dark:border-slate-800"></div>

                 {/* Section: Church Info */}
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <Church className="w-3.5 h-3.5" /> Dados Eclesiásticos
                    </h4>
                    
                    <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100/50 space-y-4">
                       <div>
                          <label htmlFor="newContactChurch" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Igreja / Congregação</label>
                          <div className="relative">
                             <Church className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600/60" />
                             <input 
                               id="newContactChurch"
                               name="newContactChurch"
                               type="text" 
                               list="contact-church-suggestions"
                               value={newContact.church}
                               onChange={e => setNewContact({...newContact, church: e.target.value})}
                               className="ui-input pl-10"
                               placeholder="Ex: Batista Lagoinha"
                               autoComplete="off"
                             />
                             <datalist id="contact-church-suggestions">
                               {churchSuggestions.map(ch => (
                                 <option key={ch} value={ch} />
                               ))}
                             </datalist>
                          </div>
                       </div>

                       <div>
                          <label htmlFor="newContactRole" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                            Cargo na Igreja
                            <span className="ml-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider">Digite ou escolha</span>
                          </label>
                          <div className="relative">
                             <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600/60" />
                             <input
                               id="newContactRole"
                               name="newContactRole"
                               type="text"
                               list="contact-role-suggestions"
                               value={newContact.role}
                               onChange={e => setNewContact({...newContact, role: e.target.value})}
                               className="ui-input pl-10"
                               placeholder="Ex: Lider de Celula, Diacono..."
                               autoComplete="off"
                             />
                             <datalist id="contact-role-suggestions">
                               {roleSuggestions.map(r => (
                                 <option key={r} value={r} />
                               ))}
                             </datalist>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            Pode digitar um cargo novo — ele vira sugestao da proxima vez.
                          </p>
                       </div>
                    </div>
                 </div>

                 {/* Divider */}
                 <div className="border-t border-slate-100 dark:border-slate-800"></div>

                 {/* Section: Professional Info */}
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <Briefcase className="w-3.5 h-3.5" /> Dados Profissionais
                    </h4>

                    <div className="bg-sky-50/50 p-4 rounded-xl border border-sky-100/50">
                       <div>
                          <label htmlFor="newContactProfession" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                            Cargo / Profissao
                            <span className="ml-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider">Digite livremente</span>
                          </label>
                          <div className="relative">
                             <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-600/60" />
                             <input
                               id="newContactProfession"
                               name="newContactProfession"
                               type="text"
                               list="contact-profession-suggestions"
                               value={newContact.profession || ''}
                               onChange={e => setNewContact({...newContact, profession: e.target.value})}
                               className="ui-input pl-10"
                               placeholder="Ex: Dentista, Professor(a), Advogado(a)..."
                               autoComplete="off"
                             />
                             <datalist id="contact-profession-suggestions">
                               {professionSuggestions.map(p => (
                                 <option key={p} value={p} />
                               ))}
                             </datalist>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {professionSuggestions.length > 0
                              ? `${professionSuggestions.length} profissao(oes) ja cadastrada(s) — comece a digitar para ver sugestoes.`
                              : 'Cada profissao nova que voce digitar vira sugestao para os proximos contatos.'}
                          </p>
                       </div>
                    </div>
                 </div>

                 {/* Divider */}
                 <div className="border-t border-slate-100 dark:border-slate-800"></div>

                 {/* Section: Additional Info */}
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <User className="w-3.5 h-3.5" /> Dados Adicionais
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                          <label htmlFor="newContactBirthday" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Aniversario</label>
                          <input
                            id="newContactBirthday"
                            name="newContactBirthday"
                            type="date"
                            value={newContact.birthday || ''}
                            onChange={e => setNewContact({ ...newContact, birthday: e.target.value })}
                            className="ui-input"
                          />
                       </div>

                       <div>
                          <label htmlFor="newContactEmail" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Email</label>
                          <input
                            id="newContactEmail"
                            name="newContactEmail"
                            type="email"
                            value={newContact.email || ''}
                            onChange={e => setNewContact({ ...newContact, email: e.target.value })}
                            className="ui-input"
                            placeholder="email@exemplo.com"
                          />
                       </div>
                    </div>

                    <div>
                       <label htmlFor="newContactNotes" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">ObservaÃ§Ãµes</label>
                       <textarea
                         id="newContactNotes"
                         name="newContactNotes"
                         value={newContact.notes || ''}
                         onChange={e => setNewContact({ ...newContact, notes: e.target.value })}
                         className="ui-input min-h-[80px] resize-y"
                         placeholder="Informacoes extras sobre o contato..."
                         rows={3}
                       />
                    </div>
                 </div>

                 <div className="border-t border-slate-100 dark:border-slate-800"></div>

                 <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5" /> Lista de destino
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {([
                        ['none', 'Sem lista'],
                        ['existing', 'Lista existente'],
                        ['new', 'Criar nova lista']
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setNewContactTargetMode(mode)}
                          className={`px-3 py-2 rounded-lg border text-xs font-semibold ${
                            newContactTargetMode === mode
                              ? 'brand-soft brand-text brand-border'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {newContactTargetMode === 'existing' && (
                      <select
                        className="ui-input"
                        value={newContactTargetListId}
                        onChange={(e) => setNewContactTargetListId(e.target.value)}
                      >
                        <option value="">Escolha uma lista</option>
                        {contactLists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.contactIds?.length || 0})
                          </option>
                        ))}
                      </select>
                    )}
                    {newContactTargetMode === 'new' && (
                      <input
                        type="text"
                        className="ui-input"
                        value={newContactNewListName}
                        onChange={(e) => setNewContactNewListName(e.target.value)}
                        placeholder="Nome da nova lista"
                      />
                    )}
                 </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 rounded-b-2xl flex justify-between items-center gap-4">
                 <button 
                    onClick={() => { setIsModalOpen(false); setEditingContactId(null); setNewContactTargetMode('none'); setNewContactTargetListId(''); setNewContactNewListName(''); }}
                    className="px-6 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                 >
                    Cancelar
                 </button>
                 <button 
                    onClick={handleSaveNewContact}
                    className="flex-1 px-6 py-2.5 text-sm font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 active:transform active:scale-95 transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2"
                 >
                    <Save className="w-4 h-4" /> {editingContactId ? 'Salvar Alteracoes' : 'Salvar Contato'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Revisao de importacao por arquivo (XLSX/CSV ou vCard): filtros, problemas, duplicados */}
      {fileImportOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-6 animate-fadeIn" onClick={() => setFileImportOpen(false)}>
          <div
            className="bg-white dark:bg-slate-900 w-full max-w-6xl rounded-2xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-violet-50 to-emerald-50 dark:from-violet-950/20 dark:to-emerald-950/20">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-white shadow flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-bold text-slate-900 dark:text-white truncate">Revisar importaÃ§Ã£o</h3>
                  <p className="text-[12px] text-slate-500 truncate">{fileImportLabel}</p>
                </div>
              </div>
              <button type="button" onClick={() => setFileImportOpen(false)} className="p-2 rounded-lg hover:bg-white/60 dark:hover:bg-slate-800 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px] font-bold uppercase text-slate-500 mr-1">Mostrar</span>
                {([
                  ['all', 'Todas', fileImportRowsView.length],
                  ['problem', 'Com problema', fileImportRowsView.filter(r => r.problems.length > 0 || r.duplicate).length],
                  ['duplicate', 'Duplicados', fileImportRowsView.filter(r => r.duplicate).length],
                  ['ready', 'Prontos', fileImportRowsView.filter(r => !r.duplicate && r.problems.length === 0).length]
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFileImportFilter(key as FileImportPreviewFilter)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                      fileImportFilter === key ? 'brand-soft brand-text brand-border' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label} <span className="opacity-60 tabular-nums">{count}</span>
                  </button>
                ))}
              </div>
              {fileImportTriageSummary.total > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 bg-white/80 dark:bg-slate-900/40">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase text-slate-500">No arquivo</p>
                    <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{fileImportTriageSummary.total}</p>
                    <p className="text-[10px] text-slate-500">linhas</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase text-rose-600">Já na base</p>
                    <p className="text-lg font-bold tabular-nums text-rose-700 dark:text-rose-400">{fileImportTriageSummary.againstBase}</p>
                    <p className="text-[10px] text-slate-500">número no CRM</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase text-amber-700">Repetido no arquivo</p>
                    <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">{fileImportTriageSummary.repeatedInFile}</p>
                    <p className="text-[10px] text-slate-500">2ª cópia em diante</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase text-violet-700">Só no arquivo</p>
                    <p className="text-lg font-bold tabular-nums text-violet-700 dark:text-violet-300">{fileImportTriageSummary.repeatedOnlyInFile}</p>
                    <p className="text-[10px] text-slate-500">repetido no arquivo (não no CRM)</p>
                  </div>
                  <div className="min-w-0 col-span-2 sm:col-span-1">
                    <p className="text-[10px] font-bold uppercase text-emerald-700">Novos no arquivo</p>
                    <p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{fileImportTriageSummary.newInFileReady}</p>
                    <p className="text-[10px] text-slate-500">primeira vez no arquivo e número novo no CRM</p>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Duplicado na base = telefone já no CRM (pode marcar a linha para unificar dados e vincular à lista, sem criar outro contato). Repetido no arquivo = segunda linha com o mesmo número neste ficheiro — não importa. Linhas com problema precisam correção.
              </p>
              <div className="flex items-center justify-end">
                <Button variant="ghost" size="sm" type="button" onClick={autoFixFileImportRows}>
                  Correção automática (todos)
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3 sm:p-4">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2">Linha</th>
                    <th className="px-2 py-2">Situacao</th>
                    <th className="px-2 py-2">Nome</th>
                    <th className="px-2 py-2">Telefone</th>
                    <th className="px-2 py-2 hidden lg:table-cell">Cidade</th>
                    <th className="px-2 py-2 hidden lg:table-cell">Igreja</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredFileImportRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                        Nenhuma linha neste filtro.
                      </td>
                    </tr>
                  ) : (
                    filteredFileImportRows.map(rv => {
                      const patch = (p: Partial<Contact>) =>
                        setFileImportRows(prev => prev.map(x => (x.id === rv.id ? { ...x, contact: { ...x.contact, ...p } } : x)));
                      const rowClass =
                        rv.duplicate ? 'bg-rose-50/50 dark:bg-rose-950/20' : rv.problems.length ? 'bg-amber-50/40 dark:bg-amber-950/10' : '';
                      return (
                        <tr key={rv.id} className={rowClass}>
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={rv.include}
                              disabled={rv.problems.length > 0 || rv.duplicateRepeatedInFile}
                              onChange={(e) =>
                                setFileImportRows((prev) =>
                                  prev.map((x) => (x.id === rv.id ? { ...x, include: e.target.checked } : x))
                                )
                              }
                              className="w-4 h-4 accent-emerald-500"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-slate-400 tabular-nums">{rv.lineNumber}</td>
                          <td className="px-2 py-1.5 max-w-[220px]">
                            {rv.duplicate ? (
                              <div className="flex flex-col gap-0.5">
                                {rv.duplicateAgainstBase && (
                                  <span className="text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                                    Na base{rv.duplicateName ? ` · ${rv.duplicateName}` : ''}
                                  </span>
                                )}
                                {rv.duplicateRepeatedInFile && (
                                  <span className="text-amber-700 dark:text-amber-300 font-semibold text-[11px]">
                                    Repetido no arquivo
                                  </span>
                                )}
                              </div>
                            ) : rv.problems.length ? (
                              <span className="text-amber-700 dark:text-amber-300 text-[11px]">{rv.problems.join(' · ')}</span>
                            ) : (
                              <span className="text-emerald-600 text-[11px] font-medium">OK</span>
                            )}
                          </td>
                          <td className="px-1 py-1.5">
                            <input
                              type="text"
                              value={rv.contact.name}
                              onChange={e => patch({ name: e.target.value })}
                              className="w-full min-w-[120px] px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent"
                            />
                          </td>
                          <td className="px-1 py-1.5">
                            <input
                              type="text"
                              value={rv.contact.phone}
                              onChange={e => patch({ phone: e.target.value.replace(/\D/g, '') })}
                              className="w-full min-w-[110px] px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent font-mono"
                            />
                          </td>
                          <td className="px-1 py-1.5 hidden lg:table-cell">
                            <input
                              type="text"
                              value={rv.contact.city || ''}
                              onChange={e => patch({ city: e.target.value })}
                              className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent"
                            />
                          </td>
                          <td className="px-1 py-1.5 hidden lg:table-cell">
                            <input
                              type="text"
                              value={rv.contact.church || ''}
                              onChange={e => patch({ church: e.target.value })}
                              className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3 bg-slate-50 dark:bg-slate-900/50">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-white dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Destino da importação</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    ['none', 'Importar sem lista'],
                    ['existing', 'Adicionar em lista existente'],
                    ['new', 'Criar nova lista com importados']
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFileImportTargetMode(mode)}
                      className={`px-3 py-2 rounded-lg border text-xs font-semibold ${
                        fileImportTargetMode === mode
                          ? 'brand-soft brand-text brand-border'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {fileImportTargetMode === 'existing' && (
                  <select className="ui-input" value={fileImportTargetListId} onChange={(e) => setFileImportTargetListId(e.target.value)}>
                    <option value="">Escolha uma lista</option>
                    {contactLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.contactIds?.length || 0})
                      </option>
                    ))}
                  </select>
                )}
                {fileImportTargetMode === 'new' && (
                  <input
                    type="text"
                    className="ui-input"
                    value={fileImportNewListName}
                    onChange={(e) => setFileImportNewListName(e.target.value)}
                    placeholder="Nome da nova lista"
                  />
                )}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                A importar:{' '}
                <b>
                  {
                    fileImportRowsView.filter(rv => rv.include && rv.problems.length === 0).length
                  }
                </b>{' '}
                de {fileImportRowsView.length} linha(s).
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" type="button" onClick={() => setFileImportOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  leftIcon={<Save className="w-4 h-4" />}
                  disabled={fileImportRowsView.filter(rv => rv.include && rv.problems.length === 0).length === 0}
                  onClick={async () => {
                    if (fileImportTargetMode === 'existing' && !fileImportTargetListId) {
                      toast.error('Escolha uma lista de destino.');
                      return;
                    }
                    if (fileImportTargetMode === 'new' && !fileImportNewListName.trim()) {
                      toast.error('Informe o nome da nova lista.');
                      return;
                    }
                    const localByKey = new Map<string, Contact>(contactByPhoneKey);
                    const touchedIds = new Set<string>();
                    let added = 0;
                    let merged = 0;
                    let skippedProb = 0;
                    for (const rv of fileImportRowsView) {
                      if (!rv.include) continue;
                      if (rv.problems.length > 0) {
                        skippedProb++;
                        continue;
                      }
                      const phone = normalizeBRPhone(rv.contact.phone);
                      const k = normPhoneKey(phone);
                      if (!k) {
                        skippedProb++;
                        continue;
                      }
                      const incoming: Contact = {
                        ...rv.contact,
                        id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                        name: rv.contact.name.trim() || 'Sem Nome',
                        phone,
                        status: phone.replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID',
                        tags: (rv.contact.tags || []).length > 0 ? rv.contact.tags : ['Importado']
                      };
                      const existing = localByKey.get(k);
                      if (existing) {
                        const mergedPayload = mergeContactData(existing, incoming, ['Importado']);
                        await updateContact(existing.id, mergedPayload);
                        const nextExisting: Contact = { ...existing, ...mergedPayload };
                        localByKey.set(k, nextExisting);
                        touchedIds.add(existing.id);
                        merged++;
                      } else {
                        const createdId = await addContact(incoming);
                        if (typeof createdId === 'string' && createdId) {
                          const createdContact: Contact = { ...incoming, id: createdId };
                          localByKey.set(k, createdContact);
                          touchedIds.add(createdId);
                          added++;
                        }
                      }
                    }
                    let attached = 0;
                    let listName = '';
                    const importIds = Array.from(touchedIds);
                    if (importIds.length > 0 && fileImportTargetMode !== 'none') {
                      const result = await attachContactsToList(
                        importIds,
                        fileImportTargetMode,
                        fileImportTargetListId,
                        fileImportNewListName,
                        'importação de arquivo'
                      );
                      attached = result.attached;
                      listName = result.listName || '';
                    }
                    toast.success(
                      `${added} contato(s) novo(s).` +
                        (merged ? ` ${merged} contato(s) unificado(s).` : '') +
                        (skippedProb ? ` ${skippedProb} com problema nao importado(s).` : '') +
                        (attached > 0 ? ` ${attached} vinculado(s) em "${listName}".` : '')
                    );
                    setFileImportOpen(false);
                    setFileImportRows([]);
                    setFileImportTargetMode('none');
                    setFileImportTargetListId('');
                    setFileImportNewListName('');
                  }}
                >
                  Confirmar importaÃ§Ã£o
                </Button>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SMART IMPORT MODAL: cola do Excel/Word, parser inteligente, preview editavel */}
      {smartImportOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-3 sm:p-6 animate-fadeIn"
          onClick={() => {
            setSmartImportOpen(false);
            setSmartImportPreviewFilter('all');
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 w-full max-w-6xl rounded-2xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/20 dark:to-emerald-950/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white shadow flex items-center justify-center">
                  <Wand2 className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">ImportaÃ§Ã£o inteligente</h3>
                  <p className="text-[12px] text-slate-500">Cole do Excel/Word/bloco-de-notas e o sistema organiza automaticamente.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSmartImportOpen(false);
                  setSmartImportPreviewFilter('all');
                }}
                className="p-2 rounded-lg hover:bg-white/60 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="rounded-xl border border-sky-100 dark:border-sky-900/40 bg-sky-50/60 dark:bg-sky-950/20 p-3 flex gap-2.5 items-start">
                <Info className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
                <div className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
                  <b>Dica:</b> no Excel selecione as celulas com Ctrl+C, depois cole aqui com Ctrl+V. O sistema detecta
                  automaticamente telefones, emails, CEP, datas, UF, cidade e separa cada campo. Se a primeira linha tiver
                  o nome das colunas (ex: <i>Nome, Telefone, Cidade</i>), o mapeamento fica ainda mais preciso.
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  <ClipboardPaste className="w-3.5 h-3.5 inline mr-1" />
                  Cole aqui o conteudo
                </label>
                <textarea
                  value={smartImportRaw}
                  onChange={(e) => setSmartImportRaw(e.target.value)}
                  className="ui-input min-h-[120px] font-mono text-[12px] leading-[1.6]"
                  placeholder={"Exemplos aceitos:\n\nJoao Silva\t5511988887777\tSao Paulo - SP\nMaria Souza\t21987654321\tmaria@email.com\n\nOu com cabecalho:\nNome\tTelefone\tCidade\tIgreja\tCargo\nJoao Silva\t11988887777\tSao Paulo\tLagoinha\tLider"}
                  style={{ whiteSpace: 'pre' }}
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[11px] text-slate-400">
                    {smartImportRaw.split('\n').filter(Boolean).length} linha(s) no texto
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSmartImportRaw('');
                        setSmartImportRows([]);
                        setSmartImportPreviewFilter('all');
                      }}
                    >
                      Limpar
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Sparkles className="w-4 h-4" />}
                      onClick={() => {
                        if (!smartImportRaw.trim()) {
                          toast.error('Cole algum conteudo primeiro.');
                          return;
                        }
                        const parsed = parseSmartText(smartImportRaw);
                        setSmartImportPreviewFilter('all');
                        setSmartImportRows(enrichSmartImportParsedForInclude(parsed, contacts));
                        if (parsed.length === 0) toast.error('Não consegui identificar contatos no texto.');
                        else toast.success(`${parsed.length} linha(s) analisada(s). Revise duplicados e avisos antes de importar.`);
                      }}
                    >
                      Analisar conteudo
                    </Button>
                  </div>
                </div>
              </div>

              {smartImportRows.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-wrap gap-1.5 items-center">
                    <span className="text-[11px] font-bold uppercase text-slate-500">Mostrar</span>
                    {([
                      ['all', 'Todas', smartImportRowsView.length],
                      ['problem', 'Com problema', smartImportRowsView.filter(r => (r.problems?.length || 0) > 0 || r.duplicate).length],
                      ['duplicate', 'Duplicados', smartImportRowsView.filter(r => r.duplicate).length],
                      ['ready', 'Prontos', smartImportRowsView.filter(r => !r.duplicate && (r.problems?.length || 0) === 0).length]
                    ] as const).map(([key, label, count]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSmartImportPreviewFilter(key as FileImportPreviewFilter)}
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                          smartImportPreviewFilter === key ? 'brand-soft brand-text brand-border' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                        }`}
                      >
                        {label} <span className="opacity-60 tabular-nums">{count}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3 text-[12px]">
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {smartImportRowsView.filter(rv => {
                          const base = smartImportRows.find(b => b.id === rv.id);
                          return base?.include && (rv.problems?.length || 0) === 0;
                        }).length}{' '}
                        pronto(s) para importar
                      </span>
                      <span className="text-slate-400">de {smartImportRows.length}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSmartImportRows((rows) =>
                            rows.map((r) => ({
                              ...r,
                              name: (r.name || '').trim(),
                              phone: normalizeBRPhone(r.phone || ''),
                              state: (r.state || '').toUpperCase().slice(0, 2)
                            }))
                          )
                        }
                      >
                        Correção automática (todos)
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSmartImportRows((prev) =>
                            prev.map((r) => {
                              const view = smartImportRowsView.find((v) => v.id === r.id);
                              if (
                                !view ||
                                (view.problems?.length || 0) > 0 ||
                                view.duplicateRepeatedInFile
                              ) {
                                return r;
                              }
                              return { ...r, include: true };
                            })
                          )
                        }
                      >
                        Marcar todos
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSmartImportRows(rows => rows.map(r => ({ ...r, include: false })))}>
                        Desmarcar todos
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[45vh] overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-slate-100/90 dark:bg-slate-800/90 backdrop-blur z-10">
                        <tr className="text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                          <th className="px-2 py-2 w-8"></th>
                          <th className="px-2 py-2 w-10">#</th>
                          <th className="px-2 py-2">Situacao</th>
                          <th className="px-2 py-2">Nome</th>
                          <th className="px-2 py-2">Telefone</th>
                          <th className="px-2 py-2">Email</th>
                          <th className="px-2 py-2">Cidade</th>
                          <th className="px-2 py-2">UF</th>
                          <th className="px-2 py-2">CEP</th>
                          <th className="px-2 py-2">Igreja</th>
                          <th className="px-2 py-2">Cargo</th>
                          <th className="px-2 py-2">Profissao</th>
                          <th className="px-2 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredSmartImportRows.length === 0 ? (
                          <tr>
                            <td colSpan={13} className="px-4 py-6 text-center text-slate-400">
                              Nenhuma linha neste filtro.
                            </td>
                          </tr>
                        ) : (
                          filteredSmartImportRows.map((rv, idx) => {
                            const base = smartImportRows.find(b => b.id === rv.id);
                            const include = base?.include ?? false;
                            const updateRow = (patch: Partial<SmartRow>) => {
                              setSmartImportRows(prev => prev.map(pr => (pr.id === rv.id ? { ...pr, ...patch } : pr)));
                            };
                            const probLen = rv.problems?.length || 0;
                            const dupBase = !!rv.duplicateAgainstBase;
                            const dupFile = !!rv.duplicateRepeatedInFile;
                            const rowClass = `${!include ? 'opacity-40' : ''} ${dupBase || dupFile ? 'bg-rose-50/40 dark:bg-rose-950/15' : probLen ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}`;
                            return (
                              <tr key={rv.id} className={rowClass}>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    checked={include}
                                    disabled={probLen > 0 || !!dupFile}
                                    onChange={(e) => updateRow({ include: e.target.checked })}
                                    className="w-4 h-4 accent-emerald-500"
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-slate-400 tabular-nums">{idx + 1}</td>
                                <td className="px-2 py-1.5 max-w-[160px] text-[11px]">
                                  {dupBase || dupFile ? (
                                    <div className="flex flex-col gap-0.5">
                                      {dupBase && (
                                        <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                          Na base{rv.duplicateName ? ` · ${rv.duplicateName}` : ''} — marque para unificar
                                        </span>
                                      )}
                                      {dupFile && (
                                        <span className="text-amber-700 dark:text-amber-300 font-semibold">Repetido no texto</span>
                                      )}
                                    </div>
                                  ) : probLen ? (
                                    <span className="text-amber-700 dark:text-amber-300">{(rv.problems || []).join(' · ')}</span>
                                  ) : (
                                    <span className="text-emerald-600 font-medium">OK</span>
                                  )}
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.name} onChange={e => updateRow({ name: e.target.value })} className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent" placeholder="Obrigatorio" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.phone} onChange={e => updateRow({ phone: e.target.value.replace(/\D/g, '') })} className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent font-mono tabular-nums" placeholder="5511999999999" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.email} onChange={e => updateRow({ email: e.target.value })} className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.city} onChange={e => updateRow({ city: e.target.value })} className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.state} onChange={e => updateRow({ state: e.target.value.toUpperCase().slice(0, 2) })} className="w-12 px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent uppercase" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.zipCode} onChange={e => updateRow({ zipCode: e.target.value })} className="w-20 px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.church} onChange={e => updateRow({ church: e.target.value })} className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.role} onChange={e => updateRow({ role: e.target.value })} className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={rv.profession} onChange={e => updateRow({ profession: e.target.value })} className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent" />
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  <button type="button" onClick={() => setSmartImportRows(prev => prev.filter(pr => pr.id !== rv.id))} className="text-slate-400 hover:text-red-500">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3 bg-slate-50 dark:bg-slate-900/50">
              <p className="text-[11.5px] text-slate-500">
                Os campos em amarelo estão incompletos (nome ou telefone inválidos). Duplicado na base = pode marcar a linha para unificar dados e vincular à lista, sem criar outro contato. Repetido no texto = mesma linha duas vezes no trecho colado — não importa a 2.ª ocorrência.
              </p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-white dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Destino da importação</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    ['none', 'Importar sem lista'],
                    ['existing', 'Adicionar em lista existente'],
                    ['new', 'Criar nova lista com importados']
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSmartImportTargetMode(mode)}
                      className={`px-3 py-2 rounded-lg border text-xs font-semibold ${
                        smartImportTargetMode === mode
                          ? 'brand-soft brand-text brand-border'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {smartImportTargetMode === 'existing' && (
                  <select className="ui-input" value={smartImportTargetListId} onChange={(e) => setSmartImportTargetListId(e.target.value)}>
                    <option value="">Escolha uma lista</option>
                    {contactLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.contactIds?.length || 0})
                      </option>
                    ))}
                  </select>
                )}
                {smartImportTargetMode === 'new' && (
                  <input
                    type="text"
                    className="ui-input"
                    value={smartImportNewListName}
                    onChange={(e) => setSmartImportNewListName(e.target.value)}
                    placeholder="Nome da nova lista"
                  />
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setSmartImportOpen(false);
                    setSmartImportPreviewFilter('all');
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Save className="w-4 h-4" />}
                  disabled={
                    smartImportRowsView.filter(rv => {
                      const base = smartImportRows.find(b => b.id === rv.id);
                      return base?.include && (rv.problems?.length || 0) === 0;
                    }).length === 0
                  }
                  onClick={async () => {
                    if (smartImportTargetMode === 'existing' && !smartImportTargetListId) {
                      toast.error('Escolha uma lista de destino.');
                      return;
                    }
                    if (smartImportTargetMode === 'new' && !smartImportNewListName.trim()) {
                      toast.error('Informe o nome da nova lista.');
                      return;
                    }
                    const localByKey = new Map<string, Contact>(contactByPhoneKey);
                    const touchedIds = new Set<string>();
                    let imported = 0;
                    let skipped = 0;
                    let merged = 0;
                    for (const rv of smartImportRowsView) {
                      const base = smartImportRows.find(b => b.id === rv.id);
                      if (!base?.include) continue;
                      if ((rv.problems?.length || 0) > 0) {
                        skipped++;
                        continue;
                      }
                      const phone = normalizeBRPhone(rv.phone);
                      const k = normPhoneKey(phone);
                      if (!k) {
                        skipped++;
                        continue;
                      }
                      const c: Contact = {
                        id: `smart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                        name: rv.name.trim() || 'Sem Nome',
                        phone,
                        city: rv.city || '',
                        state: rv.state || '',
                        street: rv.street || '',
                        number: rv.number || '',
                        neighborhood: rv.neighborhood || '',
                        zipCode: rv.zipCode || '',
                        church: rv.church || '',
                        role: rv.role || '',
                        profession: rv.profession || '',
                        birthday: rv.birthday || '',
                        email: rv.email || '',
                        notes: rv.notes || '',
                        tags: ['ImportaÃ§Ã£o RÃ¡pida'],
                        status: phone.replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID',
                        lastMsg: 'Nunca'
                      };
                      const existing = localByKey.get(k);
                      if (existing) {
                        const mergedPayload = mergeContactData(existing, c, ['Importação Rápida']);
                        await updateContact(existing.id, mergedPayload);
                        const nextExisting: Contact = { ...existing, ...mergedPayload };
                        localByKey.set(k, nextExisting);
                        touchedIds.add(existing.id);
                        merged++;
                      } else {
                        const createdId = await addContact(c);
                        if (typeof createdId === 'string' && createdId) {
                          localByKey.set(k, { ...c, id: createdId });
                          touchedIds.add(createdId);
                          imported++;
                        }
                      }
                    }
                    let attached = 0;
                    let listName = '';
                    const importIds = Array.from(touchedIds);
                    if (importIds.length > 0 && smartImportTargetMode !== 'none') {
                      const result = await attachContactsToList(
                        importIds,
                        smartImportTargetMode,
                        smartImportTargetListId,
                        smartImportNewListName,
                        'importação inteligente'
                      );
                      attached = result.attached;
                      listName = result.listName || '';
                    }
                    toast.success(
                      `${imported} contato(s) novo(s).` +
                      (merged ? ` ${merged} contato(s) unificado(s).` : '') +
                      (skipped ? ` ${skipped} linha(s) ignorada(s) (com problema).` : '') +
                      (attached > 0 ? ` ${attached} vinculado(s) em "${listName}".` : '')
                    );
                    setSmartImportOpen(false);
                    setSmartImportRaw('');
                    setSmartImportRows([]);
                    setSmartImportPreviewFilter('all');
                    setSmartImportTargetMode('none');
                    setSmartImportTargetListId('');
                    setSmartImportNewListName('');
                  }}
                >
                  Importar{' '}
                  {
                    smartImportRowsView.filter(rv => {
                      const base = smartImportRows.find(b => b.id === rv.id);
                      return base?.include && (rv.problems?.length || 0) === 0;
                    }).length
                  }{' '}
                  contato(s)
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
      
      