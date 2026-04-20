import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Filter, Upload, Download, UserPlus, UserMinus, Trash2, CheckCircle2, XCircle, MapPin, Church, User, Users, X, Save, ChevronLeft, ChevronRight, FileSpreadsheet, Phone, Briefcase, ListPlus, Square, CheckSquare, Pencil, AlertCircle, Home, Flame, Snowflake, Sparkles, Wand2, ClipboardPaste, Info, Layers } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Contact, ContactList } from '../types';
import { useZapMass } from '../context/ZapMassContext';
import toast from 'react-hot-toast';
import { Badge, Button, Card, EmptyState, SectionHeader, StatCard } from './ui';

const BR_STATES = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

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
  duplicateName?: string;
  problems: string[];
};

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

export const ContactsTab: React.FC = () => {
  const { contacts, contactLists, conversations, addContact, removeContact, updateContact, createContactList, deleteContactList, updateContactList } = useZapMass();
  
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

  useEffect(() => {
    if (listManageId && !contactLists.some((l) => l.id === listManageId)) {
      setListManageId(null);
      setListAddSelectedIds([]);
    }
  }, [contactLists, listManageId]);

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
      toast.error('Nao foi possivel criar a lista agora.');
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
      toast.error('Nao foi possivel criar a lista.');
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
      const seenBatch = new Set<string>();
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
        const duplicate = !!(k && (existingKeys.has(k) || seenBatch.has(k)));
        if (k && !duplicate) seenBatch.add(k);

        if (problems.length > 0 || duplicate) nProb++;
        const include = !duplicate && problems.length === 0;
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
      setFileImportOpen(true);
      toast.success(`Arquivo carregado: ${preview.length} linha(s). ${nProb > 0 ? `${nProb} com aviso — revise antes de importar.` : 'Pronto para importar.'}`);
    } catch (err: any) {
      console.error('[ImportContacts]', err);
      toast.error('Falha ao ler o arquivo. Confira o formato e tente novamente.');
    }
  };

  const ITEMS_PER_PAGE = 15;
  const validCount = contacts.filter(c => c.status === 'VALID').length;
  const invalidCount = contacts.filter(c => c.status === 'INVALID').length;
  const tagCounts = contacts.reduce<Record<string, number>>((acc, contact) => {
    contact.tags.forEach(tag => {
      acc[tag] = (acc[tag] || 0) + 1;
    });
    return acc;
  }, {});
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const recentContacts = contacts.slice(0, 5);

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

    for (const conv of conversations) {
      const phoneKey = normPhoneKey(convPrimaryDigits(conv));
      if (!phoneKey || phoneKey.length < 12) continue;
      const s = accum(phoneKey);
      const msgs = [...(conv.messages || [])].sort(
        (a, b) => ((a as any).timestampMs || 0) - ((b as any).timestampMs || 0)
      );
      let lastOutTs = 0;
      for (const m of msgs) {
        const ts = (m as any).timestampMs || (m.timestamp ? Date.parse(m.timestamp) : 0) || 0;
        if (m.sender === 'me') {
          s.sent++;
          if (ts > s.lastSentTs) s.lastSentTs = ts;
          if (ts > lastOutTs) lastOutTs = ts;
          const st = (m as any).status;
          if (st === 'delivered' || st === 'read') s.delivered++;
          if (st === 'read') {
            s.read++;
            if (ts > s.lastReadTs) s.lastReadTs = ts;
          }
        } else if (m.sender === 'them') {
          if (lastOutTs && ts > lastOutTs) {
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
  }, [conversations, contacts]);

  const fileImportRowsView = useMemo((): FileImportRowView[] => {
    if (fileImportRows.length === 0) return [];
    const existingKeys = new Set(contacts.map(c => normPhoneKey(c.phone)).filter(Boolean));
    const nameByKey = new Map<string, string>();
    contacts.forEach(c => {
      const k = normPhoneKey(c.phone);
      if (k) nameByKey.set(k, c.name);
    });
    const seen = new Set<string>();
    return fileImportRows.map(r => {
      const problems: string[] = [];
      if (!r.contact.name.trim()) problems.push('Nome ausente');
      const d = r.contact.phone.replace(/\D/g, '');
      if (!d) problems.push('Telefone ausente');
      else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');
      const k = normPhoneKey(r.contact.phone);
      const duplicate = !!(k && (existingKeys.has(k) || seen.has(k)));
      const duplicateName = k && existingKeys.has(k) ? nameByKey.get(k) : undefined;
      if (k && !duplicate) seen.add(k);
      return { ...r, problems, duplicate, duplicateName };
    });
  }, [fileImportRows, contacts]);

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
    const existingKeys = new Set(contacts.map(c => normPhoneKey(c.phone)).filter(Boolean));
    const nameByKey = new Map<string, string>();
    contacts.forEach(c => {
      const k = normPhoneKey(c.phone);
      if (k) nameByKey.set(k, c.name);
    });
    const seen = new Set<string>();
    return smartImportRows.map(r => {
      const phone = normalizeBRPhone(r.phone);
      const problems: string[] = [];
      if (!r.name.trim()) problems.push('Nome ausente');
      const d = phone.replace(/\D/g, '');
      if (!d) problems.push('Telefone ausente');
      else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');
      const k = normPhoneKey(phone);
      const duplicate = !!(k && (existingKeys.has(k) || seen.has(k)));
      const duplicateName = k && existingKeys.has(k) ? nameByKey.get(k) : undefined;
      if (k && !duplicate) seen.add(k);
      return { ...r, phone, problems, duplicate, duplicateName };
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

  // Sugestoes dinamicas (cargos e profissoes ja cadastrados) para os comboboxes
  const DEFAULT_CHURCH_ROLES = ['Membro', 'Visitante', 'Lider', 'Diacono', 'Pastor', 'Musico', 'Obreiro', 'Professor'];
  const roleSuggestions = Array.from(
    new Set([
      ...DEFAULT_CHURCH_ROLES,
      ...contacts.map(c => (c.role || '').trim()).filter(Boolean)
    ])
  ).sort((a, b) => a.localeCompare(b));
  const professionSuggestions = Array.from(
    new Set(contacts.map(c => (c.profession || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const churchSuggestions = Array.from(
    new Set(contacts.map(c => (c.church || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const citySuggestions = Array.from(
    new Set(contacts.map(c => (c.city || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Filter Logic
  const filteredContacts = contacts.filter(c => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = c.name.toLowerCase().includes(q) ||
      c.phone.includes(searchTerm) ||
      c.tags.some(t => t.toLowerCase().includes(q)) ||
      c.city?.toLowerCase().includes(q) ||
      c.state?.toLowerCase().includes(q) ||
      c.street?.toLowerCase().includes(q) ||
      c.neighborhood?.toLowerCase().includes(q) ||
      c.zipCode?.toLowerCase().includes(q) ||
      c.church?.toLowerCase().includes(q) ||
      c.role?.toLowerCase().includes(q) ||
      c.profession?.toLowerCase().includes(q);
    const matchesStatus = filterStatus === 'ALL' || c.status === filterStatus;
    const matchesTag = !filterTag || c.tags.some(t => t.toLowerCase() === filterTag.toLowerCase());
    const matchesTemp = filterTemp === 'ALL' || contactTemps[c.id]?.temp === filterTemp;
    return matchesSearch && matchesStatus && matchesTag && matchesTemp;
  });

  const listFilteredContacts = filteredContacts;

  // Pagination Logic
  const totalPages = Math.ceil(listFilteredContacts.length / ITEMS_PER_PAGE);
  const paginatedContacts = listFilteredContacts.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  const allPageSelected = paginatedContacts.length > 0 && paginatedContacts.every(c => selectedIds.includes(c.id));

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Tem certeza que deseja remover este contato da base?')) {
      removeContact(id);
      // Adjust page if empty
      if (paginatedContacts.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      }
    }
  };

  const handleDeleteList = async (id: string, name: string) => {
    if (!window.confirm(`Remover a lista "${name}"?`)) return;
    try {
      await deleteContactList(id);
      toast.success('Lista removida com sucesso.');
    } catch {
      toast.error('Nao foi possivel remover a lista.');
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
      toast.error('Nao foi possivel atualizar a lista.');
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
      toast.error('Nenhum contato novo para incluir (ja estao na lista ou invalidos).');
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
      toast.error('Nao foi possivel atualizar a lista.');
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
      toast.error('Nao foi possivel atualizar a lista.');
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
      toast.error('Nenhum contato novo para incluir (ja estao na lista ou invalidos).');
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
      toast.error('Nao foi possivel atualizar a lista.');
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

  // Colunas do modelo de importacao (tambem usadas no export)
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

  const handleSaveNewContact = async () => {
    if (!newContact.name || !newContact.phone) {
      alert('Por favor, preencha pelo menos Nome e Telefone.');
      return;
    }
    const cleanPhone = (newContact.phone || '').replace(/\D/g, '');

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
    } else {
      const contact: Contact = {
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
      await addContact(contact);
    }

    setIsModalOpen(false);
    setEditingContactId(null);
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

  return (
    <div className="space-y-5 pb-10 relative">
      <SectionHeader
        eyebrow={<><Users className="w-3 h-3" />Contatos</>}
        title="Base de Contatos"
        description="Gerencie contatos, edite dados rapidamente e organize listas para campanhas."
        icon={<Users className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        actions={
          <>
            <Button variant="secondary" leftIcon={<FileSpreadsheet className="w-4 h-4" />} onClick={handleDownloadTemplate}>
              Modelo
            </Button>
            <Button variant="secondary" leftIcon={<Upload className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()}>
              Importar XLSX
            </Button>
            <Button variant="secondary" leftIcon={<Wand2 className="w-4 h-4" />} onClick={() => { setSmartImportRaw(''); setSmartImportRows([]); setSmartImportOpen(true); }}>
              Colar do Excel/Word
            </Button>
            <Button
              variant="primary"
              leftIcon={<UserPlus className="w-4 h-4" />}
              onClick={() => {
                setEditingContactId(null);
                setNewContact({ name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '', church: '', role: '', profession: '', birthday: '', email: '', notes: '' });
                setIsModalOpen(true);
              }}
            >
              Novo Contato
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={handleImportCSV}
            />
          </>
        }
      />

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
                  {(managedListForView.contactIds?.length || 0) !== 1 ? 's' : ''} na lista
                </p>
              </div>
            </div>
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900/50 self-start">
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
      {showFilterPanel && (
        <div className="ui-card p-4 border-l-4 border-emerald-500">
          <div className="flex flex-wrap gap-6 items-end">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Status</label>
              <div className="flex gap-2">
                {(['ALL', 'VALID', 'INVALID'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => { setFilterStatus(s); setCurrentPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      filterStatus === s ? 'brand-soft brand-text brand-border' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {s === 'ALL' ? 'Todos' : s === 'VALID' ? '✅ Válidos' : '❌ Inválidos'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Segmento (Tag)</label>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => { setFilterTag(''); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    !filterTag ? 'brand-soft brand-text brand-border' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >Todas</button>
                {topTags.map(([tag]) => (
                  <button
                    key={tag}
                    onClick={() => { setFilterTag(tag); setCurrentPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      filterTag === tag ? 'brand-soft brand-text brand-border' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >{tag}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Temperatura</label>
              <div className="flex flex-wrap gap-1">
                {(['ALL','hot','warm','cold','new'] as const).map(t => {
                  const label = t === 'ALL' ? 'Todas' : TEMP_LABEL[t];
                  const count = t === 'ALL'
                    ? contacts.length
                    : contacts.filter(c => contactTemps[c.id]?.temp === t).length;
                  const active = filterTemp === t;
                  const Icon = t === 'hot' ? Flame : t === 'warm' ? Flame : t === 'cold' ? Snowflake : t === 'new' ? Info : Filter;
                  return (
                    <button
                      key={t}
                      onClick={() => { setFilterTemp(t); setCurrentPage(1); }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        active ? 'brand-soft brand-text brand-border' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {t !== 'ALL' && <Icon className="w-3 h-3" />}
                      {label}
                      <span className="text-[10px] opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => { setFilterStatus('ALL'); setFilterTag(''); setFilterTemp('ALL'); setCurrentPage(1); }}
              className="text-xs text-slate-400 hover:text-red-500 ml-auto"
            >Limpar filtros</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total contatos" value={contacts.length} icon={<Users className="w-4 h-4" />} helper="Base ativa" />
        <StatCard
          label="Validos"
          value={validCount}
          icon={<CheckCircle2 className="w-4 h-4" />}
          helper="Prontos para disparo"
          accent="success"
        />
        <StatCard
          label="Invalidos"
          value={invalidCount}
          icon={<AlertCircle className="w-4 h-4" />}
          helper="Precisam revisar"
          accent="danger"
        />
        <Card>
          <p className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            Segmentos
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {topTags.length === 0 && (
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Sem tags.
              </span>
            )}
            {topTags.map(([tag, count]) => (
              <Badge key={tag} variant="neutral">
                {tag} ({count})
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      {/* Filters Bar */}
      <div className="ui-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <label htmlFor="contactSearch" className="sr-only">Buscar contato</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input 
            id="contactSearch"
            name="contactSearch"
            type="text" 
            placeholder="Buscar por nome, telefone, cidade, CEP, rua, igreja ou cargo..." 
            className="ui-input pl-9"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1); // Reset page on search
            }}
          />
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
           <button 
             onClick={() => setShowFilterPanel(!showFilterPanel)}
             className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${showFilterPanel ? 'brand-soft brand-text brand-border' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'}`}
           >
             <Filter className="w-4 h-4" /> Filtros {(filterStatus !== 'ALL' || filterTag || filterTemp !== 'ALL') ? '●' : ''}
           </button>
           <button 
             onClick={handleExport}
             className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent"
           >
             <Download className="w-4 h-4" /> Exportar
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="ui-card p-4 lg:col-span-2">
          <h3 className="font-bold text-slate-900 dark:text-white mb-3">Segmentos rápidos</h3>
          <div className="flex flex-wrap gap-2">
            {topTags.map(([tag, count]) => (
              <button key={tag} className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
                {tag} • {count}
              </button>
            ))}
            {topTags.length === 0 && <span className="text-sm text-slate-400">Cadastre tags para criar segmentos.</span>}
          </div>
        </div>
        <div className="ui-card p-4">
          <h3 className="font-bold text-slate-900 dark:text-white mb-3">Últimos contatos</h3>
          <div className="space-y-2">
            {recentContacts.length === 0 && <p className="text-sm text-slate-400">Sem contatos recentes.</p>}
            {recentContacts.map(contact => (
              <div key={contact.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">{contact.name}</span>
                <span className="text-xs text-slate-400">{contact.phone}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-900 dark:text-white">Listas de Contatos</h3>
          <span className="text-xs text-slate-400">{contactLists.length} lista{contactLists.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 mb-3">
          <p className="text-xs font-semibold text-slate-500 mb-2">Criar nova lista</p>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              value={quickListName}
              onChange={(e) => setQuickListName(e.target.value)}
              placeholder="Ex: Lideranca SP"
              className="ui-input flex-1"
            />
            <button onClick={() => void handleCreateQuickList()} className="ui-btn-primary whitespace-nowrap">
              <ListPlus className="w-4 h-4" /> Criar Lista
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Usa contatos selecionados; se nada estiver selecionado, usa os contatos filtrados na tela.
          </p>
        </div>
        {contactLists.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma lista criada ainda. Selecione contatos abaixo e crie sua primeira lista.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {contactLists.map((list) => (
              <div
                key={list.id}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 flex items-start justify-between gap-3"
              >
                {editingListId === list.id ? (
                  <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                    <input
                      value={editingListName}
                      onChange={(e) => setEditingListName(e.target.value)}
                      className="ui-input h-8 text-sm flex-1 min-w-0"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => void saveListName()} className="ui-btn-primary h-8 px-3">Salvar</button>
                      <button type="button" onClick={() => { setEditingListId(null); setEditingListName(''); }} className="ui-btn h-8 px-3">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openListManage(list.id)}
                    className="min-w-0 flex-1 text-left rounded-lg -m-1 p-1 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    title="Gerir contatos desta lista"
                  >
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{list.name}</p>
                    <p className="text-xs text-slate-400 mt-1">{(list.contactIds?.length || list.count || 0)} contatos — clique para adicionar ou remover</p>
                  </button>
                )}
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      beginEditList(list);
                    }}
                    className="p-1.5 rounded-md text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10"
                    title="Editar nome da lista"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteList(list.id, list.name);
                    }}
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                    title="Excluir lista"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="ui-card p-4 border-l-4 border-emerald-500">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selecao ativa</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
                {selectedIds.length} contato{selectedIds.length > 1 ? 's' : ''} selecionado{selectedIds.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Inclua em uma lista existente ou crie uma lista nova para campanhas.
              </p>
            </div>
            <div className="flex flex-col gap-3 w-full lg:max-w-xl">
              {contactLists.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                  <select
                    value={addToListSelectId}
                    onChange={(e) => setAddToListSelectId(e.target.value)}
                    className="ui-input flex-1 text-sm"
                  >
                    <option value="">Escolha uma lista...</option>
                    {contactLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.contactIds?.length || 0})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleAddSelectionToList()}
                    disabled={!addToListSelectId}
                    className="ui-btn-primary whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <UserPlus className="w-4 h-4" /> Incluir na lista
                  </button>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                {showCreateList && (
                  <input
                    type="text"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    className="ui-input flex-1"
                    placeholder="Nome da lista"
                  />
                )}
                <button
                  onClick={() => {
                    if (showCreateList) {
                      void handleCreateListFromSelection();
                    } else {
                      setShowCreateList(true);
                    }
                  }}
                  className="ui-btn whitespace-nowrap border border-slate-200 dark:border-slate-600"
                >
                  <ListPlus className="w-4 h-4" /> {showCreateList ? 'Salvar lista nova' : 'Criar lista nova'}
                </button>
                {showCreateList && (
                  <button
                    onClick={() => {
                      setShowCreateList(false);
                      setNewListName('');
                    }}
                    className="ui-btn whitespace-nowrap"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contacts Table */}
      <div className="ui-card overflow-hidden flex flex-col min-h-[400px]">
        {/* Temperatura sempre visivel (o restante dos filtros continua no painel "Filtros") */}
        <div className="px-3 sm:px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0">Temperatura</span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {(['ALL', 'hot', 'warm', 'cold', 'new'] as const).map(t => {
              const label = t === 'ALL' ? 'Todas' : TEMP_LABEL[t];
              const count = t === 'ALL' ? contacts.length : contacts.filter(c => contactTemps[c.id]?.temp === t).length;
              const active = filterTemp === t;
              const Icon = t === 'hot' ? Flame : t === 'warm' ? Flame : t === 'cold' ? Snowflake : t === 'new' ? Info : Filter;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setFilterTemp(t); setCurrentPage(1); }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                    active
                      ? 'brand-soft brand-text brand-border'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {t !== 'ALL' && <Icon className="w-3 h-3" />}
                  {label}
                  <span className="opacity-60 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowFilterPanel(true)}
            className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline shrink-0 self-start sm:self-auto"
          >
            Mais filtros (status, tags…)
          </button>
        </div>
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-sm text-left">
            <thead className="text-slate-400 font-bold" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <tr>
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleSelectAll} className="text-slate-400 hover:text-emerald-500 transition-colors">
                    {allPageSelected ? <CheckSquare className="w-4 h-4 text-emerald-500" /> : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="px-4 py-3 text-xs uppercase tracking-wider">Nome / Telefone</th>
                <th className="px-4 py-3 text-xs uppercase tracking-wider hidden md:table-cell">Cidade / Endereco</th>
                <th className="px-4 py-3 text-xs uppercase tracking-wider hidden lg:table-cell">Igreja &amp; Cargo</th>
                <th className="px-4 py-3 text-xs uppercase tracking-wider hidden sm:table-cell">Tags</th>
                <th className="px-4 py-3 text-xs uppercase tracking-wider hidden md:table-cell">Listas</th>
                <th className="px-4 py-3 text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedContacts.map((contact) => {
                const isSelected = selectedIds.includes(contact.id);
                return (
                <tr key={contact.id}
                  onClick={() => toggleSelect(contact.id)}
                  className="cursor-pointer transition-colors group"
                  style={{ borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(16,185,129,0.05)' : undefined }}>
                  <td className="px-4 py-3">
                    {isSelected
                      ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                      : <Square className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />}
                  </td>
                  {/* Nome, Telefone e Temperatura */}
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 text-emerald-700" style={{ background: 'rgba(16,185,129,0.12)' }}>
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 dark:text-white text-sm">{contact.name}</span>
                          {(() => {
                            const t = contactTemps[contact.id];
                            if (!t) return null;
                            const acc = TEMP_ACCENT[t.temp];
                            const Icon = t.temp === 'hot' ? Flame : t.temp === 'warm' ? Flame : t.temp === 'cold' ? Snowflake : Info;
                            return (
                              <span
                                title={`Enviadas: ${t.sent} · Entregues: ${t.delivered} · Lidas: ${t.read} · Respostas: ${t.replied}`}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${acc.bg} ${acc.fg} ${acc.border}`}
                              >
                                <Icon className="w-3 h-3" />
                                {TEMP_LABEL[t.temp]}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">{contact.phone}</div>
                      </div>
                    </div>
                  </td>

                  {/* Cidade + endereco (campos novos aparecem aqui; edicao completa no lapis) */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                       <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                       <span>
                         {contact.city || <span className="text-slate-400">-</span>}
                         {contact.state ? <span className="text-slate-500 font-medium"> / {contact.state}</span> : null}
                       </span>
                    </div>
                    {(contact.street || contact.neighborhood || contact.zipCode || contact.number) ? (
                      <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 pl-5 max-w-[220px]">
                        <Home className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
                        <span className="line-clamp-2 break-words" title={[contact.street, contact.number].filter(Boolean).join(', ') + (contact.neighborhood ? ` · ${contact.neighborhood}` : '') + (contact.zipCode ? ` · CEP ${contact.zipCode}` : '')}>
                          {[contact.street, contact.number].filter(Boolean).join(', ')}
                          {contact.neighborhood ? ` · ${contact.neighborhood}` : ''}
                          {contact.zipCode ? ` · CEP ${contact.zipCode}` : ''}
                        </span>
                      </div>
                    ) : null}
                  </td>

                  {/* Igreja e Cargo */}
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-slate-900 dark:text-white font-medium text-xs">
                         <User className="w-3 h-3 text-blue-500" />
                         {contact.role || 'Membro'}
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
                         <Church className="w-3 h-3 text-slate-400" />
                         {contact.church || 'Não informada'}
                      </div>
                      {contact.profession && (
                        <div className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 text-[11px]">
                          <Briefcase className="w-3 h-3 text-sky-500" />
                          {contact.profession}
                        </div>
                      )}
                      {contact.birthday && (
                        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-[11px]">
                           <span className="w-3 h-3 flex items-center justify-center">🎂</span>
                           {(() => {
                             try {
                               const d = new Date(contact.birthday);
                               if (isNaN(d.getTime())) return contact.birthday;
                               return d.toLocaleDateString('pt-BR');
                             } catch { return contact.birthday; }
                           })()}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Tags */}
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags.length > 0 ? contact.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                          {tag}
                        </span>
                      )) : <span className="text-slate-400 text-xs">-</span>}
                    </div>
                  </td>

                  {/* Quantas listas o contato participa */}
                  <td className="px-6 py-4 hidden md:table-cell" onClick={e => e.stopPropagation()}>
                    {(() => {
                      const n = contactListMembership.counts[contact.id] || 0;
                      const names = contactListMembership.names[contact.id];
                      const title = names?.length ? names.join(', ') : 'Nao esta em nenhuma lista';
                      return (
                        <span
                          title={title}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums ${n > 0 ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-400'}`}
                        >
                          <Layers className="w-3.5 h-3.5 shrink-0 opacity-80" />
                          {n}
                        </span>
                      );
                    })()}
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4">
                    {contact.status === 'VALID' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-green-50 text-green-700 border border-green-100">
                        <CheckCircle2 className="w-3 h-3" /> Válido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-red-50 text-red-700 border border-red-100">
                        <XCircle className="w-3 h-3" /> Inválido
                      </span>
                    )}
                  </td>

                  {/* Ações */}
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          beginEditContact(contact);
                        }}
                        className="text-slate-300 hover:text-brand-600 p-1.5 rounded-md hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors"
                        title="Editar contato"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(contact.id);
                        }}
                        className="text-slate-300 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="Apagar contato da base"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        
        {listFilteredContacts.length === 0 && (
          <div className="p-10">
            <EmptyState
              icon={<Users className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
              title="Nenhum contato encontrado"
              description="Tente ajustar os filtros ou importe contatos via CSV para comecar."
            />
          </div>
        )}

        {/* Pagination Controls */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
           <span>Mostrando {paginatedContacts.length} de {listFilteredContacts.length} contatos</span>
           <div className="flex gap-2 items-center">
             <span className="mr-2">Página {currentPage} de {totalPages || 1}</span>
             <button 
               onClick={() => handlePageChange(currentPage - 1)}
               disabled={currentPage === 1}
               className="p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
             >
               <ChevronLeft className="w-4 h-4" />
             </button>
             <button 
               onClick={() => handlePageChange(currentPage + 1)}
               disabled={currentPage === totalPages || totalPages === 0}
               className="p-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
             >
               <ChevronRight className="w-4 h-4" />
             </button>
           </div>
        </div>
      </div>
      </>
      )}
      
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
                      {editingContactId ? 'Atualize os dados e salve as alteracoes.' : 'Preencha os dados abaixo para cadastrar manualmente.'}
                    </p>
                 </div>
                 <button onClick={() => { setIsModalOpen(false); setEditingContactId(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 p-1.5 rounded-full transition-colors">
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

                 {/* Section: Endereco */}
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <Home className="w-3.5 h-3.5" /> Endereco
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
                             <label htmlFor="newContactNumber" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Numero</label>
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
                       <label htmlFor="newContactNotes" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Observacoes</label>
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
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 rounded-b-2xl flex justify-between items-center gap-4">
                 <button 
                    onClick={() => { setIsModalOpen(false); setEditingContactId(null); }}
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

      {/* Revisao de importacao por arquivo (XLSX/CSV): filtros, problemas, duplicados */}
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
                  <h3 className="text-[15px] font-bold text-slate-900 dark:text-white truncate">Revisar importacao</h3>
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
              <p className="text-[11px] text-slate-500">
                Duplicados = mesmo telefone ja cadastrado ou repetido no arquivo. Linhas com problema nao sao importadas ate voce corrigir e marcar o checkbox.
              </p>
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
                              disabled={rv.duplicate || rv.problems.length > 0}
                              onChange={e => setFileImportRows(prev => prev.map(x => (x.id === rv.id ? { ...x, include: e.target.checked } : x)))}
                              className="w-4 h-4 accent-emerald-500"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-slate-400 tabular-nums">{rv.lineNumber}</td>
                          <td className="px-2 py-1.5 max-w-[200px]">
                            {rv.duplicate ? (
                              <span className="text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                                Duplicado{rv.duplicateName ? ` (${rv.duplicateName})` : ''}
                              </span>
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

            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50 dark:bg-slate-900/50">
              <p className="text-[11px] text-slate-500">
                A importar:{' '}
                <b>
                  {
                    fileImportRowsView.filter(rv => rv.include && !rv.duplicate && rv.problems.length === 0).length
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
                  disabled={fileImportRowsView.filter(rv => rv.include && !rv.duplicate && rv.problems.length === 0).length === 0}
                  onClick={async () => {
                    const keysAdded = new Set(contacts.map(c => normPhoneKey(c.phone)).filter(Boolean));
                    let added = 0;
                    let skippedDup = 0;
                    let skippedProb = 0;
                    for (const rv of fileImportRowsView) {
                      if (!rv.include) continue;
                      if (rv.duplicate) {
                        skippedDup++;
                        continue;
                      }
                      if (rv.problems.length > 0) {
                        skippedProb++;
                        continue;
                      }
                      const phone = normalizeBRPhone(rv.contact.phone);
                      const k = normPhoneKey(phone);
                      if (!k || keysAdded.has(k)) {
                        skippedDup++;
                        continue;
                      }
                      await addContact({
                        ...rv.contact,
                        id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                        name: rv.contact.name.trim() || 'Sem Nome',
                        phone,
                        status: phone.replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID'
                      });
                      keysAdded.add(k);
                      added++;
                    }
                    toast.success(
                      `${added} contato(s) importado(s).` +
                        (skippedDup ? ` ${skippedDup} duplicado(s) ignorado(s).` : '') +
                        (skippedProb ? ` ${skippedProb} com problema nao importado(s).` : '')
                    );
                    setFileImportOpen(false);
                    setFileImportRows([]);
                  }}
                >
                  Confirmar importacao
                </Button>
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
                  <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Importacao inteligente</h3>
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
                        setSmartImportRows(parsed.map(p => ({ ...p, include: true })));
                        if (parsed.length === 0) toast.error('Nao consegui identificar contatos no texto.');
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
                        {
                          smartImportRowsView.filter(rv => {
                            const base = smartImportRows.find(b => b.id === rv.id);
                            return base?.include && !rv.duplicate && (rv.problems?.length || 0) === 0;
                          }).length
                        }{' '}
                        pronto(s) para importar
                      </span>
                      <span className="text-slate-400">de {smartImportRows.length}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setSmartImportRows(rows => rows.map(r => ({ ...r, include: true })))}>
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
                            const rowClass = `${!include ? 'opacity-40' : ''} ${rv.duplicate ? 'bg-rose-50/40 dark:bg-rose-950/15' : probLen ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}`;
                            return (
                              <tr key={rv.id} className={rowClass}>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    checked={include}
                                    disabled={!!rv.duplicate || probLen > 0}
                                    onChange={e => updateRow({ include: e.target.checked })}
                                    className="w-4 h-4 accent-emerald-500"
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-slate-400 tabular-nums">{idx + 1}</td>
                                <td className="px-2 py-1.5 max-w-[160px] text-[11px]">
                                  {rv.duplicate ? (
                                    <span className="text-rose-600 font-semibold">
                                      Duplicado{rv.duplicateName ? ` (${rv.duplicateName})` : ''}
                                    </span>
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

            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/50">
              <p className="text-[11.5px] text-slate-500 hidden sm:block">
                Os campos em amarelo estao incompletos (nome ou telefone invalidos). Voce pode editar cada celula antes de importar.
              </p>
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
                      return base?.include && !rv.duplicate && (rv.problems?.length || 0) === 0;
                    }).length === 0
                  }
                  onClick={async () => {
                    const keysAdded = new Set(contacts.map(c => normPhoneKey(c.phone)).filter(Boolean));
                    let imported = 0;
                    let skipped = 0;
                    for (const rv of smartImportRowsView) {
                      const base = smartImportRows.find(b => b.id === rv.id);
                      if (!base?.include) continue;
                      if (rv.duplicate || (rv.problems?.length || 0) > 0) {
                        skipped++;
                        continue;
                      }
                      const phone = normalizeBRPhone(rv.phone);
                      const k = normPhoneKey(phone);
                      if (!k || keysAdded.has(k)) {
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
                        tags: ['Importacao Rapida'],
                        status: phone.replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID',
                        lastMsg: 'Nunca'
                      };
                      await addContact(c);
                      keysAdded.add(k);
                      imported++;
                    }
                    toast.success(`${imported} contato(s) importado(s).` + (skipped ? ` ${skipped} linha(s) ignorada(s) (duplicado ou com problema).` : ''));
                    setSmartImportOpen(false);
                    setSmartImportRaw('');
                    setSmartImportRows([]);
                    setSmartImportPreviewFilter('all');
                  }}
                >
                  Importar{' '}
                  {
                    smartImportRowsView.filter(rv => {
                      const base = smartImportRows.find(b => b.id === rv.id);
                      return base?.include && !rv.duplicate && (rv.problems?.length || 0) === 0;
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
      