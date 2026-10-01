/**
 * Importação de público de campanha via planilha (.xlsx).
 * Colunas alinhadas ao modelo de contatos (Telefone + Nome) e variáveis de mensagem.
 */
import { isPlausibleBrazilWhatsAppPhone, normalizeBRPhone } from './brPhoneNormalize';
import { campaignRecipientNameVars } from './contactNameNormalize';

export const CAMPAIGN_IMPORT_SHEET_END_MARKER = 'ZAPMASS_FIM_DADOS';

/** Cabeçalhos do modelo baixável (ordem fixa). */
export const CAMPAIGN_SPREADSHEET_TEMPLATE_HEADERS = [
  'Telefone',
  'Nome',
  'Cidade',
  'Igreja',
  'Cargo',
  'Profissao',
  'Email',
  'Aniversario',
  'Conjuge',
  'Data bodas',
  'Anos casamento',
] as const;

export type CampaignSpreadsheetVarKey =
  | 'nome'
  | 'nome_completo'
  | 'telefone'
  | 'cidade'
  | 'igreja'
  | 'cargo'
  | 'profissao'
  | 'email'
  | 'aniversario'
  | 'conjuge'
  | 'data_bodas'
  | 'anos_casamento';

export type CampaignSpreadsheetParsedRow = {
  lineNumber: number;
  phoneRaw: string;
  phone: string;
  formatOk: boolean;
  formatError?: string;
  vars: Record<CampaignSpreadsheetVarKey, string>;
};

const normalizeHeader = (h: string): string =>
  h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Mapeia cabeçalho normalizado → índice de coluna de variável da campanha. */
const HEADER_TO_VAR: Record<string, CampaignSpreadsheetVarKey | 'phone' | 'name'> = {
  telefone: 'phone',
  phone: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  numero: 'phone',
  fone: 'phone',
  wpp: 'phone',
  zap: 'phone',
  nome: 'name',
  name: 'name',
  nomecompleto: 'name',
  cidade: 'cidade',
  city: 'cidade',
  municipio: 'cidade',
  igreja: 'igreja',
  church: 'igreja',
  cargo: 'cargo',
  role: 'cargo',
  cargoigreja: 'cargo',
  profissao: 'profissao',
  profession: 'profissao',
  cargoprofissional: 'profissao',
  email: 'email',
  mail: 'email',
  aniversario: 'aniversario',
  birthday: 'aniversario',
  nascimento: 'aniversario',
  conjuge: 'conjuge',
  spouse: 'conjuge',
  databodas: 'data_bodas',
  databoda: 'data_bodas',
  wedding: 'data_bodas',
  anoscasamento: 'anos_casamento',
  anoscasados: 'anos_casamento',
};

function emptyVars(): Record<CampaignSpreadsheetVarKey, string> {
  return {
    nome: '',
    nome_completo: '',
    telefone: '',
    cidade: '',
    igreja: '',
    cargo: '',
    profissao: '',
    email: '',
    aniversario: '',
    conjuge: '',
    data_bodas: '',
    anos_casamento: '',
  };
}

export function buildCampaignSpreadsheetHeaderMap(rawHeaders: string[]): Array<CampaignSpreadsheetVarKey | 'phone' | 'name' | null> {
  let phoneSeen = false;
  return rawHeaders.map((raw) => {
    const norm = normalizeHeader(String(raw || ''));
    let key = HEADER_TO_VAR[norm] ?? null;
    if (norm === 'numero') {
      key = phoneSeen ? null : 'phone';
    }
    if (!key) {
      if (/phone|fone|cel|tel|whats|wpp|zap/.test(norm)) key = phoneSeen ? null : 'phone';
      else if (/nome|name|contato/.test(norm)) key = 'name';
      else if (/cidade|city/.test(norm)) key = 'cidade';
      else if (/igreja|church/.test(norm)) key = 'igreja';
      else if (/profiss/.test(norm)) key = 'profissao';
      else if (/cargo|role/.test(norm)) key = 'cargo';
      else if (/email|mail/.test(norm)) key = 'email';
      else if (/aniv|birth|nasc/.test(norm)) key = 'aniversario';
      else if (/conjuge|spouse/.test(norm)) key = 'conjuge';
      else if (/boda|wedding/.test(norm)) key = 'data_bodas';
      else if (/anoscas/.test(norm)) key = 'anos_casamento';
    }
    if (key === 'phone') phoneSeen = true;
    return key;
  });
}

export function validateCampaignSpreadsheetPhone(raw: string): {
  ok: boolean;
  phone: string;
  error?: string;
} {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return { ok: false, phone: '', error: 'Telefone ausente' };
  const normalized = normalizeBRPhone(digits) || digits;
  if (!isPlausibleBrazilWhatsAppPhone(normalized)) {
    return { ok: false, phone: normalized, error: 'Telefone inválido (use DDI 55 + DDD + número)' };
  }
  return { ok: true, phone: normalized };
}

