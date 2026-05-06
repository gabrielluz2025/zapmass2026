import { Campaign, Contact, ContactList } from '../types';
import { getCampaignProgressMetrics } from './campaignMetrics';

const cleanPhone = (raw: string) => (raw || '').replace(/\D/g, '');

/** Número fictício estável só para identificar linhas sem telefone real (evita colisão por índice). */
function syntheticLegacyPhone(i: number): string {
  const eight = String((10_000_000 + (i % 90_000_000)) % 100_000_000).padStart(8, '0');
  return `55119${eight}`;
}

function findContactName(phone: string, contacts: Contact[]): string {
  const t = cleanPhone(phone);
  if (!t) return '';
  for (const c of contacts) {
    if (cleanPhone(c.phone) === t) return c.name;
  }
  return '';
}

function resolveCampaignTimestampMs(c: Campaign): number {
  const candidates = [c.lastRunAt, c.createdAt];
  for (const raw of candidates) {
    if (!raw) continue;
    const t = Date.parse(String(raw));
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

export type LegacyReportRowShape = {
  id: string;
  phone: string;
  contactName: string;
  status: 'SENT' | 'FAILED';
  sentTime: string;
  sentTimestampMs: number;
  errorMessage?: string;
};

/**
 * Reconstrói linhas mínimas quando não há logs/conversas (campanhas antigas).
 * Ordem dos telefones: snapshot agendado → lista da campanha → placeholders.
 * Atribuição sucesso/falha: primeiras `fail` linhas como falha, restantes como envio ok (heurística).
 */
export function buildLegacyEstimateReportRows(args: {
  campaign: Campaign;
  contacts: Contact[];
  contactLists: ContactList[];
}): LegacyReportRowShape[] | null {
  const cm = getCampaignProgressMetrics(args.campaign);
  const accounted = Math.max(0, cm.ok + cm.fail);
  if (accounted <= 0) return null;

  const phonesFromSnapshot = (): string[] => {
    const snap = args.campaign.scheduleStartSnapshot;
    if (!snap) return [];
    const rawList = snap.recipients?.length
      ? snap.recipients.map((r) => cleanPhone(r.phone))
      : (snap.numbers || []).map((n) => cleanPhone(n));
    const filtered = rawList.filter((p) => p.length >= 8);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of filtered) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  };

  const phonesFromContactList = (): string[] => {
    const id = args.campaign.contactListId?.trim();
    if (!id) return [];
    const list = args.contactLists.find((l) => l.id === id);
    if (!list?.contactIds?.length) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const cid of list.contactIds) {
      const c = args.contacts.find((x) => x.id === cid);
      const p = cleanPhone(c?.phone || '');
      if (p.length < 8) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  };

  let phones = phonesFromSnapshot();
  if (phones.length === 0) phones = phonesFromContactList();

  const need = accounted;
  let i = 0;
  while (phones.length < need) {
    phones.push(syntheticLegacyPhone(i));
    i += 1;
  }
  phones = phones.slice(0, need);

  const tsMs = resolveCampaignTimestampMs(args.campaign);
  const sentTime = new Date(tsMs).toLocaleTimeString('pt-BR');

  const { fail } = cm;
  const rows: LegacyReportRowShape[] = [];

  for (let idx = 0; idx < phones.length; idx++) {
    const phone = phones[idx];
    const isFail = idx < fail;
    const nameFromAgenda = findContactName(phone, args.contacts);
    rows.push({
      id: `legacy-${args.campaign.id}-${idx}`,
      phone,
      contactName: nameFromAgenda || `Destinatário #${idx + 1} (estimativa)`,
      status: isFail ? 'FAILED' : 'SENT',
      sentTime,
      sentTimestampMs: tsMs,
      errorMessage: isFail ? 'Detalhe indisponível — campanha concluída antes do registro por envio.' : undefined
    });
  }

  return rows.length > 0 ? rows : null;
}
