import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Filter, Upload, Download, UserPlus, UserMinus, Trash2, CheckCircle2, XCircle, MapPin, Church, User, Users, X, Save, ChevronLeft, ChevronRight, FileSpreadsheet, Phone, Briefcase, ListPlus, Square, CheckSquare, Pencil, AlertCircle, Home, Flame, Snowflake, Sparkles, Wand2, ClipboardPaste, Info, Layers, MessageCircle, Send, Cake, Tag, Copy, Clock, MapPinOff, TrendingUp, Rocket, Smartphone, Heart, Loader2, Minimize2, SpellCheck2, RotateCw, Database } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Contact, ContactList } from '../types';
import { useZapMassCore, useZapMassConversations } from '../context/ZapMassContext';
import { useAppView } from '../context/AppViewContext';
import { useAppProfile } from '../context/AppProfileContext';
import { ReligiousMemberProfileModalFields } from './religious/ReligiousMemberProfileModalFields';
import {
  buildReligiousProfileComplete,
  contactToMemberForm,
  emptyForm,
  hasReligiousProfileData,
  mergeReligiousProfile,
  religiousExportColumns,
  type MemberFormState
} from './religious/religiousMemberFormShared';
import type { CampaignWizardDraft } from '../types/campaignMission';
import toast from 'react-hot-toast';
import { Badge, BrDateInput, Button, Card, EmptyState, Modal, SectionHeader, StatCard } from './ui';
import { ContactsHeaderBar } from './contacts/workspace/ContactsHeaderBar';
import { ContactsListsRail } from './contacts/workspace/ContactsListsRail';
import { ContactsSidebar, type SmartFilterId, type SidebarCounts } from './contacts/workspace/ContactsSidebar';
import { ContactsWorkspaceToolbar } from './contacts/workspace/ContactsWorkspaceToolbar';
import { ContactsListManagePanel } from './contacts/workspace/ContactsListManagePanel';
import { ContactsTableVirtual } from './contacts/workspace/ContactsTableVirtual';
import { ContactsBulkBar } from './contacts/workspace/ContactsBulkBar';
import { ContactsCommandHero } from './contacts/workspace/ContactsCommandHero';
import { ContactDetailDrawer } from './contacts/workspace/ContactDetailDrawer';
import { ContactsInsightsModal } from './contacts/workspace/ContactsInsightsModal';
import { parseVcfText, type ParsedVcfEntry } from '../utils/parseVcf';
import { contactsToVcfString } from '../utils/exportContactsVcf';
import { extractZapMassFollowFromVcfNotes } from '../utils/vcfZapMassFollowUp';
import {
  datetimeLocalToUtcIso,
  isoToDatetimeLocal,
  localStartOfTodayMs,
  matchesRetornoFilter,
  parseFollowUpMs,
  parseImportFollowUpAt
} from '../utils/followUp';
import {
  contactWeddingMatchesNextDays,
  contactWeddingMatchesToday,
  daysUntilWeddingAnniversary,
  parseWeddingDayMonth
} from '../utils/weddingAnniversary';
import { storedDateToBrDisplay } from '../utils/brDateMask';
import {
  computeContactTemperatures,
  CONTACT_TEMP_DEFAULT,
  CONTACT_TEMP_LABEL,
  type ContactTemperature,
  type TempStats
} from '../utils/contactTemperature';
import { normPhoneKey, normalizeBRPhone } from '../utils/brPhoneNormalize';
import { findBestConversationForPhone } from '../utils/findConversationByPhone';
import { openChatByConversationIdNavigate } from '../utils/openChatByConversationIdNav';
import { useContactPicturePrefetch } from '../hooks/useContactPicturePrefetch';
import { normalizeContactPersonName, parseExtraPrefixes } from '../utils/contactNameNormalize';
import { applyAddressNormalizationToContact } from '../utils/contactAddressNormalize';
import { validateImportRow } from '../utils/contactImportSchema';
import { apiNormalizeContactAddresses } from '../services/contactsApi';
import { apiGeocodeContacts, apiNormalizeAddresses } from '../services/leadsGeoApi';
import { apiFetchJson } from '../utils/apiFetchAuth';

const BR_STATES = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

const DEFAULT_CHURCH_ROLES = ['Membro', 'Visitante', 'Lider', 'Diacono', 'Pastor', 'Musico', 'Obreiro', 'Professor'];

/** Limite de auto-carga em RAM — bases 40k+ continuam utilizáveis sem travar o browser. */
const MAX_AUTO_LOAD_CONTACTS = 8000;

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
  { key: 'followUpAt', label: 'Data retorno', width: 22 },
  { key: 'followUpNote', label: 'Nota retorno', width: 24 },
  { key: 'status', label: 'Status', width: 10 }
];

/**
 * Na coluna «Nome» (1.ª coluna), numa linha sozinha: a importação ignora esta linha e **tudo abaixo**.
 * Útil quando o Excel mantém centenas de milhares de linhas vazias na grelha.
 */
const IMPORT_SHEET_END_MARKER = 'ZAPMASS_FIM_DADOS';

function normalizeImportEndMarkerCell(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .toUpperCase();
}

function trimTrailingEmptySheetRows(rows: any[][]): any[][] {
  const out = rows.map((r) => [...r]);
  while (out.length > 1 && out[out.length - 1].every((c) => String(c ?? '').trim() === '')) {
    out.pop();
  }
  return out;
}

function truncateSheetRowsAtImportEndMarker(rows: any[][]): {
  rows: any[][];
  cutByMarker: boolean;
  markerAtLine1Based: number | null;
} {
  if (rows.length < 2) return { rows, cutByMarker: false, markerAtLine1Based: null };
  const markerNorm = normalizeImportEndMarkerCell(IMPORT_SHEET_END_MARKER);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cellA = row[0];
    if (!String(cellA ?? '').trim()) continue;
    if (normalizeImportEndMarkerCell(cellA) === markerNorm) {
      return { rows: rows.slice(0, i), cutByMarker: true, markerAtLine1Based: i + 1 };
    }
  }
  return { rows, cutByMarker: false, markerAtLine1Based: null };
}

/** Colunas extras só na exportação XLSX (disparos / CRM) — não fazem parte do modelo de importação. */
const CAMPAIGN_EXPORT_COLUMNS: Array<{ label: string; width: number; get: (c: Contact) => string }> = [
  {
    label: 'Msg campanha (total)',
    width: 14,
    get: (c) => (c.campaignMessagesReceived != null ? String(c.campaignMessagesReceived) : '')
  },
  { label: 'Ultima campanha (nome)', width: 28, get: (c) => (c.campaignTablePreview?.campaignName || '').trim() },
  {
    label: 'Ultima campanha (recebidas / etapas)',
    width: 20,
    get: (c) => {
      const p = c.campaignTablePreview;
      if (!p?.campaignId) return '';
      return `${p.sent}/${p.totalStages}`;
    }
  },
  {
    label: 'Ultima campanha (etapas pendentes)',
    width: 18,
    get: (c) => {
      const p = c.campaignTablePreview;
      if (!p?.campaignId) return '';
      return String(p.pending);
    }
  },
  { label: 'Ultima campanha (id)', width: 28, get: (c) => (c.campaignTablePreview?.campaignId || '') }
];

/** Linhas de exportação XLSX: colunas fixas + disparos + opcional religioso. */
function buildContactExportRow(
  c: Contact,
  religiousExtras: ReturnType<typeof religiousExportColumns>
): string[] {
  const base = TEMPLATE_COLUMNS.map((col) => {
    if (col.key === 'tags') return (c.tags || []).join(';');
    if (col.key === 'status') return c.status;
    const v = (c as unknown as Record<string, unknown>)[col.key as string];
    return v == null ? '' : String(v);
  });
  const campaign = CAMPAIGN_EXPORT_COLUMNS.map((col) => col.get(c));
  const rel = religiousExtras.map((col) => col.get(c));
  return [...base, ...campaign, ...rel];
}

function buildContactExportHeaderLabels(religiousExtras: ReturnType<typeof religiousExportColumns>): string[] {
  return [
    ...TEMPLATE_COLUMNS.map((c) => c.label),
    ...CAMPAIGN_EXPORT_COLUMNS.map((c) => c.label),
    ...religiousExtras.map((c) => c.label)
  ];
}

function buildContactExportColWidths(religiousExtras: ReturnType<typeof religiousExportColumns>): { wch: number }[] {
  return [
    ...TEMPLATE_COLUMNS.map((c) => ({ wch: c.width })),
    ...CAMPAIGN_EXPORT_COLUMNS.map((c) => ({ wch: c.width })),
    ...religiousExtras.map((c) => ({ wch: c.width }))
  ];
}

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

/** Snapshot estável para fila de importações (vários arquivos em sequência). */
type FileImportQueuedPayload = {
  snapshotRows: FileImportRow[];
  label: string;
  targetMode: ImportTargetMode;
  targetListId: string;
  newListName: string;
};

function cloneFileImportRowsSnapshot(rows: FileImportRow[]): FileImportRow[] {
  return rows.map((r) => ({
    ...r,
    contact: {
      ...r.contact,
      tags: r.contact.tags ? [...r.contact.tags] : undefined,
    },
  }));
}

function buildContactByPhoneKeyMap(list: Contact[]): Map<string, Contact> {
  const map = new Map<string, Contact>();
  for (const c of list) {
    const k = normPhoneKey(c.phone);
    if (!k) continue;
    if (!map.has(k)) map.set(k, c);
  }
  return map;
}

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
  /** ISO UTC quando a colagem inclui “data retorno”; vazio se não veio. */
  followUpAt: string;
  followUpNote: string;
  duplicate?: boolean;
  duplicateName?: string;
  problems?: string[];
};

// --- TEMPERATURA DO CONTATO (cálculo em `utils/contactTemperature`) ---
type Temperature = ContactTemperature;
const TEMP_LABEL = CONTACT_TEMP_LABEL;
const TEMP_ACCENT: Record<Temperature, { bg: string; fg: string; border: string }> = {
  hot: { bg: 'bg-red-50 dark:bg-red-950/30', fg: 'text-red-700 dark:text-red-300', border: 'border-red-200 dark:border-red-900/40' },
  warm: { bg: 'bg-amber-50 dark:bg-amber-950/30', fg: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-900/40' },
  cold: { bg: 'bg-sky-50 dark:bg-sky-950/30', fg: 'text-sky-700 dark:text-sky-300', border: 'border-sky-200 dark:border-sky-900/40' },
  new: { bg: 'bg-slate-100 dark:bg-slate-800', fg: 'text-slate-500 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-700' }
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
  followUpAt: '',
  followUpNote: '',
  ...partial
});

const stripInvisibleChars = (s: string) => s.replace(/[\u200B-\u200D\uFEFF]/g, '');

/** Snapshot de telefones na base para preview de importação (evita recalcular em cada atualização do CRM). */
type FileImportDupBasis = {
  keys: Set<string>;
  nameByKey: Map<string, string>;
};

const buildFileImportDupBasis = (contactsList: Contact[]): FileImportDupBasis => {
  const keys = new Set<string>();
  const nameByKey = new Map<string, string>();
  for (const c of contactsList) {
    const k = normPhoneKey(c.phone);
    if (!k) continue;
    keys.add(k);
    if (!nameByKey.has(k)) nameByKey.set(k, c.name);
  }
  return { keys, nameByKey };
};