export function mapCampaignSpreadsheetDataRow(
  headerMap: Array<CampaignSpreadsheetVarKey | 'phone' | 'name' | null>,
  row: unknown[],
  lineNumber: number
): CampaignSpreadsheetParsedRow {
  const vars = emptyVars();
  let phoneRaw = '';
  let nameRaw = '';

  headerMap.forEach((key, col) => {
    if (!key) return;
    const cell = String(row[col] ?? '').trim();
    if (key === 'phone') phoneRaw = cell;
    else if (key === 'name') nameRaw = cell;
    else vars[key] = cell;
  });

  const phoneCheck = validateCampaignSpreadsheetPhone(phoneRaw);
  const nv = campaignRecipientNameVars(nameRaw);
  vars.nome = nv.nome;
  vars.nome_completo = nv.nome_completo || nameRaw;
  if (phoneCheck.ok) vars.telefone = phoneCheck.phone;

  return {
    lineNumber,
    phoneRaw,
    phone: phoneCheck.phone,
    formatOk: phoneCheck.ok,
    formatError: phoneCheck.error,
    vars,
  };
}

export function normalizeCampaignImportEndMarkerCell(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .toUpperCase();
}

export function truncateCampaignSheetAtEndMarker(rows: unknown[][]): {
  rows: unknown[][];
  cutByMarker: boolean;
} {
  if (rows.length < 2) return { rows, cutByMarker: false };
  const markerNorm = normalizeCampaignImportEndMarkerCell(CAMPAIGN_IMPORT_SHEET_END_MARKER);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cellA = row[0];
    if (!String(cellA ?? '').trim()) continue;
    if (normalizeCampaignImportEndMarkerCell(cellA) === markerNorm) {
      return { rows: rows.slice(0, i), cutByMarker: true };
    }
  }
  return { rows, cutByMarker: false };
}

export function trimTrailingEmptySpreadsheetRows(rows: unknown[][]): unknown[][] {
  const out = rows.map((r) => [...r]);
  while (out.length > 1 && out[out.length - 1].every((c) => String(c ?? '').trim() === '')) {
    out.pop();
  }
  return out;
}

export type ParseCampaignSpreadsheetResult =
  | { ok: true; rows: CampaignSpreadsheetParsedRow[]; cutByMarker: boolean }
  | { ok: false; error: string };

export function parseCampaignSpreadsheetRows(sheetRows: unknown[][]): ParseCampaignSpreadsheetResult {
  let rows = trimTrailingEmptySpreadsheetRows(sheetRows);
  const truncated = truncateCampaignSheetAtEndMarker(rows);
  rows = truncated.rows;

  if (rows.length < 2) {
    return { ok: false, error: 'Arquivo vazio ou sem dados (precisa de cabeçalho + ao menos uma linha).' };
  }

  const rawHeaders = rows[0].map((h) => String(h || ''));
  const headerMap = buildCampaignSpreadsheetHeaderMap(rawHeaders);
  const hasPhone = headerMap.includes('phone');
  if (!hasPhone) {
    return {
      ok: false,
      error: 'Coluna «Telefone» não encontrada. Baixe o modelo ou renomeie a coluna do número.',
    };
  }

  const parsed: CampaignSpreadsheetParsedRow[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const allEmpty = row.every((c) => String(c ?? '').trim() === '');
    if (allEmpty) continue;

    const item = mapCampaignSpreadsheetDataRow(headerMap, row, i + 1);
    if (item.formatOk) {
      const k = item.phone;
      if (seen.has(k)) {
        item.formatOk = false;
        item.formatError = 'Telefone duplicado na planilha';
      } else {
        seen.add(k);
      }
    }
    parsed.push(item);
  }

  if (parsed.length === 0) {
    return { ok: false, error: 'Nenhuma linha com dados na planilha.' };
  }

  return { ok: true, rows: parsed, cutByMarker: truncated.cutByMarker };
}

/** Linhas elegíveis para disparo após verificação WhatsApp (formato OK + com WA). */
export function campaignSpreadsheetRowsReadyForSend(
  rows: CampaignSpreadsheetParsedRow[],
  waByPhone: Map<string, 'found' | 'corrected'>,
  opts?: { includeCorrected?: boolean }
): CampaignSpreadsheetParsedRow[] {
  const includeCorrected = opts?.includeCorrected !== false;
  return rows.filter((r) => {
    if (!r.formatOk) return false;
    const st = waByPhone.get(r.phone);
    if (st === 'found') return true;
    if (includeCorrected && st === 'corrected') return true;
    return false;
  });
}