/** Vista derivada (problemas/duplicados) — mesma regra que o preview pós-arquivo. */
const buildFileImportRowsViewFromDupBasis = (rows: FileImportRow[], basis: FileImportDupBasis): FileImportRowView[] => {
  if (rows.length === 0) return [];
  const seenPhoneInFile = new Set<string>();
  const { keys: existingKeys, nameByKey } = basis;
  return rows.map((r) => {
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
};

const buildFileImportRowsViewFromState = (rows: FileImportRow[], contactsList: Contact[]): FileImportRowView[] =>
  buildFileImportRowsViewFromDupBasis(rows, buildFileImportDupBasis(contactsList));

const normalizeFileImportRowContactOnly = (row: FileImportRow): FileImportRow => {
  const phone = normalizeBRPhone(stripInvisibleChars(row.contact.phone || ''));
  const base = {
    ...row.contact,
    name: normalizeContactPersonName(stripInvisibleChars((row.contact.name || '').trim()), {
      stripPrefixes: true,
      titleCase: true
    }),
    phone
  };
  return {
    ...row,
    contact: applyAddressNormalizationToContact(base)
  };
};

const recomputeOneStoredIncludeRow = (
  row: FileImportRow,
  existingKeys: Set<string>,
  seenPhoneInFile: Set<string>
): FileImportRow => {
  const normalizedContact = row.contact;
  const problems: string[] = [];
  if (!normalizedContact.name.trim()) problems.push('Nome ausente');
  const d = normalizedContact.phone.replace(/\D/g, '');
  if (!d) problems.push('Telefone ausente');
  else if (d.length < 10) problems.push('Telefone incompleto (min. 10 digitos)');
  const k = normPhoneKey(normalizedContact.phone);
  const duplicateAgainstBase = !!(k && existingKeys.has(k));
  const duplicateRepeatedInFile = !!(k && seenPhoneInFile.has(k));
  if (k) seenPhoneInFile.add(k);
  const include = problems.length === 0 && !duplicateRepeatedInFile && !duplicateAgainstBase;
  return { ...row, contact: normalizedContact, include };
};

/** Recalcula `include` e validação após contactos já normalizados (ordem do ficheiro importa para duplicados). */
const recomputeFileImportRowsStoredIncludes = (rows: FileImportRow[], contactsList: Contact[]): FileImportRow[] => {
  const existingKeys = new Set(contactsList.map((c) => normPhoneKey(c.phone)).filter(Boolean));
  const seenPhoneInFile = new Set<string>();
  return rows.map((row) => recomputeOneStoredIncludeRow(row, existingKeys, seenPhoneInFile));
};

async function recomputeFileImportRowsStoredIncludesAsync(
  rows: FileImportRow[],
  contactsList: Contact[],
  onFrac: (frac: number) => void
): Promise<FileImportRow[]> {
  const existingKeys = new Set(contactsList.map((c) => normPhoneKey(c.phone)).filter(Boolean));
  const seenPhoneInFile = new Set<string>();
  const n = rows.length;
  if (n === 0) return rows;
  const out: FileImportRow[] = [];
  const CHUNK = 220;
  for (let i = 0; i < n; i += CHUNK) {
    const end = Math.min(i + CHUNK, n);
    for (let j = i; j < end; j++) {
      out.push(recomputeOneStoredIncludeRow(rows[j], existingKeys, seenPhoneInFile));
    }
    onFrac(end / n);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return out;
}

/** Normaliza nome/telefone/UF e recalcula `include` como em `handleImportCSV` (duplicados no arquivo e na base). */
const normalizeFileImportRowsStored = (rows: FileImportRow[], contactsList: Contact[]): FileImportRow[] =>
  recomputeFileImportRowsStoredIncludes(rows.map(normalizeFileImportRowContactOnly), contactsList);

/** Normalização em lotes (UI responsiva + barra de progresso). */
async function batchedNormalizeFileImportRows(
  rows: FileImportRow[],
  contactsList: Contact[],
  onProgress: (pct: number, label?: string) => void
): Promise<FileImportRow[]> {
  const n = rows.length;
  if (n === 0) return rows;
  const CHUNK = Math.max(120, Math.min(320, Math.ceil(n / 30)));
  const next = rows.slice();
  for (let i = 0; i < n; i += CHUNK) {
    const end = Math.min(i + CHUNK, n);
    for (let j = i; j < end; j++) {
      next[j] = normalizeFileImportRowContactOnly(next[j]);
    }
    onProgress(Math.min(92, Math.round((92 * end) / n)), 'A normalizar nome e telefone…');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  onProgress(95, 'A recalcular duplicados e seleção…');
  const final = await recomputeFileImportRowsStoredIncludesAsync(next, contactsList, (frac) => {
    onProgress(95 + Math.round(5 * frac), 'A recalcular duplicados e seleção…');
  });
  onProgress(100, 'Normalização concluída');
  return final;
}

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

  return applyAddressNormalizationToContact({
    name:
      normalizeContactPersonName(pickPreferredValue(existing.name, incoming.name) || 'Sem Nome', {
        stripPrefixes: true,
        titleCase: true
      }) || 'Sem Nome',
    phone: finalPhone,
    city: pickPreferredValue(existing.city, incoming.city),
    state: pickPreferredValue(existing.state, incoming.state),
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
    followUpAt: incoming.followUpAt ?? existing.followUpAt,
    followUpNote: pickPreferredValue(existing.followUpNote, incoming.followUpNote),
    tags: mergedTags.length > 0 ? mergedTags : existing.tags || [],
    status: finalDigits.length >= 10 ? 'VALID' : 'INVALID'
  });
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
  const looksLikeHeader = hdrTokens.some((t) => {
    const c = t.replace(/[^a-z0-9]/g, '');
    return ['nome', 'telefone', 'email', 'cidade', 'cep', 'rua', 'bairro', 'igreja', 'cargo', 'profissao', 'estado', 'uf', 'dataretorno', 'notaretorno', 'retorno'].includes(c)
      || ['nome','telefone','email','cidade','cep','rua','bairro','igreja','cargo','profissao','estado','uf'].includes(t);
  });

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
    obs: 'notes', observacoes: 'notes', notes: 'notes',
    dataretorno: 'followUpAt', datadoretorno: 'followUpAt', retornoiso: 'followUpAt',
    followupat: 'followUpAt', followup: 'followUpAt', retorno: 'followUpAt',
    horaretorno: 'followUpAt', lembrete: 'followUpNote', notaretorno: 'followUpNote',
    notadoretorno: 'followUpNote', followupnote: 'followUpNote'
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
        } else if (k === 'followUpAt') {
          const iso = parseImportFollowUpAt(v);
          if (iso) r.followUpAt = iso;
        } else if (k === 'followUpNote') {
          r.followUpNote = v.slice(0, 500);
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
    channelWeightMode: 'equal',
    channelWeights: {},
    delaySeconds: 45,
    campaignFlowMode: 'sequential',
    messageStages: [
      {
        id: stageId,
        body: '',
        acceptAnyReply: true,
        validTokensText: '1, 2, sim, nao',
        invalidReplyBody: 'Não entendi. Responda com uma das opções acima.',
        marketingEffect: 'none'
      }
    ],
    filterCities: [],
    filterChurches: [],
    filterRoles: [],
    filterProfessions: [],
    filterDDDs: [],
    filterTemps: [],
    filterSearch: '',
    selectedContactPhones: [],
    manualSelection: false
  };
};

export const ContactsTab: React.FC = () => {
  const conversations = useZapMassConversations();
  const {
    contacts,
    contactsHasMore,
    contactsLoadingMore,
    loadMoreContacts,
    loadAllContacts,
    contactsSavedTotal,
    contactsSavedTotalLoading,
    refreshContactsSavedTotal,
    refreshContacts,
    contactLists,
    addContact,
    bulkAddContacts,
    removeContact,
    updateContact,
    bulkUpdateContacts,
    createContactList,
    appendContactIdsToContactList,
    deleteContactList,
    updateContactList,
  } = useZapMassCore();
  const { currentView, setCurrentView } = useAppView();
  const { segment } = useAppProfile();
  /** Evita travar a UI quando o socket atualiza conversas em alta frequência — o cálculo de temperatura acompanha com pequeno atraso. */
  const deferredConversations = useDeferredValue(conversations);

  /** Telefones que aparecem mais de uma vez — O(n), usado em filtros e segmentos (antes era O(n²) no segmento duplicados). */
  const phoneDupMeta = useMemo(() => {
    const cnt: Record<string, number> = {};
    for (const c of contacts) {
      const k = normPhoneKey(c.phone);
      if (!k) continue;
      cnt[k] = (cnt[k] || 0) + 1;
    }
    const phoneDupKeys = new Set<string>();
    for (const k in cnt) if (cnt[k] > 1) phoneDupKeys.add(k);
    let duplicateContactsCount = 0;
    for (const c of contacts) {
      const k = normPhoneKey(c.phone);
      if (k && phoneDupKeys.has(k)) duplicateContactsCount++;
    }
    return { phoneDupKeys, duplicateContactsCount };
  }, [contacts]);
  const { phoneDupKeys, duplicateContactsCount } = phoneDupMeta;

  /** IDs presentes em pelo menos uma lista — base para filtro "Sem lista". */
  const contactIdsInAnyList = useMemo(() => {
    const s = new Set<string>();
    for (const list of contactLists) {
      for (const id of list.contactIds || []) {
        if (id) s.add(String(id));
      }
    }
    return s;
  }, [contactLists]);

  const noListCount = useMemo(() => {
    let n = 0;
    for (const c of contacts) {
      if (!contactIdsInAnyList.has(c.id)) n++;
    }
    return n;
  }, [contacts, contactIdsInAnyList]);

  const contactByPhoneKey = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) {
      const k = normPhoneKey(c.phone);
      if (!k) continue;
      if (!map.has(k)) map.set(k, c);
    }
    return map;
  }, [contacts]);

  const contactsRef = useRef(contacts);
  useEffect(() => {
    contactsRef.current = contacts;
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
  const [listsUiFocus, setListsUiFocus] = useState<'none' | 'tab' | 'create'>('none');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  /** Fotos buscadas em background (já persistidas no servidor). */
  const [picOverrides, setPicOverrides] = useState<Record<string, string>>({});
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  /** Defer `searchTerm` para o filtro pesado (varre 14+ campos por contato) — digitação não trava o input em bases grandes. */
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [currentPage, setCurrentPage] = useState(1);
  const [autoLoadActive, setAutoLoadActive] = useState(true);
  const [autoLoadBudget, setAutoLoadBudget] = useState(MAX_AUTO_LOAD_CONTACTS);
  const [pageHidden, setPageHidden] = useState(
    () => typeof document !== 'undefined' && document.hidden
  );

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const shouldAutoLoadContacts =
    autoLoadActive &&
    currentView === 'contacts' &&
    !pageHidden &&
    !(
      contactsSavedTotal != null &&
      contacts.length >= autoLoadBudget &&
      contacts.length < contactsSavedTotal
    );

  const autoLoadDelayMs = useMemo(() => {
    const total = contactsSavedTotal ?? contacts.length;
    if (total > 30_000) return 2500;
    if (total > 15_000) return 1800;
    if (total > 8000) return 1200;
    if (total > 3000) return 800;
    return 500;
  }, [contactsSavedTotal, contacts.length]);

  useEffect(() => {
    if (
      contactsSavedTotal != null &&
      contacts.length >= autoLoadBudget &&
      contacts.length < contactsSavedTotal
    ) {
      setAutoLoadActive(false);
    }
  }, [contacts.length, contactsSavedTotal, autoLoadBudget]);

  // Auto-loader: uma página por vez; pausa fora da aba Contatos ou com aba do browser oculta.
  useEffect(() => {
    if (!shouldAutoLoadContacts || !contactsHasMore || contactsLoadingMore) return;
    const timer = window.setTimeout(() => {
      void loadAllContacts?.();
    }, autoLoadDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    shouldAutoLoadContacts,
    contactsHasMore,
    contactsLoadingMore,
    loadAllContacts,
    autoLoadDelayMs
  ]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'VALID' | 'INVALID'>('ALL');
  const [filterTag, setFilterTag] = useState('');
  const [filterTemp, setFilterTemp] = useState<'ALL' | Temperature>('ALL');
  const [newContact, setNewContact] = useState<Partial<Contact>>({
    name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '',
    church: '', role: '', profession: '', birthday: '', email: '', notes: '', followUpNote: ''
  });
  /** Data/hora local do retorno (campo `datetime-local`); convertido para ISO na gravação. */
  const [followUpDatetimeLocal, setFollowUpDatetimeLocal] = useState('');
  /** Auto-preenchimento de endereço por CEP (ViaCEP — gratuito, sem chave). */
  const [cepLookupState, setCepLookupState] = useState<'idle' | 'loading' | 'ok' | 'notfound' | 'error'>('idle');
  const cepLookupSeqRef = useRef(0);
  /** Sugestões IBGE de cidades no campo cidade do modal. */
  const [ibgeCitySuggestions, setIbgeCitySuggestions] = useState<Array<{ city: string; state: string }>>([]);
  const [showIbgeCityDropdown, setShowIbgeCityDropdown] = useState(false);
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupCepAndFill = useCallback(async (rawCep: string) => {
    const digits = (rawCep || '').replace(/\D/g, '');
    if (digits.length !== 8) {
      setCepLookupState('idle');
      return;
    }
    const seq = ++cepLookupSeqRef.current;
    setCepLookupState('loading');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = (await res.json()) as {
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
        erro?: boolean;
      };
      if (seq !== cepLookupSeqRef.current) return;
      if (data?.erro) {
        setCepLookupState('notfound');
        return;
      }
      setNewContact((prev) => ({
        ...prev,
        street: prev.street?.trim() ? prev.street : data.logradouro || prev.street || '',
        neighborhood: prev.neighborhood?.trim() ? prev.neighborhood : data.bairro || prev.neighborhood || '',
        city: data.localidade
          ? data.uf
            ? `${data.localidade} - ${data.uf}`
            : data.localidade
          : prev.city || '',
        state: data.uf || prev.state || ''
      }));
      setCepLookupState('ok');
      toast.success('Endereço preenchido pelo CEP.', { icon: '📍' });
    } catch {
      if (seq !== cepLookupSeqRef.current) return;
      setCepLookupState('error');
    }
  }, []);
  const fetchIbgeCitySuggestions = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      setIbgeCitySuggestions([]);
      setShowIbgeCityDropdown(false);
      return;
    }
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        suggestions: Array<{ city: string; state: string }>;
      }>(`/api/contacts/city-suggest?q=${encodeURIComponent(q.trim())}&limit=5`);
      if (data.ok && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setIbgeCitySuggestions(data.suggestions);
        setShowIbgeCityDropdown(true);
      } else {
        setIbgeCitySuggestions([]);
        setShowIbgeCityDropdown(false);
      }
    } catch {
      setIbgeCitySuggestions([]);
      setShowIbgeCityDropdown(false);
    }
  }, []);

  const handleCityInputChange = useCallback(
    (value: string) => {
      setNewContact((prev) => ({ ...prev, city: value }));
      if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
      cityDebounceRef.current = setTimeout(() => {
        void fetchIbgeCitySuggestions(value);
      }, 400);
    },
    [fetchIbgeCitySuggestions]
  );

  const handleCitySuggestionPick = useCallback((suggestion: { city: string; state: string }) => {
    setNewContact((prev) => ({ ...prev, city: suggestion.city, state: suggestion.state }));
    setShowIbgeCityDropdown(false);
    setIbgeCitySuggestions([]);
  }, []);

  const handleCorrectAddress = useCallback(async () => {
    const norm = applyAddressNormalizationToContact(newContact, null);
    if ((newContact.city || '').trim().length >= 2) {
      try {
        const data = await apiFetchJson<{
          ok: boolean;
          suggestions: Array<{ city: string; state: string }>;
        }>(`/api/contacts/city-suggest?q=${encodeURIComponent((newContact.city || '').trim())}&limit=1`);
        if (data.ok && data.suggestions?.[0]) {
          norm.city = data.suggestions[0].city;
          norm.state = data.suggestions[0].state;
        }
      } catch { /* mantém norm.city */ }
    }
    setNewContact((prev) => ({ ...prev, ...norm }));
    toast.success('Endereço corrigido com base no IBGE.', { icon: '🗺️' });
  }, [newContact]);

  const [religiousMemberForm, setReligiousMemberForm] = useState<MemberFormState>(() => emptyForm());
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingListName, setEditingListName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vcfInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState('');
  /** Lista aberta para gerir membros (sub-aba Na lista / Adicionar). */
  const [listManageSubTab, setListManageSubTab] = useState<'members' | 'add'>('members');
  const [listMemberSearch, setListMemberSearch] = useState('');
  const [listAddSearch, setListAddSearch] = useState('');
  const [listAddSelectedIds, setListAddSelectedIds] = useState<string[]>([]);
  const [addToListSelectId, setAddToListSelectId] = useState('');
  /** Escolha de lista via modal (substitui `window.prompt` ao adicionar contato(s) a uma lista). */
  const [pickListPayload, setPickListPayload] = useState<
    null | { mode: 'single'; contact: Contact } | { mode: 'bulk'; contactIds?: string[] }
  >(null);
  const [pickListTargetId, setPickListTargetId] = useState('');
  const [quickListName, setQuickListName] = useState('');
  // Smart Import: colar do Excel/Word e interpretar livremente
  const [smartImportOpen, setSmartImportOpen] = useState(false);
  const [nameNormalizeModalOpen, setNameNormalizeModalOpen] = useState(false);
  const [nameNormalizeStripPrefixes, setNameNormalizeStripPrefixes] = useState(true);
  const [nameNormalizeTitleCase, setNameNormalizeTitleCase] = useState(true);
  const [nameNormalizeFirstLast, setNameNormalizeFirstLast] = useState(false);
  const [nameNormalizeSanitizeChars, setNameNormalizeSanitizeChars] = useState(true);
  const [nameNormalizeExtraPrefixes, setNameNormalizeExtraPrefixes] = useState('');
  const [nameNormalizePreviewCount, setNameNormalizePreviewCount] = useState<number | null>(null);
  const [nameNormalizePreviewBusy, setNameNormalizePreviewBusy] = useState(false);
  const [nameNormalizeApplyBusy, setNameNormalizeApplyBusy] = useState(false);
  const [addressNormalizeBusy, setAddressNormalizeBusy] = useState(false);
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
  /** Modal grande oculto; importação corre em segundo plano com painel fixo. */
  const [fileImportDocked, setFileImportDocked] = useState(false);
  type FileImportJob = {
    phase: 'autofix' | 'import' | 'list' | 'done' | 'error';
    percent: number;
    current: number;
    total: number;
    message: string;
    error?: string;
    /** Importações ainda na fila após o job atual. */
    queuedBehind?: number;
  };
  const [fileImportJob, setFileImportJob] = useState<FileImportJob | null>(null);
  const [autoFixProgress, setAutoFixProgress] = useState<{ percent: number; message: string } | null>(null);
  /** Pipeline sequencial (confirmar importação / fila); não bloqueia só pelo autofix. */
  const fileImportPipelineBusyRef = useRef(false);
  const autoFixRunLockRef = useRef(false);
  const fileImportQueueRef = useRef<FileImportQueuedPayload[]>([]);
  /** Merge dos contatos tocados nos jobs anteriores da mesma corrida (estado React pode atrasar). */
  const fileImportPipelineContactsMergeRef = useRef<Map<string, Contact>>(new Map());
  const fileImportRowsRef = useRef<FileImportRow[]>([]);
  useEffect(() => {
    fileImportRowsRef.current = fileImportRows;
  }, [fileImportRows]);
  /** Congela duplicados contra a base no momento de abrir o ficheiro (evita travar com milhares de contactos + snapshots ao vivo). */
  const fileImportDupBasisRef = useRef<FileImportDupBasis | null>(null);
  const fileImportTableScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (fileImportPipelineBusyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const [smartImportTargetMode, setSmartImportTargetMode] = useState<ImportTargetMode>('none');
  const [smartImportTargetListId, setSmartImportTargetListId] = useState('');
  const [smartImportNewListName, setSmartImportNewListName] = useState('');
  const [newContactTargetMode, setNewContactTargetMode] = useState<ImportTargetMode>('none');
  const [newContactTargetListId, setNewContactTargetListId] = useState('');
  const [newContactNewListName, setNewContactNewListName] = useState('');

  useEffect(() => {
    if (activeFilter.startsWith('list:')) {
      const id = activeFilter.slice(5);
      if (!contactLists.some((l) => l.id === id)) {
        setActiveFilter('all');
        setListAddSelectedIds([]);
      }
    }
  }, [contactLists, activeFilter]);

  const handlePicturesUpdated = useCallback(
    (updates: Array<{ id: string; profilePicUrl: string }>) => {
      setPicOverrides((prev) => {
        const next = { ...prev };
        for (const u of updates) next[u.id] = u.profilePicUrl;
        return next;
      });
    },
    []
  );

  /** Abre a conversa deste contato no Atendimento (histórico existente ou rascunho). */
  const openInChat = useCallback((contact: Contact) => {
    const digits = (contact.phone || '').replace(/\D/g, '');
    if (!digits) {
      toast.error('Contato sem telefone válido.');
      return;
    }
    const existing = findBestConversationForPhone(deferredConversations, digits);
    if (existing?.id) {
      openChatByConversationIdNavigate(setCurrentView, existing.id);
      return;
    }
    const pic = (picOverrides[contact.id] || contact.profilePicUrl || '').trim();
    try {
      const payload = JSON.stringify({
        phone: digits,
        name: contact.name || '',
        profilePicUrl: pic
      });
      sessionStorage.setItem('zapmass.openChatByPhone', payload);
    } catch {
      /* ignore */
    }
    setCurrentView('chat');
  }, [setCurrentView, deferredConversations, picOverrides]);

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
    const religiousExtras = segment === 'religious' ? religiousExportColumns() : [];
    const header = buildContactExportHeaderLabels(religiousExtras);
    const rows = selected.map((c) => buildContactExportRow(c, religiousExtras));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = buildContactExportColWidths(religiousExtras);
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
    observacoes: 'notes', obs: 'notes', notes: 'notes',
    dataretorno: 'followUpAt', datadoretorno: 'followUpAt', retornoiso: 'followUpAt',
    followupat: 'followUpAt', followup: 'followUpAt', horaretorno: 'followUpAt',
    notaretorno: 'followUpNote', notadoretorno: 'followUpNote', followupnote: 'followUpNote'
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
      if (key === 'followUpAt') {
        const iso = parseImportFollowUpAt(raw);
        if (iso) data.followUpAt = iso;
        return;
      }
      const v = raw == null ? '' : String(raw).trim();
      if (!v) return;
      if (key === 'followUpNote') {
        data.followUpNote = v.slice(0, 500);
        return;
      }
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
    const phone = normalizeBRPhone(digits) || digits;
    return {
      id: `import_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      name: normalizeContactPersonName((data.name as string) || '', { stripPrefixes: true, titleCase: true }),
      phone,
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
      ...(data.followUpAt ? { followUpAt: data.followUpAt } : {}),
      ...(data.followUpNote ? { followUpNote: data.followUpNote } : {}),
      tags: data.tags && data.tags.length ? data.tags : ['Importado'],
      status: phone.replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID',
      lastMsg: 'Nunca'
    };
  };

  const vcfParsedToContact = (entry: ParsedVcfEntry, i: number): Contact => {
    const digits = (entry.phoneDigits || '').replace(/\D/g, '');
    const phone = normalizeBRPhone(digits) || digits;
    const zp = (entry.zipCode || '').replace(/\D/g, '').slice(0, 8);
    const zipCode = zp.length > 5 ? `${zp.slice(0, 5)}-${zp.slice(5)}` : zp;
    const zm = extractZapMassFollowFromVcfNotes(entry.notes || '');
    return {
      id: `import_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      name: normalizeContactPersonName(entry.name.trim(), { stripPrefixes: true, titleCase: true }),
      phone,
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
      notes: zm.cleanedNotes,
      ...(zm.followUpAt ? { followUpAt: zm.followUpAt } : {}),
      ...(zm.followUpNote ? { followUpNote: zm.followUpNote } : {}),
      tags: ['Importado', 'vCard'],
      status: phone.replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID',
      lastMsg: 'Nunca'
    };
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const lower = file.name.toLowerCase();
    const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    const PREVIEW_CHUNK = 280;

    try {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      let rows: any[][] = [];
      if (isExcel) {
        const buf = await file.arrayBuffer();
        await new Promise<void>((r) => setTimeout(r, 0));
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        await new Promise<void>((r) => setTimeout(r, 0));
        rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: '' });
      } else {
        const text = await file.text();
        const clean = text.replace(/\r/g, '');
        const firstLine = clean.split('\n')[0] || '';
        const delim = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
        rows = clean.split('\n').filter(Boolean).map((line) =>
          line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))
        );
      }

      rows = trimTrailingEmptySheetRows(rows);
      const truncated = truncateSheetRowsAtImportEndMarker(rows);
      rows = truncated.rows;

      if (rows.length < 2) {
        toast.error('Arquivo vazio ou sem dados.');
        return;
      }

      const rawHeaders = rows[0].map((h: any) => String(h || ''));
      const headerIndex = buildHeaderIndex(rawHeaders);
      const hasName = headerIndex.includes('name');
      const hasPhone = headerIndex.includes('phone');
      if (!hasName || !hasPhone) {
        toast.error('Arquivo invalido: nao encontrei colunas de Nome e/ou Telefone.');
        return;
      }

      fileImportDupBasisRef.current = buildFileImportDupBasis(contacts);
      const existingKeys = fileImportDupBasisRef.current.keys;
      const seenPhoneInFile = new Set<string>();
      const preview: FileImportRow[] = [];
      let nProb = 0;

      for (let start = 1; start < rows.length; start += PREVIEW_CHUNK) {
        const end = Math.min(start + PREVIEW_CHUNK, rows.length);
        for (let i = start; i < end; i++) {
          const contact = mapHeaderRowToContact(headerIndex, rows[i], i);
          const problems: string[] = [];
          // Validação via schema Zod — captura erros de formato em campos opcionais
          const zodResult = validateImportRow({
            name: contact.name,
            phone: contact.phone,
            email: contact.email ?? '',
            birthday: contact.birthday ?? '',
            state: contact.state ?? '',
            tags: contact.tags,
          });
          if (!zodResult.ok && 'errors' in zodResult) {
            for (const err of zodResult.errors) {
              if (!problems.includes(err)) problems.push(err);
            }
          }

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
            contact,
          });
        }
        await new Promise<void>((r) => setTimeout(r, 0));
      }

      setFileImportRows(preview);
      setFileImportLabel(file.name);
      setFileImportFilter('all');
      setFileImportTargetMode('none');
      setFileImportTargetListId('');
      setFileImportNewListName('');
      setFileImportDocked(false);
      setFileImportJob(null);
      setAutoFixProgress(null);
      setFileImportOpen(true);
      const markerHint = truncated.cutByMarker
        ? ` Marcador de fim na linha ${truncated.markerAtLine1Based} (${IMPORT_SHEET_END_MARKER}): tudo abaixo ignorado.`
        : '';
      toast.success(
        `Arquivo carregado: ${preview.length} linha(s).${markerHint}${nProb > 0 ? ` ${nProb} com aviso — revise antes de importar.` : ' Pronto para importar.'}`
      );
    } catch (err: unknown) {
      console.error('[ImportContacts]', err);
      toast.error('Falha ao ler o arquivo. Confira o formato e tente novamente.');
    }
  };

  const handleImportVcf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const PREVIEW_CHUNK = 280;
    try {
      const text = await file.text();
      await new Promise<void>((r) => setTimeout(r, 0));
      const entries = parseVcfText(text);
      if (entries.length === 0) {
        toast.error('Nenhum vCard (BEGIN:VCARD) encontrado no ficheiro.');
        return;
      }

      fileImportDupBasisRef.current = buildFileImportDupBasis(contacts);
      const existingKeys = fileImportDupBasisRef.current.keys;
      const seenPhoneInFile = new Set<string>();
      const preview: FileImportRow[] = [];
      let nProb = 0;

      for (let start = 0; start < entries.length; start += PREVIEW_CHUNK) {
        const end = Math.min(start + PREVIEW_CHUNK, entries.length);
        for (let i = start; i < end; i++) {
          const entry = entries[i];
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
          const include = problems.length === 0 && !duplicateRepeatedInFile && !duplicateAgainstBase;
          preview.push({
            id: `fip_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
            lineNumber: i + 1,
            include,
            contact,
          });
        }
        await new Promise<void>((r) => setTimeout(r, 0));
      }

      setFileImportRows(preview);
      setFileImportLabel(file.name);
      setFileImportFilter('all');
      setFileImportTargetMode('none');
      setFileImportTargetListId('');
      setFileImportNewListName('');
      setFileImportDocked(false);
      setFileImportJob(null);
      setAutoFixProgress(null);
      setFileImportOpen(true);
      toast.success(
        `${preview.length} contato(s) no vCard. ${nProb > 0 ? `${nProb} com aviso — revise antes de importar.` : 'Pronto para importar.'}`
      );
    } catch (err: unknown) {
      console.error('[ImportVcf]', err);
      toast.error('Falha ao ler o ficheiro .vcf. Confira o formato e tente novamente.');
    }
  };

  const ITEMS_PER_PAGE = 500;
  const { topTags, recentContacts } = useMemo(() => {
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
    return { topTags, recentContacts };
  }, [contacts]);

  /**
   * Temperatura por contato — cálculo pesado: roda após o 1º paint (idle) para não travar ao abrir a aba.
   * Enquanto vazio, contagens quente/morno/frio e filtros por temp assumem “ainda não calculado” (sem tratar todos como “novo”).
   */
  const [contactTemps, setContactTemps] = useState<Record<string, TempStats>>({});
  const [contactTempsReady, setContactTempsReady] = useState(false);
  const computeTempsGenRef = useRef(0);

  useEffect(() => {
    if (contactsLoadingMore || contacts.length === 0) {
      setContactTempsReady(false);
      return;
    }

    setContactTempsReady(false);
    const gen = ++computeTempsGenRef.current;
    const c = contacts;
    const conv = deferredConversations;

    const run = () => {
      if (gen !== computeTempsGenRef.current) return;
      const next = computeContactTemperatures(c, conv);
      if (gen !== computeTempsGenRef.current) return;
      setContactTemps(next);
      setContactTempsReady(true);
    };

    let idleId: ReturnType<typeof requestIdleCallback> | ReturnType<typeof setTimeout>;
    if (typeof requestIdleCallback !== 'undefined') {
      idleId = requestIdleCallback(run, { timeout: 2000 });
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
  }, [contacts, deferredConversations, contactsLoadingMore]);

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

  /** Uma passagem sobre `contacts`: stats do hero/sidebar que antes faziam ~15 filtros/reduces completos. */
  const smartStats = useMemo(() => {
    const today = new Date();
    const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const parseBirthday = (raw: string): { m: number; d: number } | null => {
      if (!raw) return null;
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return { m: parseInt(iso[2], 10), d: parseInt(iso[3], 10) };
      const br = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (br) return { m: parseInt(br[2], 10), d: parseInt(br[1], 10) };
      return null;
    };

    const DAY = 86400000;
    const now = Date.now();
    const startTodayMs = localStartOfTodayMs();

    let hot = 0;
    let warm = 0;
    let coldCount = 0;
    let newOnes = 0;
    let dormant = 0;
    let bdayToday = 0;
    let bdayWeek = 0;
    let weddingToday = 0;
    let weddingWeek = 0;
    let addressComplete = 0;
    let noCity = 0;
    let noTag = 0;
    let invalid = 0;
    let last7 = 0;
    let no_address = 0;
    let retorno_todos = 0;
    let retorno_atrasados = 0;
    let retorno_hoje = 0;
    let retorno_semana = 0;

    for (const c of contacts) {
      const b = parseBirthday(c.birthday || '');
      if (b) {
        const mm = String(b.m).padStart(2, '0');
        const dd = String(b.d).padStart(2, '0');
        if (`${mm}-${dd}` === todayMD) bdayToday++;
        let inWeek = false;
        for (let i = 0; i < 7; i++) {
          const dt = new Date(today);
          dt.setDate(dt.getDate() + i);
          if (b.m === dt.getMonth() + 1 && b.d === dt.getDate()) {
            inWeek = true;
            break;
          }
        }
        if (inWeek) bdayWeek++;
      }

      const clean = (c.phone || '').replace(/\D/g, '');
      if (clean.length >= 10) {
        if (contactWeddingMatchesToday(c, today)) weddingToday++;
        if (contactWeddingMatchesNextDays(c, 7, today)) weddingWeek++;
      }

      const t = contactTemps[c.id];
      const tp = t?.temp;
      if (tp === 'hot') hot++;
      else if (tp === 'warm') warm++;
      else if (tp === 'cold') coldCount++;
      else if (tp === 'new') newOnes++;

      if (t && t.sent > 0) {
        if (!t.lastReplyTs) {
          if (t.sent >= 2 && (now - t.lastSentTs) / DAY > 60) dormant++;
        } else {
          const dSinceReply = (now - t.lastReplyTs) / DAY;
          if (dSinceReply > 30 && dSinceReply <= 180) dormant++;
        }
      }

      if (c.street && c.number && c.neighborhood && c.city && c.state && c.zipCode) addressComplete++;

      if (!(c.city || '').trim()) noCity++;
      if ((c.tags || []).length === 0) noTag++;
      if (c.status !== 'VALID') invalid++;

      const idM = (c.id || '').match(/_(\d{13})_/);
      if (idM) {
        const ts = parseInt(idM[1], 10);
        if (Number.isFinite(ts) && now - ts < 7 * DAY) last7++;
      }

      if (!c.street || !c.city || !c.zipCode) no_address++;

      const fu = parseFollowUpMs(c.followUpAt);
      if (fu != null) {
        retorno_todos++;
        if (fu < startTodayMs) retorno_atrasados++;
        if (matchesRetornoFilter(fu, 'retorno_hoje')) retorno_hoje++;
        if (matchesRetornoFilter(fu, 'retorno_semana')) retorno_semana++;
      }
    }

    const addressPct =
      contacts.length === 0 ? 0 : Math.round((addressComplete / contacts.length) * 100);

    return {
      total: contacts.length,
      hot,
      warm,
      cold: coldCount,
      newOnes,
      dormant,
      bdayToday,
      bdayWeek,
      weddingToday,
      weddingWeek,
      addressComplete,
      addressPct,
      noCity,
      noTag,
      invalid,
      duplicates: duplicateContactsCount,
      last7,
      no_address,
      retorno_todos,
      retorno_atrasados,
      retorno_hoje,
      retorno_semana
    };
  }, [contacts, contactTemps, duplicateContactsCount]);

  // ============================================================
  //  SEGMENTOS INTELIGENTES — chips que aplicam filtros prontos
  // ============================================================
  type SmartSegmentId =
    | 'birthday-week'
    | 'wedding-week'
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
      case 'wedding-week':
        return contactWeddingMatchesNextDays(c, 7);
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

  useEffect(() => {
    if (segment !== 'religious') return;
    setActiveFilter((f) => (f === 'wedding_today' || f === 'wedding_week' ? 'all' : f));
    setActiveSegment((s) => (s === 'wedding-week' ? null : s));
  }, [segment]);

  const smartSegments: Array<{
    id: SmartSegmentId;
    label: string;
    icon: React.ElementType;
    count: number;
    color: string;
    hint: string;
  }> = useMemo(() => {
    const defs: Array<{ id: SmartSegmentId; label: string; icon: React.ElementType; color: string; hint: string }> =
      [
        { id: 'birthday-week', label: 'Aniversários (7d)', icon: Cake, color: 'amber', hint: 'Faça um envio personalizado' },
        ...(segment !== 'religious'
          ? []
          : [{ id: 'wedding-week' as const, label: 'Bodas de casamento (7d)', icon: Heart, color: 'rose', hint: 'Data na ficha de membro' }]),
        { id: 'hot-inactive', label: 'Quentes sem contato', icon: Flame, color: 'red', hint: 'Não perca o engajamento' },
        { id: 'cold-reactivation', label: 'Reativar frios', icon: Snowflake, color: 'sky', hint: 'Campanha de win-back' },
        { id: 'last-7-days', label: 'Novos (7d)', icon: Sparkles, color: 'emerald', hint: 'Acolhida para novatos' },
        { id: 'no-tag', label: 'Sem tag', icon: Tag, color: 'slate', hint: 'Organize sua base' },
        { id: 'no-address', label: 'Sem endereço', icon: MapPinOff, color: 'slate', hint: 'Complete os dados' },
        { id: 'duplicates', label: 'Duplicados', icon: Layers, color: 'violet', hint: 'Mescle ou exclua' },
        { id: 'invalid', label: 'Inválidos', icon: AlertCircle, color: 'rose', hint: 'Corrija os telefones' }
      ];
    const counts: Partial<Record<SmartSegmentId, number>> = {};
    for (const d of defs) counts[d.id] = 0;
    for (const c of contacts) {
      for (const d of defs) {
        if (getSmartSegmentMatches(d.id, c)) counts[d.id]!++;
      }
    }
    return defs.map((s) => ({ ...s, count: counts[s.id] ?? 0 }));
  }, [contacts, getSmartSegmentMatches, segment]);

  const fileImportRowsView = useMemo(() => {
    if (fileImportRows.length === 0) return [];
    const basis =
      fileImportOpen && !fileImportDocked && fileImportDupBasisRef.current
        ? fileImportDupBasisRef.current
        : buildFileImportDupBasis(contacts);
    return buildFileImportRowsViewFromDupBasis(fileImportRows, basis);
  }, [fileImportRows, contacts, fileImportOpen, fileImportDocked]);

  const fileImportUiCounts = useMemo(() => {
    const v = fileImportRowsView;
    let prob = 0;
    let dup = 0;
    let ready = 0;
    let includedReady = 0;
    for (const r of v) {
      if (r.problems.length > 0 || r.duplicate) prob++;
      if (r.duplicate) dup++;
      if (!r.duplicate && r.problems.length === 0) ready++;
      if (r.include && r.problems.length === 0) includedReady++;
    }
    return { prob, dup, ready, includedReady, total: v.length };
  }, [fileImportRowsView]);

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
    if (fileImportFilter === 'problem') return v.filter((r) => r.problems.length > 0 || r.duplicate);
    if (fileImportFilter === 'duplicate') return v.filter((r) => r.duplicate);
    if (fileImportFilter === 'ready') return v.filter((r) => !r.duplicate && r.problems.length === 0);
    return v;
  }, [fileImportRowsView, fileImportFilter]);

  const canSelectFileImportRow = useCallback(
    (r: FileImportRowView) => r.problems.length === 0 && !r.duplicateRepeatedInFile,
    []
  );

  const fileImportEligibleInFilter = useMemo(() => {
    if (filteredFileImportRows.length === 0) return { ids: [] as string[], total: 0 };
    const ids: string[] = [];
    for (const r of filteredFileImportRows) {
      if (!canSelectFileImportRow(r)) continue;
      ids.push(r.id);
    }
    return { ids, total: ids.length };
  }, [filteredFileImportRows, canSelectFileImportRow]);

  const fileImportAllEligibleSelected = useMemo(() => {
    if (fileImportEligibleInFilter.total === 0) return false;
    for (const r of filteredFileImportRows) {
      if (!canSelectFileImportRow(r)) continue;
      if (!r.include) return false;
    }
    return true;
  }, [filteredFileImportRows, canSelectFileImportRow, fileImportEligibleInFilter.total]);

  const toggleFileImportSelectAllEligible = useCallback(() => {
    const ids = fileImportEligibleInFilter.ids;
    if (ids.length === 0) return;
    const set = new Set(ids);
    setFileImportRows((prev) =>
      prev.map((row) => (set.has(row.id) ? { ...row, include: !fileImportAllEligibleSelected } : row))
    );
  }, [fileImportEligibleInFilter.ids, fileImportAllEligibleSelected]);

  const fileImportRowVirtualizer = useVirtualizer({
    count: filteredFileImportRows.length,
    getScrollElement: () => fileImportTableScrollRef.current,
    estimateSize: () => 52,
    overscan: 14,
  });

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
      case 'new': return t?.temp === 'new';
      case 'invalid': return c.status !== 'VALID';
      case 'no_address': return !c.street || !c.city || !c.zipCode;
      case 'duplicates': return phoneDupKeys.has(normPhoneKey(c.phone));
      case 'retorno_todos': {
        return parseFollowUpMs(c.followUpAt) != null;
      }
      case 'retorno_atrasados':
      case 'retorno_hoje':
      case 'retorno_semana': {
        const ms = parseFollowUpMs(c.followUpAt);
        return ms != null && matchesRetornoFilter(ms, filter);
      }
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
      case 'wedding_today':
        return contactWeddingMatchesToday(c);
      case 'wedding_week':
        return contactWeddingMatchesNextDays(c, 7);
      case 'no_list':
        return !contactIdsInAnyList.has(c.id);
      default: return true;
    }
  }, [contactLists, contactTemps, phoneDupKeys, contactIdsInAnyList]);

  // Filter Logic — memoizado: antes rodava filtro completo em todo re-render (digitar, modal, etc.).
  const filteredContacts = useMemo(() => {
    const q = deferredSearchTerm.toLowerCase();
    // Caminho rápido: sem busca nem critérios — evita uma passagem de O(n) em bases enormes ao abrir a aba.
    if (
      !q &&
      filterStatus === 'ALL' &&
      !filterTag &&
      filterTemp === 'ALL' &&
      !activeSegment &&
      activeFilter === 'all'
    ) {
      return contacts;
    }
    return contacts.filter((c) => {
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(deferredSearchTerm) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        (c.city?.toLowerCase().includes(q) ?? false) ||
        (c.state?.toLowerCase().includes(q) ?? false) ||
        (c.street?.toLowerCase().includes(q) ?? false) ||
        (c.neighborhood?.toLowerCase().includes(q) ?? false) ||
        (c.zipCode?.toLowerCase().includes(q) ?? false) ||
        (c.church?.toLowerCase().includes(q) ?? false) ||
        (c.role?.toLowerCase().includes(q) ?? false) ||
        (c.profession?.toLowerCase().includes(q) ?? false) ||
        (c.followUpNote?.toLowerCase().includes(q) ?? false) ||
        (c.religiousMemberProfile?.spouseName?.toLowerCase().includes(q) ?? false) ||
        (c.religiousMemberProfile?.weddingDate?.toLowerCase().includes(q) ?? false);
      const matchesStatus = filterStatus === 'ALL' || c.status === filterStatus;
      const matchesTag = !filterTag || c.tags.some((t) => t.toLowerCase() === filterTag.toLowerCase());
      const matchesTemp = filterTemp === 'ALL' || contactTemps[c.id]?.temp === filterTemp;
      const matchesSegment = !activeSegment || getSmartSegmentMatches(activeSegment, c);
      const matchesSmart = matchesSmartFilter(c, activeFilter);
      return matchesSearch && matchesStatus && matchesTag && matchesTemp && matchesSegment && matchesSmart;
    });
  }, [
    contacts,
    deferredSearchTerm,
    filterStatus,
    filterTag,
    filterTemp,
    activeSegment,
    activeFilter,
    contactTemps,
    matchesSmartFilter,
    getSmartSegmentMatches
  ]);

  const listFilteredContacts = useMemo(() => {
    const isRetorno =
      activeFilter === 'retorno_todos' ||
      activeFilter === 'retorno_atrasados' ||
      activeFilter === 'retorno_hoje' ||
      activeFilter === 'retorno_semana';
    if (isRetorno) {
      return [...filteredContacts].sort((a, b) => {
        const ta = parseFollowUpMs(a.followUpAt) ?? Infinity;
        const tb = parseFollowUpMs(b.followUpAt) ?? Infinity;
        return ta - tb;
      });
    }
    if (activeFilter === 'wedding_today' || activeFilter === 'wedding_week') {
      return [...filteredContacts].sort((a, b) => {
        const ma = parseWeddingDayMonth(a.religiousMemberProfile?.weddingDate);
        const mb = parseWeddingDayMonth(b.religiousMemberProfile?.weddingDate);
        if (!ma) return 1;
        if (!mb) return -1;
        return daysUntilWeddingAnniversary(ma) - daysUntilWeddingAnniversary(mb);
      });
    }
    return filteredContacts;
  }, [filteredContacts, activeFilter]);

  // Pagination Logic
  const totalAvailable = useMemo(() => {
    // Se o filtro for "Todos" e sem busca ativa, usamos o total real da base —
    // mas só quando já há contatos carregados (evita totalPages=423 com contacts=[])
    if (activeFilter === 'all' && !searchTerm.trim() && contactsSavedTotal != null && contacts.length > 0) {
      return contactsSavedTotal;
    }
    // Caso contrário, usamos o que temos carregado (já que filtros locais só funcionam no que está em memória)
    return listFilteredContacts.length;
  }, [activeFilter, searchTerm, contactsSavedTotal, listFilteredContacts.length]);

  const totalPages = Math.max(1, Math.ceil(totalAvailable / ITEMS_PER_PAGE));
  const paginatedContacts = useMemo(
    () =>
      listFilteredContacts.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
    [listFilteredContacts, currentPage, ITEMS_PER_PAGE]
  );

  const tableContacts = useMemo(
    () =>
      paginatedContacts.map((c) => {
        const pic = picOverrides[c.id] || c.profilePicUrl;
        return pic && pic !== c.profilePicUrl ? { ...c, profilePicUrl: pic } : c;
      }),
    [paginatedContacts, picOverrides]
  );

  const contactImportBusy =
    fileImportJob?.phase === 'import' ||
    fileImportJob?.phase === 'autofix' ||
    fileImportJob?.phase === 'list';

  useContactPicturePrefetch(
    paginatedContacts,
    paginatedContacts.length > 0 && !contactImportBusy,
    handlePicturesUpdated
  );
  const allPageSelected =
    paginatedContacts.length > 0 && paginatedContacts.every((c) => selectedIds.includes(c.id));

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPage(newPage);
      
      // Se estamos indo para uma página que ainda não foi carregada completamente, 
      // e temos mais contatos na base, ativa o auto-carregamento.
      const neededCount = newPage * ITEMS_PER_PAGE;
      if (neededCount > contacts.length && contactsHasMore) {
        setAutoLoadActive(true);
      }
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
      setListAddSelectedIds([]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao remover.';
      toast.error(msg);
    }
  };

  const beginEditContact = (contact: Contact) => {
    setEditingContactId(contact.id);
    setCepLookupState('idle');
    setFollowUpDatetimeLocal(isoToDatetimeLocal(contact.followUpAt));
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
      birthday: storedDateToBrDisplay(contact.birthday || ''),
      email: contact.email || '',
      notes: contact.notes || '',
      followUpNote: contact.followUpNote || ''
    });
    setReligiousMemberForm(segment === 'religious' ? contactToMemberForm(contact) : emptyForm());
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
      ['Maria Silva', '5511999998888', '1990-03-15', 'maria@exemplo.com', 'Av. Paulista', '1578', 'Bela Vista', 'Sao Paulo', 'SP', '01310-200', 'Batista Lagoinha', 'Lider de Celula', 'Dentista', 'VIP;Novos', '2026-05-15T18:00:00.000Z', 'Ligar para confirmar reuniao', ''],
      ['Joao Santos', '5521988887777', '', 'joao@exemplo.com', 'Rua das Flores', '42', 'Copacabana', 'Rio de Janeiro', 'RJ', '22010-000', '', 'Membro', 'Professor', '', '', '', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
    ws['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: c.width }));

    // Marca a celula de cabecalho em negrito (ref: SheetJS nao aplica estilos na community,
    // mas a primeira linha ja funciona como cabecalho ao abrir no Excel).
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');

    const crmRefSheet = [
      ['Coluna (apenas na exportacao)', 'Descricao'],
      ...CAMPAIGN_EXPORT_COLUMNS.map((col) => [
        col.label,
        'Gerado pelo ZapMass ao exportar base, selecao ou lista. Na importacao, o cabecalho nao e mapeado — a coluna e ignorada. Voce pode apagar essas colunas se reutilizar um arquivo exportado.'
      ])
    ];
    const wsCrmRef = XLSX.utils.aoa_to_sheet(crmRefSheet);
    wsCrmRef['!cols'] = [{ wch: 36 }, { wch: 72 }];
    XLSX.utils.book_append_sheet(wb, wsCrmRef, 'Referencia_CRM');

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
      ['8. Data retorno (opcional): ISO 8601 (ex.: 2026-05-15T18:00:00.000Z), numero de data do Excel, ou texto dd/mm/aaaa com hora opcional.'],
      ['9. Nota retorno: texto curto; opcional.'],
      ['10. Campos vazios sao permitidos, basta deixar a celula em branco.'],
      [''],
      [
        `11. Fim dos dados (evita carregar milhoes de linhas vazias do Excel): na coluna «Nome», numa linha sozinha, escreva exactamente ${IMPORT_SHEET_END_MARKER} — essa linha e tudo o que estiver abaixo e ignorado na importacao.`
      ],
      [''],
      [
        '12. A folha «Contatos» deste arquivo contem so colunas importaveis. Ja a exportacao completa (ou selecao/lista) no app pode acrescentar colunas de CRM/disparos — veja a folha «Referencia_CRM». Se voltar a importar um arquivo exportado, o ZapMass ignora colunas nao reconhecidas; opcionalmente apague-as antes.'
      ],
      ...(segment === 'religious'
        ? [
            [''],
            [
              '13. Segmento religioso: a exportacao da base pode incluir colunas da ficha (RG, dados eclesiasticos, etc.). Na importacao, so entram colunas que o mapa reconhece — o resto e ignorado, como as de CRM.'
            ]
          ]
        : [])
    ];
    const wsNotes = XLSX.utils.aoa_to_sheet(notes);
    wsNotes['!cols'] = [{ wch: 88 }];
    XLSX.utils.book_append_sheet(wb, wsNotes, 'Instrucoes');

    XLSX.writeFile(wb, 'modelo_importacao_zapmass.xlsx');
    toast.success('Modelo XLSX baixado (folha Contatos + Referencia_CRM + Instrucoes).');
  };

  const handleExport = () => {
    const religiousExtras = segment === 'religious' ? religiousExportColumns() : [];
    const header = buildContactExportHeaderLabels(religiousExtras);
    const rows = contacts.map((c) => buildContactExportRow(c, religiousExtras));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = buildContactExportColWidths(religiousExtras);
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
      try {
        await appendContactIdsToContactList(selectedListId, contactIds, {
          notesLine: `Atualizada por ${originLabel} em ${new Date().toLocaleString()}`,
        });
        return { attached: contactIds.length, listName: target?.name || 'Lista' };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // Se a lista escolhida for "legada" (raiz) ela pode existir no UI mas não em `users/{uid}/contact_lists`.
        // Neste caso criamos uma cópia no escopo do usuário e vinculamos nela (evita "importou mas não foi pra lista").
        if (msg.toLowerCase().includes('lista não encontrada')) {
          const legacyName = (target?.name || '').trim() || 'Lista';
          const createdId = await createContactList(
            legacyName,
            [],
            `Lista migrada automaticamente durante ${originLabel} em ${new Date().toLocaleString()}`
          );
          await appendContactIdsToContactList(createdId, contactIds, {
            notesLine: `Atualizada por ${originLabel} em ${new Date().toLocaleString()}`,
          });
          setFileImportTargetListId(createdId);
          toast.success(`Lista "${legacyName}" foi migrada e atualizada.`);
          return { attached: contactIds.length, listName: legacyName };
        }
        throw e;
      }
    }
    const listName = newListName.trim();
    if (!listName) throw new Error('Informe o nome da nova lista.');
    await createContactList(listName, contactIds, `Lista criada por ${originLabel} com ${contactIds.length} contato(s).`);
    return { attached: contactIds.length, listName };
  }, [contactLists, createContactList, appendContactIdsToContactList]);

  const autoFixFileImportRows = useCallback(async () => {
    const prevRows = fileImportRowsRef.current;
    if (fileImportPipelineBusyRef.current) {
      toast.error('Importação em curso — aguarde ou use «Confirmar importação» para enfileirar outro arquivo.');
      return;
    }
    if (autoFixRunLockRef.current || prevRows.length === 0) return;
    autoFixRunLockRef.current = true;
    const before = buildFileImportRowsViewFromState(prevRows, contacts);
    const beforeStrictProb = before.filter((r) => r.problems.length > 0).length;
    const beforeDup = before.filter((r) => r.duplicate).length;
    setAutoFixProgress({ percent: 0, message: 'A iniciar correção automática…' });
    try {
      const next = await batchedNormalizeFileImportRows(prevRows, contacts, (pct, label) => {
        setAutoFixProgress({ percent: pct, message: label || 'A normalizar…' });
      });
      setFileImportRows(next);
      const after = buildFileImportRowsViewFromState(next, contacts);
      const afterStrictProb = after.filter((r) => r.problems.length > 0).length;
      const afterDup = after.filter((r) => r.duplicate).length;
      let tweaked = 0;
      for (let i = 0; i < prevRows.length; i++) {
        const a = prevRows[i];
        const b = next[i];
        if (
          a.contact.phone !== b.contact.phone ||
          a.contact.name !== b.contact.name ||
          a.contact.state !== b.contact.state ||
          a.include !== b.include
        ) {
          tweaked++;
        }
      }
      if (tweaked === 0 && beforeStrictProb === afterStrictProb && beforeDup === afterDup) {
        toast(
          'Nada mudou nos dados guardados. «Na base» não some sozinho: é o mesmo telefone do CRM (a correção só unifica formato, ex. 048… → 55…). Repetidos no arquivo não são apagados.'
        );
      } else {
        toast.success(
          `Correção automática: ${tweaked} linha(s) atualizada(s). Avisos (nome/telefone): ${beforeStrictProb} → ${afterStrictProb}. Linhas com duplicado (base ou arquivo): ${beforeDup} → ${afterDup}. «Na base» mantém-se se o número continuar a coincidir com o CRM.`
        );
      }
    } catch (err) {
      console.error('[autoFixFileImportRows]', err);
      toast.error('Falha na correção automática.');
    } finally {
      autoFixRunLockRef.current = false;
      setAutoFixProgress(null);
    }
  }, [contacts]);

  const runSingleFileImportPayload = useCallback(
    async (job: FileImportQueuedPayload, queuedBehind: number): Promise<void> => {
      const snapshotRows = job.snapshotRows;
      const baseMap = buildContactByPhoneKeyMap(contactsRef.current);
      for (const [k, c] of fileImportPipelineContactsMergeRef.current) {
        baseMap.set(k, c);
      }
      const contactsForNormalize = Array.from(baseMap.values());

      const patchQueued = (partial: FileImportJob): void => {
        setFileImportJob({ ...partial, queuedBehind });
      };

      patchQueued({
        phase: 'autofix',
        percent: 0,
        current: 0,
        total: snapshotRows.length,
        message: 'A normalizar (correção automática) antes de importar…',
      });

      try {
        const workingRows = await batchedNormalizeFileImportRows(snapshotRows, contactsForNormalize, (pct, label) => {
          patchQueued({
            phase: 'autofix',
            percent: pct,
            current: Math.round((pct / 100) * snapshotRows.length),
            total: snapshotRows.length,
            message: label || 'A normalizar…',
          });
        });

        const view = buildFileImportRowsViewFromState(workingRows, contactsForNormalize);
        const localByKey = new Map(baseMap);
        const touchedIds = new Set<string>();
        let added = 0;
        let merged = 0;
        let skippedProb = 0;
        const totalImport = Math.max(1, view.filter((rv) => rv.include && rv.problems.length === 0).length);
        let importDone = 0;
        patchQueued({
          phase: 'import',
          percent: 0,
          current: 0,
          total: totalImport,
          message: 'A importar contatos — pode continuar a usar o sistema.',
        });
        const FIRE_BATCH = 400;
        const pendingCreates: Contact[] = [];
        const pendingUpdates: Array<{ id: string; updates: Partial<Contact> }> = [];
        const pendingCreateKeys = new Set<string>();

        const yieldImportUi = () =>
          new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

        const flushCreates = async () => {
          if (pendingCreates.length === 0) return;
          const slice = pendingCreates.splice(0, pendingCreates.length);
          for (const c of slice) {
            const kk = normPhoneKey(c.phone);
            if (kk) pendingCreateKeys.delete(kk);
          }
          const ids = await bulkAddContacts(slice, { silent: true, skipReload: true });
          await yieldImportUi();
          for (let idx = 0; idx < ids.length; idx++) {
            const incoming = slice[idx];
            const kk = normPhoneKey(incoming.phone);
            if (!kk) continue;
            localByKey.set(kk, { ...incoming, id: ids[idx] });
            touchedIds.add(ids[idx]);
            added++;
          }
          await new Promise<void>((r) => setTimeout(r, 40));
        };

        const flushUpdates = async () => {
          if (pendingUpdates.length === 0) return;
          const slice = pendingUpdates.splice(0, pendingUpdates.length);
          await bulkUpdateContacts(slice, { silent: true, skipReload: true });
          await yieldImportUi();
          await new Promise<void>((r) => setTimeout(r, 40));
        };

        for (const rv of view) {
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
            tags: (rv.contact.tags || []).length > 0 ? rv.contact.tags : ['Importado'],
          };

          let existing = localByKey.get(k);
          if (!existing && pendingCreateKeys.has(k)) {
            await flushCreates();
            existing = localByKey.get(k);
          }

          if (existing) {
            const mergedPayload = mergeContactData(existing, incoming, ['Importado']);
            const nextExisting: Contact = { ...existing, ...mergedPayload };
            localByKey.set(k, nextExisting);
            touchedIds.add(existing.id);
            merged++;
            pendingUpdates.push({ id: existing.id, updates: mergedPayload });
            importDone++;
            if (pendingUpdates.length >= FIRE_BATCH) await flushUpdates();
          } else {
            pendingCreates.push(incoming);
            pendingCreateKeys.add(k);
            importDone++;
            if (pendingCreates.length >= FIRE_BATCH) await flushCreates();
          }

          patchQueued({
            phase: 'import',
            percent: Math.min(99, Math.round((100 * importDone) / totalImport)),
            current: importDone,
            total: totalImport,
            message: `A importar contatos (${importDone} de ${totalImport})…`,
          });
          if (importDone % 40 === 0) {
            await new Promise<void>((r) => setTimeout(r, 0));
          }
        }

        await flushCreates();
        await flushUpdates();
        await refreshContacts();
        let attached = 0;
        let listName = '';
        const importIds = Array.from(touchedIds);
        if (importIds.length > 0 && job.targetMode !== 'none') {
          patchQueued({
            phase: 'list',
            percent: 99,
            current: importIds.length,
            total: importIds.length,
            message: 'A atualizar a lista de destino…',
          });
          const result = await attachContactsToList(
            importIds,
            job.targetMode,
            job.targetListId,
            job.newListName,
            'importação de arquivo'
          );
          attached = result.attached;
          listName = result.listName || '';
        }
        fileImportPipelineContactsMergeRef.current = localByKey;

        toast.success(
          `${added} contato(s) novo(s).` +
            (merged ? ` ${merged} contato(s) unificado(s).` : '') +
            (skippedProb ? ` ${skippedProb} com problema não importado(s).` : '') +
            (attached > 0 ? ` ${attached} vinculado(s) em "${listName}".` : '')
        );

        const stillQueued = fileImportQueueRef.current.length > 0;
        if (!stillQueued) {
          patchQueued({
            phase: 'done',
            percent: 100,
            current: totalImport,
            total: totalImport,
            message: 'Importação concluída.',
          });
          await new Promise((r) => setTimeout(r, 900));
        } else {
          await new Promise((r) => setTimeout(r, 120));
        }
      } catch (err: unknown) {
        console.error('[runSingleFileImportPayload]', err);
        const pendingDrop = fileImportQueueRef.current.length;
        fileImportQueueRef.current = [];
        const msg = err instanceof Error ? err.message : 'Falha ao importar.';
        toast.error(msg);
        if (pendingDrop > 0) {
          toast.error(`${pendingDrop} importação(ões) foram retiradas da fila devido ao erro.`);
        }
        patchQueued({
          phase: 'error',
          percent: 0,
          current: 0,
          total: 0,
          message: 'Erro na importação',
          error: msg,
          queuedBehind: 0,
        });
        await new Promise((r) => setTimeout(r, 2200));
        throw err;
      }
    },
    [bulkAddContacts, bulkUpdateContacts, refreshContacts, attachContactsToList]
  );

  const executeFileImportConfirm = useCallback(async () => {
    if (autoFixProgress !== null) {
      toast.error('Aguarde a correção automática terminar.');
      return;
    }
    if (fileImportTargetMode === 'existing' && !fileImportTargetListId) {
      toast.error('Escolha uma lista de destino.');
      return;
    }
    if (fileImportTargetMode === 'new' && !fileImportNewListName.trim()) {
      toast.error('Informe o nome da nova lista.');
      return;
    }
    const snapshotRows = fileImportRowsRef.current;
    if (snapshotRows.length === 0) return;
    const viewPreview = buildFileImportRowsViewFromState(snapshotRows, contacts);
    const nToImport = viewPreview.filter((rv) => rv.include && rv.problems.length === 0).length;
    if (nToImport === 0) {
      toast.error('Nenhuma linha válida selecionada para importar.');
      return;
    }

    const payload: FileImportQueuedPayload = {
      snapshotRows: cloneFileImportRowsSnapshot(snapshotRows),
      label: (fileImportLabel || '').trim() || 'Importação',
      targetMode: fileImportTargetMode,
      targetListId: fileImportTargetListId,
      newListName: fileImportNewListName,
    };

    const resetFileImportModalAfterConfirm = () => {
      setFileImportOpen(false);
      setFileImportRows([]);
      setFileImportFilter('all');
      setFileImportTargetMode('none');
      setFileImportTargetListId('');
      setFileImportNewListName('');
    };

    if (fileImportPipelineBusyRef.current) {
      fileImportQueueRef.current.push(payload);
      toast.success(
        `"${payload.label}" na fila (${fileImportQueueRef.current.length}). Será importada após a atual.`
      );
      resetFileImportModalAfterConfirm();
      return;
    }

    fileImportPipelineBusyRef.current = true;
    fileImportPipelineContactsMergeRef.current.clear();
    setFileImportDocked(true);
    setFileImportLabel(payload.label);
    resetFileImportModalAfterConfirm();

    try {
      let job: FileImportQueuedPayload | undefined = payload;
      while (job) {
        const behind = fileImportQueueRef.current.length;
        setFileImportLabel(job.label);
        await runSingleFileImportPayload(job, behind);
        job = fileImportQueueRef.current.shift();
      }
    } finally {
      fileImportPipelineBusyRef.current = false;
      fileImportPipelineContactsMergeRef.current.clear();
      setFileImportDocked(false);
      setFileImportJob(null);
      setFileImportLabel('');
    }
  }, [
    contacts,
    autoFixProgress,
    fileImportTargetMode,
    fileImportTargetListId,
    fileImportNewListName,
    fileImportLabel,
    runSingleFileImportPayload,
  ]);

  const handleSaveNewContact = async () => {
    try {
    const canonicalName =
      normalizeContactPersonName((newContact.name || '').trim(), {
        stripPrefixes: true,
        titleCase: true
      }) || '';
    if (!canonicalName || !(newContact.phone || '').trim()) {
      toast.error('Preencha ao menos Nome e WhatsApp.');
      return;
    }
    const cleanPhone = (newContact.phone || '').replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      toast.error('Informe um WhatsApp válido com DDD (mínimo 10 dígitos).');
      return;
    }
    if (newContactTargetMode === 'existing' && !newContactTargetListId) {
      toast.error('Escolha uma lista de destino.');
      return;
    }
    if (newContactTargetMode === 'new' && !newContactNewListName.trim()) {
      toast.error('Informe o nome da nova lista.');
      return;
    }

    const followUpIso = datetimeLocalToUtcIso(followUpDatetimeLocal);
    const followNote = (newContact.followUpNote || '').trim().slice(0, 500);

    const mergedRm: MemberFormState =
      segment === 'religious'
        ? {
            ...religiousMemberForm,
            name: canonicalName,
            phone: newContact.phone || '',
            email: newContact.email || '',
            church: newContact.church || '',
            birthday: newContact.birthday || '',
            profession: newContact.profession || '',
            street: newContact.street || '',
            number: newContact.number || '',
            neighborhood: newContact.neighborhood || '',
            zipCode: newContact.zipCode || '',
            city: newContact.city || '',
            state: newContact.state || '',
            notes: newContact.notes || ''
          }
        : emptyForm();

    const rolePayload =
      segment === 'religious'
        ? (() => {
            const cb = mergedRm.ministerRoles.length > 0 ? mergedRm.ministerRoles.join(', ') : '';
            return [cb, mergedRm.roleFree.trim()].filter(Boolean).join(' · ') || '';
          })()
        : (newContact.role || '').trim();

    const religiousPayload = segment === 'religious' ? buildReligiousProfileComplete(mergedRm) : null;

    if (editingContactId) {
      const patch: Partial<Contact> = {
        name: canonicalName,
        phone: cleanPhone,
        city: newContact.city || '',
        state: newContact.state || '',
        street: newContact.street || '',
        number: newContact.number || '',
        neighborhood: newContact.neighborhood || '',
        zipCode: newContact.zipCode || '',
        ...(segment === 'religious'
          ? { church: newContact.church || '', role: rolePayload }
          : {}),
        profession: newContact.profession || '',
        birthday: newContact.birthday || '',
        email: newContact.email || '',
        notes: newContact.notes || '',
        status: cleanPhone.length >= 10 ? 'VALID' : 'INVALID',
        followUpAt: followUpIso ?? '',
        followUpNote: followNote || ''
      };
      if (religiousPayload) {
        patch.religiousMemberProfile = hasReligiousProfileData(religiousPayload) ? religiousPayload : {};
      }
      await updateContact(editingContactId, patch);
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
        name: canonicalName,
        phone: cleanPhone,
        city: newContact.city,
        state: newContact.state,
        street: newContact.street,
        number: newContact.number,
        neighborhood: newContact.neighborhood,
        zipCode: newContact.zipCode,
        ...(segment === 'religious'
          ? { church: newContact.church || '', role: rolePayload }
          : {}),
        profession: newContact.profession,
        birthday: newContact.birthday,
        email: newContact.email,
        notes: newContact.notes,
        ...(followUpIso ? { followUpAt: followUpIso } : {}),
        ...(followNote ? { followUpNote: followNote } : {}),
        tags: ['Novo'],
        status: cleanPhone.length >= 10 ? 'VALID' : 'INVALID',
        lastMsg: 'Nunca',
        ...(religiousPayload && hasReligiousProfileData(religiousPayload)
          ? { religiousMemberProfile: religiousPayload }
          : {})
      };
      const existingByPhone = contactByPhoneKey.get(normPhoneKey(cleanPhone));
      let targetContactId = '';
      if (existingByPhone) {
        const mergedPayload = mergeContactData(existingByPhone, incomingContact, ['Novo']);
        if (segment === 'religious' && religiousPayload && hasReligiousProfileData(religiousPayload)) {
          mergedPayload.religiousMemberProfile = mergeReligiousProfile(
            existingByPhone.religiousMemberProfile,
            religiousPayload
          );
        }
        await updateContact(existingByPhone.id, mergedPayload);
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
    setFollowUpDatetimeLocal('');
    setNewContact({ name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '', church: '', role: '', profession: '', birthday: '', email: '', notes: '', followUpNote: '' }); setReligiousMemberForm(emptyForm());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar o contato.';
      toast.error(msg);
    }
  };

  const managedListForView = useMemo(() => {
    if (!activeFilter.startsWith('list:')) return null;
    const id = activeFilter.slice(5);
    return contactLists.find((l) => l.id === id) ?? null;
  }, [contactLists, activeFilter]);

  const manageListMembers = useMemo(() => {
    const list = managedListForView;
    if (!list?.contactIds) return [] as Contact[];
    return contacts
      .filter((c) => listHasContact(list.contactIds, c))
      .filter((c) => contactMatchesQuickSearch(c, listMemberSearch))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, managedListForView, listMemberSearch]);

  const managedListMissingCount = useMemo(() => {
    const list = managedListForView;
    if (!list?.contactIds?.length) return 0;
    // Com paginação, pode haver IDs na lista que ainda não estão carregados em `contacts`.
    const loadedSet = new Set(contacts.map((c) => c.id));
    let missing = 0;
    for (const id of list.contactIds) if (!loadedSet.has(id)) missing++;
    return missing;
  }, [managedListForView, contacts]);

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
        const religiousExtras = segment === 'religious' ? religiousExportColumns() : [];
        const header = buildContactExportHeaderLabels(religiousExtras);
        const rows = withPhone.map((c) => buildContactExportRow(c, religiousExtras));
        const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
        ws['!cols'] = buildContactExportColWidths(religiousExtras);
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
    [managedListForView, contacts, segment]
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
                setFollowUpDatetimeLocal('');
                setNewContact({ name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '', church: '', role: '', profession: '', birthday: '', email: '', notes: '', followUpNote: '' }); setReligiousMemberForm(emptyForm());
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
      'wedding-week': 'wedding_week',
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

  const handleWeddingCampaign = useCallback((people: Contact[]) => {
    const name = people.length === 1 ? `Bodas: ${people[0].name}` : `Bodas de casamento (${people.length})`;
    const draft = buildDraftFromContacts(people, name);
    if (!draft) { toast.error('Sem telefones válidos nestes contatos.'); return; }
    launchCampaignWithDraft(draft, 'Abrindo campanha de bodas…');
  }, [buildDraftFromContacts, launchCampaignWithDraft]);

  const handleCreateCampaignWithFiltered = useCallback(() => {
    const draft = buildDraftFromContacts(filteredContacts, `Campanha (${filteredContacts.length} contatos)`);
    if (!draft) { toast.error('Nenhum contato no filtro atual.'); return; }
    launchCampaignWithDraft(draft);
  }, [buildDraftFromContacts, launchCampaignWithDraft, filteredContacts]);

  /** Contadores da sidebar — agregados em `smartStats` (uma passagem sobre a base). */
  const sidebarCounts: SidebarCounts = useMemo(
    () => ({
      all: smartStats.total,
      hot: smartStats.hot,
      warm: smartStats.warm,
      cold: smartStats.cold,
      new: smartStats.newOnes,
      bday_today: smartStats.bdayToday,
      bday_week: smartStats.bdayWeek,
      wedding_today: smartStats.weddingToday,
      wedding_week: smartStats.weddingWeek,
      dormant: smartStats.dormant,
      invalid: smartStats.invalid,
      no_address: smartStats.no_address,
      duplicates: smartStats.duplicates,
      retorno_todos: smartStats.retorno_todos,
      retorno_atrasados: smartStats.retorno_atrasados,
      retorno_hoje: smartStats.retorno_hoje,
      retorno_semana: smartStats.retorno_semana,
      no_list: noListCount
    }),
    [smartStats, noListCount]
  );

  /** Stats enxutas para o HeaderBar (sem sparklines, sem grids pesados). */
  const headerStats = useMemo(
    () => ({
      total: smartStats.total,
      valid: smartStats.total - smartStats.invalid,
      newLast7: smartStats.last7,
      hot: smartStats.hot,
      bdayToday: smartStats.bdayToday,
      weddingWeek: smartStats.weddingWeek
    }),
    [smartStats]
  );

  /** Contato em destaque (drawer) — tempStats equivalente. */
  const selectedContactTemps = selectedContact
    ? (contactTemps[selectedContact.id] ?? CONTACT_TEMP_DEFAULT)
    : undefined;

  const selectedContactForDrawer = useMemo(() => {
    if (!selectedContact) return null;
    const pic = picOverrides[selectedContact.id];
    return pic ? { ...selectedContact, profilePicUrl: pic } : selectedContact;
  }, [selectedContact, picOverrides]);

  useEffect(() => {
    if (!selectedContact) return;
    const fresh = contacts.find((c) => c.id === selectedContact.id);
    if (!fresh) {
      setSelectedContact(null);
      return;
    }
    setSelectedContact(fresh);
  }, [contacts, selectedContact?.id]);

  const handleOpenList = useCallback((listId: string) => {
    const list = contactLists.find((l) => l.id === listId);
    setActiveFilter(`list:${listId}`);
    setSelectedIds([]);
    setListManageSubTab((list?.contactIds?.length || 0) === 0 ? 'add' : 'members');
    setListAddSelectedIds([]);
    setListMemberSearch('');
    setListAddSearch('');
  }, [contactLists]);

  const handleSelectSmartFilter = useCallback((id: SmartFilterId) => {
    if (id.startsWith('list:')) {
      handleOpenList(id.slice(5));
      return;
    }
    if (id === 'no_list') {
      setListsUiFocus('tab');
    }
    setActiveFilter(id);
    setSelectedIds([]);
    setListAddSelectedIds([]);
    setCurrentPage(1);
  }, [handleOpenList]);

  const handleManageList = handleOpenList;

  const handleCreateListQuick = useCallback(async (name: string) => {
    try {
      const id = await createContactList(name, []);
      toast.success(`Lista "${name}" criada.`);
      handleOpenList(id);
    } catch {
      toast.error('Não foi possível criar a lista.');
    }
  }, [createContactList, handleOpenList]);

  const activeListName = useMemo(() => {
    if (!activeFilter.startsWith('list:')) return undefined;
    const listId = activeFilter.slice(5);
    return contactLists.find((l) => l.id === listId)?.name;
  }, [activeFilter, contactLists]);

  const handleRowClick = useCallback((c: Contact) => {
    setSelectedContact(c);
  }, []);

  const handleToggleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const handleToggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const visible = listFilteredContacts.map((c) => c.id);
      const allSelected = visible.length > 0 && visible.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !visible.includes(id));
      const union = new Set([...prev, ...visible]);
      return Array.from(union);
    });
  }, [listFilteredContacts]);

  const openPickListModal = useCallback(
    (payload: { mode: 'single'; contact: Contact } | { mode: 'bulk'; contactIds?: string[] }) => {
      if (contactLists.length === 0) {
        toast.error('Crie uma lista primeiro na sidebar.');
        return;
      }
      setPickListTargetId((prev) => {
        const keep = prev && contactLists.some((l) => l.id === prev);
        return keep ? prev : contactLists[0].id;
      });
      setPickListPayload(payload);
    },
    [contactLists]
  );

  const handleAddAllFilteredToList = useCallback(() => {
    const ids = listFilteredContacts.map((c) => c.id).filter(Boolean);
    if (ids.length === 0) {
      toast.error('Nenhum contato neste filtro.');
      return;
    }
    openPickListModal({ mode: 'bulk', contactIds: ids });
  }, [listFilteredContacts, openPickListModal]);

  const handleBulkAddToList = useCallback(() => {
    if (selectedIds.length === 0) return;
    openPickListModal({ mode: 'bulk' });
  }, [openPickListModal, selectedIds.length]);

  const handleAddSingleToList = useCallback(
    (c: Contact) => openPickListModal({ mode: 'single', contact: c }),
    [openPickListModal]
  );

  const confirmPickList = useCallback(async () => {
    if (!pickListPayload || !pickListTargetId) return;
    const target = contactLists.find((l) => l.id === pickListTargetId);
    if (!target) {
      toast.error('Lista inválida.');
      return;
    }
    try {
      if (pickListPayload.mode === 'single') {
        const c = pickListPayload.contact;
        if (listHasContact(target.contactIds || [], c)) {
          toast('Este contato já está nessa lista.', { icon: 'ℹ️' });
          setPickListPayload(null);
          return;
        }
        const nextIds = mergeContactsIntoListIds(target.contactIds || [], [c.id], contacts);
        await updateContactList(target.id, { contactIds: nextIds });
        toast.success(`${c.name || 'Contato'} adicionado a "${target.name}".`);
      } else {
        const bulkIds = pickListPayload.contactIds?.length
          ? pickListPayload.contactIds
          : selectedIds;
        const before = new Set(target.contactIds || []);
        await appendContactIdsToContactList(target.id, bulkIds, {
          notesLine: `+${bulkIds.length} via Contatos (${new Date().toLocaleString('pt-BR')})`
        });
        const addedCount = bulkIds.filter((id) => !before.has(id)).length;
        if (addedCount === 0) {
          toast('Nenhum contato novo (já estavam na lista ou telefone inválido).', { icon: 'ℹ️' });
        } else {
          toast.success(`${addedCount} contato(s) adicionado(s) a "${target.name}".`);
        }
      }
      setPickListPayload(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível atualizar a lista.';
      toast.error(msg);
    }
  }, [pickListPayload, pickListTargetId, contactLists, contacts, updateContactList, appendContactIdsToContactList, selectedIds]);

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

  const openNameNormalizeModal = useCallback(() => {
    setNameNormalizePreviewCount(null);
    setNameNormalizeModalOpen(true);
  }, []);

  const runAddressNormalize = useCallback(async () => {
    if (
      !window.confirm(
        'Corrigir e padronizar TODOS os endereços da base?\n\n' +
          '• Bairro no campo cidade (ex.: Vorstadt → Blumenau + bairro Vorstadt)\n' +
          '• CEP, rua e UF nos campos certos (ViaCEP + IBGE)\n' +
          '• Depois geolocaliza contatos para aparecerem no mapa\n\n' +
          'Pode levar alguns minutos em bases grandes.'
      )
    ) {
      return;
    }
    setAddressNormalizeBusy(true);
    const progressId = 'address-normalize-progress';
    try {
      let offset = 0;
      let totalScanned = 0;
      let totalUpdated = 0;
      const allSamples: Array<{ from: string; to: string }> = [];

      do {
        const r = await apiNormalizeContactAddresses({ offset, limit: 5000 });
        totalScanned += r.scanned;
        totalUpdated += r.updated;
        for (const s of r.samples) {
          if (allSamples.length < 12) allSamples.push(s);
        }
        offset = r.nextOffset;
        toast.loading(
          `Padronizando endereços… ${offset.toLocaleString('pt-BR')} verificados${totalUpdated > 0 ? ` · ${totalUpdated.toLocaleString('pt-BR')} corrigidos` : ''}`,
          { id: progressId }
        );
        if (!r.hasMore) break;
      } while (true);

      toast.loading('Enriquecendo ruas e CEP (ViaCEP)…', { id: progressId });
      try {
        const smart = await apiNormalizeAddresses({ max: 1000 });
        totalUpdated += smart.changed || 0;
      } catch {
        /* opcional */
      }

      let totalGeocoded = 0;
      for (let round = 0; round < 300; round++) {
        const g = await apiGeocodeContacts({ max: 120, force: true });
        totalGeocoded += g.geocoded || 0;
        toast.loading(
          `Geolocalizando no mapa… ${totalGeocoded.toLocaleString('pt-BR')} posicionados`,
          { id: progressId }
        );
        if (!g.geocoded) break;
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }

      toast.dismiss(progressId);
      await refreshContacts();

      if (totalUpdated === 0 && totalGeocoded === 0) {
        toast('Nenhum endereço precisou de alteração.', { icon: 'ℹ️' });
      } else {
        const sample = allSamples.slice(0, 2).map((s) => `${s.from} → ${s.to}`).join('; ');
        toast.success(
          `${totalUpdated.toLocaleString('pt-BR')} endereço(s) corrigido(s) · ${totalGeocoded.toLocaleString('pt-BR')} geolocalizado(s).${sample ? ` Ex.: ${sample}` : ''}`
        );
      }
    } catch (e) {
      toast.dismiss(progressId);
      toast.error(e instanceof Error ? e.message : 'Falha ao padronizar endereços.');
    } finally {
      setAddressNormalizeBusy(false);
    }
  }, [refreshContacts]);

  const runNameNormalizePreview = useCallback(async () => {
    setNameNormalizePreviewBusy(true);
    try {
      const opts = {
        stripPrefixes: nameNormalizeStripPrefixes,
        titleCase: nameNormalizeTitleCase,
        firstAndLastOnly: nameNormalizeFirstLast,
        sanitizeCharacters: nameNormalizeSanitizeChars,
        extraPrefixes: parseExtraPrefixes(nameNormalizeExtraPrefixes)
      };
      let changed = 0;
      const list = contactsRef.current;
      const CHUNK = 350;
      for (let i = 0; i < list.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, list.length);
        for (let j = i; j < end; j++) {
          const c = list[j];
          const before = (c.name || '').trim();
          const after = normalizeContactPersonName(before, opts);
          if (!before && !after) continue;
          if (after !== before) changed++;
        }
        await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      }
      setNameNormalizePreviewCount(changed);
    } finally {
      setNameNormalizePreviewBusy(false);
    }
  }, [
    nameNormalizeStripPrefixes,
    nameNormalizeTitleCase,
    nameNormalizeFirstLast,
    nameNormalizeSanitizeChars,
    nameNormalizeExtraPrefixes
  ]);

  const applyNameNormalize = useCallback(async () => {
    const opts = {
      stripPrefixes: nameNormalizeStripPrefixes,
      titleCase: nameNormalizeTitleCase,
      firstAndLastOnly: nameNormalizeFirstLast,
      sanitizeCharacters: nameNormalizeSanitizeChars,
      extraPrefixes: parseExtraPrefixes(nameNormalizeExtraPrefixes)
    };
    const items: Array<{ id: string; updates: Partial<Contact> }> = [];
    for (const c of contactsRef.current) {
      const before = (c.name || '').trim();
      const after = normalizeContactPersonName(before, opts);
      if (!after) continue;
      if (after === before) continue;
      items.push({ id: c.id, updates: { name: after } });
    }
    if (items.length === 0) {
      toast('Nenhum nome precisou de alteração com estes critérios.');
      return;
    }
    if (!window.confirm(`Atualizar ${items.length.toLocaleString('pt-BR')} contato(s) na base?`)) return;
    setNameNormalizeApplyBusy(true);
    try {
      const SLICE = 200;
      for (let i = 0; i < items.length; i += SLICE) {
        const part = items.slice(i, i + SLICE);
        await bulkUpdateContacts(part, { silent: true });
        await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      }
      toast.success(`${items.length.toLocaleString('pt-BR')} nome(s) atualizado(s).`);
      setNameNormalizeModalOpen(false);
      setNameNormalizePreviewCount(null);
    } finally {
      setNameNormalizeApplyBusy(false);
    }
  }, [
    bulkUpdateContacts,
    nameNormalizeStripPrefixes,
    nameNormalizeTitleCase,
    nameNormalizeFirstLast,
    nameNormalizeSanitizeChars,
    nameNormalizeExtraPrefixes
  ]);

  return (
    <div className="zm-contacts-v3 space-y-4 pb-10 relative">
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

      {/* ── CRM Header unificado: título + KPI tiles + temperatura + ações ── */}
      <ContactsCommandHero
        stats={smartStats}
        contactTempsReady={contactTempsReady}
        hideWedding={segment !== 'religious'}
        savedTotal={contactsSavedTotal}
        onNewContact={openNewContactModal}
        onImportXLSX={openImportXLSX}
        onImportVcf={openImportVcf}
        onSmartImport={openSmartImport}
        onDownloadTemplate={handleDownloadTemplate}
        onExport={handleExport}
        onOpenInsights={openInsights}
        onOpenNormalizeNames={openNameNormalizeModal}
        onOpenNormalizeAddresses={() => void runAddressNormalize()}
        addressNormalizeBusy={addressNormalizeBusy}
      />

      <>
      {/* ========================================================
           NOVO LAYOUT: WORKSPACE (rail + sidebar + tabela virtualizada)
         ======================================================== */}
      <ContactsListsRail
        lists={contactLists}
        noListCount={noListCount}
        activeFilter={activeFilter}
        onSelectFilter={handleSelectSmartFilter}
        onOpenListsTab={() => setListsUiFocus('tab')}
        onCreateList={() => setListsUiFocus('create')}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 zm-contacts-section">
        <ContactsSidebar
          active={activeFilter}
          onChange={handleSelectSmartFilter}
          counts={sidebarCounts}
          lists={contactLists}
          onCreateList={(name) => void handleCreateListQuick(name)}
          onManageList={handleManageList}
          onDeleteList={(id, name) => void handleDeleteList(id, name)}
          query={searchTerm}
          onQueryChange={setSearchTerm}
          hideWeddingFilters={segment !== 'religious'}
          listsUiFocus={listsUiFocus}
          onListsUiFocusHandled={() => setListsUiFocus('none')}
          contactTempsReady={contactTempsReady}
        />

        <div className="flex flex-col gap-3 min-w-0">
          <ContactsWorkspaceToolbar
            activeFilter={activeFilter}
            listName={activeListName}
            searchTerm={searchTerm}
            listManageMode={Boolean(managedListForView)}
            contactsSavedTotal={contactsSavedTotal ?? null}
            contactsSavedTotalLoading={contactsSavedTotalLoading}
            contactsLoaded={contacts.length}
            filteredCount={totalAvailable}
            contactsHasMore={contactsHasMore}
            contactsLoadingMore={contactsLoadingMore}
            onRefreshTotals={() => void refreshContactsSavedTotal?.()}
          />

          {managedListForView ? (
            <ContactsListManagePanel
              list={managedListForView}
              subTab={listManageSubTab}
              onSubTabChange={(tab) => {
                setListManageSubTab(tab);
                if (tab === 'add') setListAddSelectedIds([]);
              }}
              memberSearch={listMemberSearch}
              onMemberSearchChange={setListMemberSearch}
              addSearch={listAddSearch}
              onAddSearchChange={setListAddSearch}
              members={manageListMembers}
              addPool={manageListAddPool}
              addSelectedIds={listAddSelectedIds}
              missingCount={managedListMissingCount}
              contactsHasMore={contactsHasMore}
              contactsLoadingMore={contactsLoadingMore}
              allAddPoolSelected={allAddPoolSelected}
              onCreateCampaign={() => handleCreateCampaignWithList(managedListForView)}
              onExportXlsx={() => handleExportManagedListAs('xlsx')}
              onExportVcf={() => handleExportManagedListAs('vcf')}
              onLoadMore={loadAllContacts ?? loadMoreContacts}
              onEditContact={beginEditContact}
              onRemoveMember={(c) => void handleRemoveContactFromList(managedListForView.id, c)}
              onToggleAddSelect={toggleListAddSelect}
              onToggleAddSelectAll={toggleListAddSelectAll}
              onAddSelected={() => void handleAddIdsToList(managedListForView.id, listAddSelectedIds)}
            />
          ) : (
          <>
          {contactsSavedTotal != null &&
            contacts.length < contactsSavedTotal &&
            (contactsHasMore || contactsLoadingMore || contacts.length >= autoLoadBudget) && (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/30">
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-amber-800 dark:text-amber-200/90 font-bold leading-tight">
                    {contactsLoadingMore
                      ? `Carregando contatos… ${contacts.length.toLocaleString('pt-BR')} de ${contactsSavedTotal.toLocaleString('pt-BR')}`
                      : contacts.length >= autoLoadBudget
                        ? `${contacts.length.toLocaleString('pt-BR')} de ${contactsSavedTotal.toLocaleString('pt-BR')} carregados — pausa automática para manter a interface fluida.`
                        : `Faltam ${(contactsSavedTotal - contacts.length).toLocaleString('pt-BR')} contatos para concluir o carregamento.`}
                  </p>
                  <p className="text-[10px] text-amber-700/70 dark:text-amber-400/60 mt-0.5">
                    {contactsLoadingMore
                      ? 'Buscando o restante em segundo plano — a interface continua utilizável.'
                      : contacts.length >= autoLoadBudget
                        ? 'Campanhas e listas usam os contatos já carregados. Carregue mais sob demanda se precisar.'
                        : 'O carregamento automático retomará em instantes.'}
                  </p>
                </div>
                {!contactsLoadingMore &&
                  contacts.length >= autoLoadBudget &&
                  contactsHasMore && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      onClick={() => {
                        setAutoLoadBudget((b) => b + MAX_AUTO_LOAD_CONTACTS);
                        setAutoLoadActive(true);
                      }}
                    >
                      Carregar mais
                    </Button>
                  )}
              </div>
            )}
          {activeFilter === 'no_list' && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-orange-200/80 dark:border-orange-900/50 bg-orange-50/60 dark:bg-orange-950/20 px-3 py-2">
              <span className="text-[12px] text-orange-900 dark:text-orange-200 font-medium">
                {listFilteredContacts.length.toLocaleString('pt-BR')} contato(s) sem nenhuma lista
                {contactsSavedTotal != null && contacts.length < contactsSavedTotal
                  ? ` (entre os ${contacts.length.toLocaleString('pt-BR')} carregados)`
                  : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="ml-auto"
                leftIcon={<ListPlus className="w-3.5 h-3.5" />}
                disabled={listFilteredContacts.length === 0}
                onClick={handleAddAllFilteredToList}
              >
                Adicionar todos à lista…
              </Button>
            </div>
          )}
          {(activeFilter === 'bday_week' || activeFilter === 'bday_today') && listFilteredContacts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2">
              <span className="text-[12px] text-amber-900 dark:text-amber-200 font-medium">
                {listFilteredContacts.length} aniversariante(s) neste filtro
              </span>
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="ml-auto"
                leftIcon={<Send className="w-3.5 h-3.5" />}
                onClick={() => handleBirthdayCampaign(listFilteredContacts)}
              >
                Mensagem de aniversário
              </Button>
            </div>
          )}
          {segment !== 'religious' &&
            (activeFilter === 'wedding_week' || activeFilter === 'wedding_today') &&
            listFilteredContacts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200/80 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/20 px-3 py-2">
              <span className="text-[12px] text-rose-900 dark:text-rose-200 font-medium">
                {listFilteredContacts.length} contato(s) com bodas neste filtro
              </span>
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="ml-auto"
                leftIcon={<Send className="w-3.5 h-3.5" />}
                onClick={() => handleWeddingCampaign(listFilteredContacts)}
              >
                Mensagem de bodas
              </Button>
            </div>
          )}
          {paginatedContacts.length === 0 && currentPage < totalPages ? (
            <div className="h-[calc(100vh-320px)] flex flex-col items-center justify-center p-12 text-center bg-slate-50/30 dark:bg-slate-900/10 border-none">
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-800 shadow-xl flex items-center justify-center text-[var(--brand-500)] relative z-10 border border-slate-100 dark:border-slate-700">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              </div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight mb-2">
                Carregando página {currentPage}...
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                Buscando os contatos na base de dados para preencher esta visualização.
              </p>
            </div>
          ) : (
            <ContactsTableVirtual
              rows={tableContacts}
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
              loading={contacts.length === 0 && (contactsLoadingMore || (contactsSavedTotal != null && contactsSavedTotal > 0))}
              heightClass="h-[calc(100vh-320px)]"
              emptyHint={
                searchTerm
                  ? <>Nenhum contato casa com "<b>{searchTerm}</b>".</>
                  : activeFilter === 'all'
                    ? 'Sua base está vazia. Importe ou crie um contato.'
                    : activeFilter === 'no_list'
                      ? 'Todos os contatos carregados já estão em alguma lista.'
                      : activeFilter === 'retorno_todos' || activeFilter === 'retorno_atrasados' || activeFilter === 'retorno_hoje' || activeFilter === 'retorno_semana'
                      ? 'Nenhum contato com retorno neste filtro. Edite um contato e defina data em Retorno.'
                      : activeFilter === 'wedding_today' || activeFilter === 'wedding_week'
                        ? 'Ninguém com data de casamento na ficha neste período. Edite o contato (segmento religioso) e preencha Data do casamento na ficha de membro.'
                        : (activeFilter === 'hot' || activeFilter === 'warm' || activeFilter === 'cold' || activeFilter === 'new') && !contactTempsReady
                          ? 'Calculando temperaturas da base… aguarde um instante.'
                          : 'Ajuste o filtro na lateral ou tente outra busca.'
              }
            />
          )}

          {/* Pagination Footer */}
          {totalPages > 1 && (
            <div className="px-4 py-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/10">
              <div className="text-xs text-slate-500 font-medium">
                Mostrando <span className="text-slate-900 dark:text-white font-bold">{paginatedContacts.length}</span> de <span className="text-slate-900 dark:text-white font-bold">{totalAvailable.toLocaleString('pt-BR')}</span> contatos
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                <div className="flex items-center gap-1">
                  {[...Array(Math.min(5, totalPages))].map((_, i) => {
                    let pageNum = currentPage;
                    if (totalPages <= 5) pageNum = i + 1;
                    else if (currentPage <= 3) pageNum = i + 1;
                    else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = currentPage - 2 + i;

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                          currentPage === pageNum
                            ? 'bg-[var(--brand-600)] text-white shadow-md'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="text-xs text-slate-500 font-medium">
                Página <span className="text-slate-900 dark:text-white font-bold">{currentPage}</span> de <span className="text-slate-900 dark:text-white font-bold">{totalPages}</span>
              </div>
            </div>
          )}
          </>
          )}
          </div>
      </div>
      {!managedListForView && (
        <ContactsBulkBar
          count={selectedIds.length}
          onClear={clearBulkSelection}
          onCreateCampaign={handleCreateCampaignWithSelection}
          onAddToList={handleBulkAddToList}
          onAddTag={() => void handleBulkAddTag()}
          onExport={handleBulkExport}
          onDelete={() => void handleBulkDelete()}
        />
      )}

      </>

      {/* Drawer lateral de detalhe do contato */}
      <ContactDetailDrawer
        contact={selectedContactForDrawer}
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
      <Modal
        isOpen={pickListPayload !== null}
        onClose={() => setPickListPayload(null)}
        title={
          pickListPayload?.mode === 'bulk'
            ? `Adicionar ${(pickListPayload.contactIds?.length ?? selectedIds.length).toLocaleString('pt-BR')} contato(s) à lista`
            : 'Adicionar à lista'
        }
        subtitle="Escolha a lista de destino."
        icon={<ListPlus className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button variant="ghost" type="button" onClick={() => setPickListPayload(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="button" onClick={() => void confirmPickList()}>
              Adicionar
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Lista de contatos
          </label>
          <select
            className="w-full rounded-lg border px-3 py-2.5 text-[13px]"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface-1)',
              color: 'var(--text-1)'
            }}
            value={pickListTargetId}
            onChange={(e) => setPickListTargetId(e.target.value)}
          >
            {contactLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.contactIds?.length ?? l.count ?? 0})
              </option>
            ))}
          </select>
        </div>
      </Modal>

      <Modal
        isOpen={nameNormalizeModalOpen}
        onClose={() => {
          if (nameNormalizeApplyBusy || nameNormalizePreviewBusy) return;
          setNameNormalizeModalOpen(false);
        }}
        title="Limpar e padronizar nomes"
        subtitle="Remove prefixos, padroniza maiúsculas, opcionalmente reduz a primeiro/último nome e pode limpar símbolos, números e emoji no nome."
        icon={<SpellCheck2 className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button
              variant="ghost"
              type="button"
              disabled={nameNormalizeApplyBusy || nameNormalizePreviewBusy}
              onClick={() => setNameNormalizeModalOpen(false)}
            >
              Fechar
            </Button>
            <Button
              variant="secondary"
              type="button"
              loading={nameNormalizePreviewBusy}
              disabled={nameNormalizeApplyBusy || contacts.length === 0}
              onClick={() => void runNameNormalizePreview()}
            >
              Calcular alterações
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={nameNormalizeApplyBusy}
              disabled={nameNormalizePreviewBusy || contacts.length === 0}
              onClick={() => void applyNameNormalize()}
            >
              Aplicar na base
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-[13px]" style={{ color: 'var(--text-1)' }}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              checked={nameNormalizeSanitizeChars}
              onChange={(e) => {
                setNameNormalizeSanitizeChars(e.target.checked);
                setNameNormalizePreviewCount(null);
              }}
            />
            <span>
              Limpar caracteres estranhos (invisíveis do Excel/WhatsApp, emoji, números e pontuação). Mantém letras com
              acento, espaço, hífen e apóstrofo em nomes como Ana-Maria ou D&apos;Avila.
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              checked={nameNormalizeStripPrefixes}
              onChange={(e) => {
                setNameNormalizeStripPrefixes(e.target.checked);
                setNameNormalizePreviewCount(null);
              }}
            />
            <span>
              Remover prefixos no início (ex.: Pastor, Padre, Sr., Dr., SAMAE…). Você pode acrescentar mais abaixo.
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              checked={nameNormalizeTitleCase}
              onChange={(e) => {
                setNameNormalizeTitleCase(e.target.checked);
                setNameNormalizePreviewCount(null);
              }}
            />
            <span>
              Capitalizar nome (primeira letra maiúscula; partículas como &quot;de&quot;, &quot;da&quot; ficam minúsculas no meio).
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              checked={nameNormalizeFirstLast}
              onChange={(e) => {
                setNameNormalizeFirstLast(e.target.checked);
                setNameNormalizePreviewCount(null);
              }}
            />
            <span>
              Manter apenas primeiro e último nome (útil quando há muitos nomes do meio ou ruído no meio do campo).
            </span>
          </label>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
              Prefixos ou instituições extras (opcional)
            </label>
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-[13px] min-h-[72px]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface-1)',
                color: 'var(--text-1)'
              }}
              placeholder={'Um por linha ou separados por vírgula.\nEx.: prefeitura, secretaria, empresa x'}
              value={nameNormalizeExtraPrefixes}
              onChange={(e) => {
                setNameNormalizeExtraPrefixes(e.target.value);
                setNameNormalizePreviewCount(null);
              }}
            />
          </div>
          <div
            className="rounded-lg px-3 py-2 text-[12px]"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
          >
            {contacts.length === 0 ? (
              <>Sem contatos na base.</>
            ) : nameNormalizePreviewCount === null ? (
              <>Clique em «Calcular alterações» para estimar quantos registros mudariam antes de aplicar.</>
            ) : (
              <>
                Estimativa:{' '}
                <strong className="tabular-nums">{nameNormalizePreviewCount.toLocaleString('pt-BR')}</strong> de{' '}
                <span className="tabular-nums">{contacts.length.toLocaleString('pt-BR')}</span> contato(s) com nome
                diferente após as regras acima.
              </>
            )}
          </div>
        </div>
      </Modal>

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
        <div className="fixed inset-0 zm-layer-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
           <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full animate-in fade-in zoom-in duration-200 flex flex-col my-auto border border-slate-200 dark:border-slate-800 ${segment === 'religious' ? 'max-w-3xl' : 'max-w-xl'}`}>
              
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
                      {editingContactId ? 'Atualize os dados e salve as alterações.' : 'Preencha os dados abaixo para cadastrar manualmente.'}
                    </p>
                 </div>
                 <button onClick={() => { setIsModalOpen(false); setEditingContactId(null); setFollowUpDatetimeLocal(''); setNewContactTargetMode('none'); setNewContactTargetListId(''); setNewContactNewListName(''); setNewContact({ name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '', church: '', role: '', profession: '', birthday: '', email: '', notes: '', followUpNote: '' }); setReligiousMemberForm(emptyForm()); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 p-1.5 rounded-full transition-colors">
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
                                  value={newContact.city}
                                  onChange={e => handleCityInputChange(e.target.value)}
                                  onBlur={() => setTimeout(() => setShowIbgeCityDropdown(false), 150)}
                                  onFocus={() => { if (ibgeCitySuggestions.length > 0) setShowIbgeCityDropdown(true); }}
                                  className="ui-input pl-10"
                                  placeholder="Ex: São Paulo"
                                  autoComplete="off"
                                />
                                {showIbgeCityDropdown && ibgeCitySuggestions.length > 0 && (
                                  <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden">
                                    {ibgeCitySuggestions.map((s) => (
                                      <li
                                        key={`${s.city}-${s.state}`}
                                        onMouseDown={() => handleCitySuggestionPick(s)}
                                        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-emerald-50 dark:hover:bg-slate-700 text-sm"
                                      >
                                        <span className="font-medium text-slate-800 dark:text-slate-200">{s.city}</span>
                                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 ml-2">{s.state}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>

                 {/* Divider */}
                 <div className="border-t border-slate-100 dark:border-slate-800"></div>

                 {/* Section: Endereço */}
                 <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <Home className="w-3.5 h-3.5" /> Endereço
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
                             <label htmlFor="newContactNumber" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Número</label>
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
                             <label htmlFor="newContactZipCode" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
                               CEP
                               <span className="ml-1.5 text-[10px] font-medium normal-case tracking-normal text-emerald-600 dark:text-emerald-400">preenche sozinho</span>
                             </label>
                             <div className="relative">
                               <input
                                 id="newContactZipCode"
                                 type="text"
                                 inputMode="numeric"
                                 value={newContact.zipCode || ''}
                                 onChange={e => {
                                   const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                                   const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
                                   if (cepLookupState !== 'idle') setCepLookupState('idle');
                                   setNewContact({...newContact, zipCode: formatted});
                                   if (digits.length === 8) void lookupCepAndFill(digits);
                                 }}
                                 onBlur={e => void lookupCepAndFill(e.target.value)}
                                 className="ui-input pr-8"
                                 placeholder="00000-000"
                                 maxLength={9}
                               />
                               {cepLookupState === 'loading' && (
                                 <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-emerald-500" />
                               )}
                               {cepLookupState === 'ok' && (
                                 <CheckCircle2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                               )}
                             </div>
                             {cepLookupState === 'notfound' && (
                               <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">CEP não encontrado — preencha manualmente.</p>
                             )}
                             {cepLookupState === 'error' && (
                               <p className="mt-1 text-[11px] text-slate-400">Não deu para consultar o CEP agora.</p>
                             )}
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
                       <div className="flex justify-end pt-1">
                         <button
                           type="button"
                           onClick={() => void handleCorrectAddress()}
                           className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 px-3 py-1.5 rounded-lg transition-colors border border-emerald-200/60 dark:border-emerald-700/40"
                         >
                           <SpellCheck2 className="w-3.5 h-3.5" />
                           Corrigir endereço
                         </button>
                       </div>
                    </div>
                 </div>

                 {segment === 'religious' ? (
                 <>
                 <div className="border-t border-slate-100 dark:border-slate-800"></div>

                 {/* Section: Church Info (somente segmento religioso) */}
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

                       <p className="text-[11px] text-slate-500 dark:text-slate-400">
                         Cargo na igreja ao gravar: combina as funções marcadas na ficha abaixo com o complemento em texto livre (campo &quot;Complemento de função&quot;).
                       </p>
                    </div>
                 </div>

                   <ReligiousMemberProfileModalFields
                     form={religiousMemberForm}
                     onPatch={(p) => setReligiousMemberForm((prev) => ({ ...prev, ...p }))}
                   />
                 </>
                 ) : null}

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
                          <BrDateInput
                            id="newContactBirthday"
                            name="newContactBirthday"
                            className="ui-input"
                            value={newContact.birthday || ''}
                            onValueChange={(v) => setNewContact({ ...newContact, birthday: v })}
                          />
                          <p className="text-[11px] text-slate-400 mt-1">Formato DD/MM/AAAA (barras ao digitar).</p>
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
                       <label htmlFor="newContactNotes" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Observações</label>
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

                    {editingContactId ? (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-3">
                      <h4 className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5" /> Retorno (lembrete)
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Data e hora em que pretende contactar de novo. Aparece nos filtros &quot;Retornos&quot; na lateral.
                      </p>
                      <div>
                        <label htmlFor="followUpDatetime" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Data e hora</label>
                        <input
                          id="followUpDatetime"
                          type="datetime-local"
                          value={followUpDatetimeLocal}
                          onChange={(e) => setFollowUpDatetimeLocal(e.target.value)}
                          className="ui-input max-w-[min(100%,20rem)]"
                        />
                      </div>
                      <div>
                        <label htmlFor="followUpNote" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Nota do retorno (opcional)</label>
                        <input
                          id="followUpNote"
                          type="text"
                          value={newContact.followUpNote || ''}
                          onChange={(e) => setNewContact({ ...newContact, followUpNote: e.target.value.slice(0, 500) })}
                          className="ui-input"
                          placeholder="Ex.: combinar segunda visita, assunto da ligação..."
                          maxLength={500}
                        />
                      </div>
                    </div>
                    ) : null}
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
                    type="button"
                    onClick={() => { setIsModalOpen(false); setEditingContactId(null); setFollowUpDatetimeLocal(''); setNewContactTargetMode('none'); setNewContactTargetListId(''); setNewContactNewListName(''); setNewContact({ name: '', phone: '', city: '', state: '', street: '', number: '', neighborhood: '', zipCode: '', church: '', role: '', profession: '', birthday: '', email: '', notes: '', followUpNote: '' }); setReligiousMemberForm(emptyForm()); }}
                    className="px-6 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                 >
                    Cancelar
                 </button>
                 <button
                    type="button"
                    onClick={() => void handleSaveNewContact()}
                    className="flex-1 px-6 py-2.5 text-sm font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 active:transform active:scale-95 transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2"
                 >
                    <Save className="w-4 h-4" /> {editingContactId ? 'Salvar alterações' : 'Salvar contato'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Revisao de importacao por arquivo (XLSX/CSV ou vCard): filtros, problemas, duplicados */}
      {fileImportOpen && !fileImportDocked && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm zm-layer-modal-elevated flex items-start sm:items-center justify-center overflow-y-auto p-3 sm:p-6 py-8 sm:py-6 animate-fadeIn"
          onClick={() => {
            if (autoFixProgress) return;
            setFileImportOpen(false);
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 w-full max-w-6xl rounded-2xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-cyan-50 to-emerald-50 dark:from-cyan-950/20 dark:to-emerald-950/20">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-white shadow flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5 text-cyan-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-bold text-slate-900 dark:text-white truncate">Revisar importação</h3>
                  <p className="text-[12px] text-slate-500 truncate">{fileImportLabel}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (autoFixProgress) return;
                  setFileImportOpen(false);
                }}
                className="p-2 rounded-lg hover:bg-white/60 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="shrink-0 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[11px] font-bold uppercase text-slate-500 mr-1">Mostrar</span>
                  {([
                    ['all', 'Todas', fileImportUiCounts.total],
                    ['problem', 'Com problema', fileImportUiCounts.prob],
                    ['duplicate', 'Duplicados', fileImportUiCounts.dup],
                    ['ready', 'Prontos', fileImportUiCounts.ready],
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFileImportFilter(key as FileImportPreviewFilter)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                        fileImportFilter === key
                          ? 'brand-soft brand-text brand-border'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {label} <span className="opacity-60 tabular-nums">{count}</span>
                    </button>
                  ))}
                </div>

                <div className="flex-1" />

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className="text-[11px] text-slate-500">
                    Selecionados: <span className="font-bold tabular-nums">{fileImportUiCounts.includedReady}</span>
                  </span>
                  <button
                    type="button"
                    disabled={autoFixProgress !== null || fileImportEligibleInFilter.total === 0}
                    onClick={toggleFileImportSelectAllEligible}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/25"
                    title="Seleciona/desmarca todas as linhas válidas deste filtro (inclui 'Na base' quando permitido)"
                  >
                    {fileImportAllEligibleSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                    <span className="opacity-60 tabular-nums"> ({fileImportEligibleInFilter.total})</span>
                  </button>
                </div>
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
                    <p className="text-[10px] font-bold uppercase text-cyan-700">Só no arquivo</p>
                    <p className="text-lg font-bold tabular-nums text-cyan-700 dark:text-cyan-300">{fileImportTriageSummary.repeatedOnlyInFile}</p>
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
              {autoFixProgress !== null && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/25 px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5 min-w-0">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
                      <span className="truncate">{autoFixProgress.message}</span>
                    </span>
                    <span className="text-[11px] tabular-nums text-emerald-800 dark:text-emerald-200 shrink-0">
                      {autoFixProgress.percent}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-emerald-200/80 dark:bg-emerald-900/50 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-[width] duration-150 ease-out"
                      style={{ width: `${autoFixProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  loading={autoFixProgress !== null}
                  onClick={() => void autoFixFileImportRows()}
                  disabled={autoFixProgress !== null}
                >
                  Correção automática (todos)
                </Button>
              </div>
            </div>

            <div
              ref={fileImportTableScrollRef}
              className="flex-1 min-h-0 overflow-auto p-3 sm:p-4"
            >
              <table className="w-full text-[12px]" style={{ display: 'block' }}>
                <thead
                  className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10 border-b border-slate-200 dark:border-slate-700"
                  style={{ display: 'table', width: '100%', tableLayout: 'fixed' }}
                >
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
                <tbody
                  className={
                    filteredFileImportRows.length === 0
                      ? ''
                      : 'divide-y divide-slate-100 dark:divide-slate-800'
                  }
                  style={{
                    display: 'block',
                    position: 'relative',
                    width: '100%',
                    height:
                      filteredFileImportRows.length === 0 ? 'auto' : `${fileImportRowVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {filteredFileImportRows.length === 0 ? (
                    <tr style={{ display: 'table', width: '100%', tableLayout: 'fixed' }}>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                        Nenhuma linha neste filtro.
                      </td>
                    </tr>
                  ) : (
                    fileImportRowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const rv = filteredFileImportRows[virtualRow.index];
                      const patch = (p: Partial<Contact>) =>
                        setFileImportRows((prev) =>
                          prev.map((x) => (x.id === rv.id ? { ...x, contact: { ...x.contact, ...p } } : x))
                        );
                      const rowClass =
                        rv.duplicate
                          ? 'bg-rose-50/50 dark:bg-rose-950/20'
                          : rv.problems.length
                            ? 'bg-amber-50/40 dark:bg-amber-950/10'
                            : '';
                      return (
                        <tr
                          key={rv.id}
                          style={{
                            display: 'table',
                            width: '100%',
                            tableLayout: 'fixed',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          className={rowClass}
                        >
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
                              <span className="text-amber-700 dark:text-amber-300 text-[11px]">
                                {rv.problems.join(' · ')}
                              </span>
                            ) : (
                              <span className="text-emerald-600 text-[11px] font-medium">OK</span>
                            )}
                          </td>
                          <td className="px-1 py-1.5">
                            <input
                              type="text"
                              value={rv.contact.name}
                              onChange={(e) => patch({ name: e.target.value })}
                              className="w-full min-w-[120px] px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent"
                            />
                          </td>
                          <td className="px-1 py-1.5">
                            <input
                              type="text"
                              value={rv.contact.phone}
                              onChange={(e) => patch({ phone: e.target.value.replace(/\D/g, '') })}
                              className="w-full min-w-[110px] px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent font-mono"
                            />
                          </td>
                          <td className="px-1 py-1.5 hidden lg:table-cell">
                            <input
                              type="text"
                              value={rv.contact.city || ''}
                              onChange={(e) => patch({ city: e.target.value })}
                              className="w-full px-1.5 py-1 rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:outline-none bg-transparent"
                            />
                          </td>
                          <td className="px-1 py-1.5 hidden lg:table-cell">
                            <input
                              type="text"
                              value={rv.contact.church || ''}
                              onChange={(e) => patch({ church: e.target.value })}
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

            <div className="shrink-0 px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3 bg-slate-50 dark:bg-slate-900/50">
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
                <b>{fileImportUiCounts.includedReady}</b> de {fileImportUiCounts.total} linha(s).
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={autoFixProgress !== null}
                  onClick={() => {
                    if (autoFixProgress) return;
                    setFileImportOpen(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  leftIcon={<Save className="w-4 h-4" />}
                  disabled={
                    autoFixProgress !== null || fileImportUiCounts.includedReady === 0
                  }
                  onClick={() => void executeFileImportConfirm()}
                >
                  Confirmar importação
                </Button>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {fileImportDocked && fileImportJob && (
        <div
          className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-4 sm:w-[min(440px,calc(100vw-1.5rem))] zm-layer-toast rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-4 space-y-3 animate-fadeIn"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/50 p-2 shrink-0">
              <Minimize2 className="w-4 h-4 text-cyan-600 dark:text-cyan-300" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {fileImportLabel || 'Importação em curso'}
              </p>
              <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-snug">{fileImportJob.message}</p>
              {typeof fileImportJob.queuedBehind === 'number' && fileImportJob.queuedBehind > 0 ? (
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Mais {fileImportJob.queuedBehind} importação(ões) na fila após esta.
                </p>
              ) : null}
              {fileImportJob.phase === 'error' && fileImportJob.error ? (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">{fileImportJob.error}</p>
              ) : null}
            </div>
            {fileImportJob.phase !== 'done' && fileImportJob.phase !== 'error' ? (
              <Loader2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0 mt-0.5" aria-hidden />
            ) : null}
          </div>
          <div className="h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-200 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, fileImportJob.percent))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            <span>
              {fileImportJob.phase === 'autofix'
                ? `Linhas: ${fileImportJob.current} / ${fileImportJob.total}`
                : fileImportJob.phase === 'import'
                  ? `Contatos: ${fileImportJob.current} / ${fileImportJob.total}`
                  : fileImportJob.phase === 'list'
                    ? 'Lista de destino'
                    : fileImportJob.phase === 'done'
                      ? 'Concluído'
                      : 'Erro'}
            </span>
            <span>{Math.min(100, Math.max(0, fileImportJob.percent))}%</span>
          </div>
        </div>
      )}

      {/* SMART IMPORT MODAL: cola do Excel/Word, parser inteligente, preview editavel */}
      {smartImportOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm zm-layer-modal-elevated flex items-start sm:items-center justify-center overflow-y-auto p-3 sm:p-6 py-8 sm:py-6 animate-fadeIn"
          onClick={() => {
            setSmartImportOpen(false);
            setSmartImportPreviewFilter('all');
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 w-full max-w-6xl rounded-2xl shadow-2xl overflow-hidden max-h-[95vh] flex flex-col min-h-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/20 dark:to-emerald-950/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white shadow flex items-center justify-center">
                  <Wand2 className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Importação inteligente</h3>
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

            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
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
                              name: normalizeContactPersonName((r.name || '').trim(), {
                                stripPrefixes: true,
                                titleCase: true
                              }),
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
                  <div className="max-h-[45vh] min-h-0 overflow-auto">
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

            <div className="shrink-0 px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3 bg-slate-50 dark:bg-slate-900/50">
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
                    const FIRE_BATCH = 400;
                    const pendingCreates: Contact[] = [];
                    const pendingUpdates: Array<{ id: string; updates: Partial<Contact> }> = [];
                    const pendingCreateKeys = new Set<string>();

                    const yieldUi = () =>
                      new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

                    const flushCreates = async () => {
                      if (pendingCreates.length === 0) return;
                      const slice = pendingCreates.splice(0, pendingCreates.length);
                      for (const c of slice) {
                        const kk = normPhoneKey(c.phone);
                        if (kk) pendingCreateKeys.delete(kk);
                      }
                      const ids = await bulkAddContacts(slice, { silent: true, skipReload: true });
                      await yieldUi();
                      for (let idx = 0; idx < ids.length; idx++) {
                        const incoming = slice[idx];
                        const kk = normPhoneKey(incoming.phone);
                        if (!kk) continue;
                        localByKey.set(kk, { ...incoming, id: ids[idx] });
                        touchedIds.add(ids[idx]);
                        imported++;
                      }
                      await new Promise<void>((r) => setTimeout(r, 40));
                    };

                    const flushUpdates = async () => {
                      if (pendingUpdates.length === 0) return;
                      const slice = pendingUpdates.splice(0, pendingUpdates.length);
                      await bulkUpdateContacts(slice, { silent: true, skipReload: true });
                      await yieldUi();
                      merged += slice.length;
                      await new Promise<void>((r) => setTimeout(r, 40));
                    };

                    let rowN = 0;
                    for (const rv of smartImportRowsView) {
                      rowN++;
                      const base = smartImportRows.find((b) => b.id === rv.id);
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
                      const displayName =
                        normalizeContactPersonName(rv.name.trim(), {
                          stripPrefixes: true,
                          titleCase: true
                        }) || 'Sem Nome';
                      const c: Contact = {
                        id: `smart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                        name: displayName,
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
                        ...(rv.followUpAt ? { followUpAt: rv.followUpAt } : {}),
                        ...(rv.followUpNote.trim()
                          ? { followUpNote: rv.followUpNote.trim().slice(0, 500) }
                          : {}),
                        tags: ['Importação rápida'],
                        status: phone.replace(/\D/g, '').length >= 10 ? 'VALID' : 'INVALID',
                        lastMsg: 'Nunca'
                      };
                      let existing = localByKey.get(k);
                      if (!existing && pendingCreateKeys.has(k)) {
                        await flushCreates();
                        existing = localByKey.get(k);
                      }

                      if (existing) {
                        const mergedPayload = mergeContactData(existing, c, ['Importação rápida']);
                        const nextExisting: Contact = { ...existing, ...mergedPayload };
                        localByKey.set(k, nextExisting);
                        touchedIds.add(existing.id);
                        pendingUpdates.push({ id: existing.id, updates: mergedPayload });
                        if (pendingUpdates.length >= FIRE_BATCH) await flushUpdates();
                      } else {
                        pendingCreates.push(c);
                        pendingCreateKeys.add(k);
                        if (pendingCreates.length >= FIRE_BATCH) await flushCreates();
                      }
                      if (rowN % 40 === 0) await yieldUi();
                    }
                    await flushCreates();
                    await flushUpdates();
                    await refreshContacts();
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

