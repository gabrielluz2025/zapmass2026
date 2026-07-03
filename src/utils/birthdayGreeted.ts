import type { Campaign, Conversation } from '../types';

const STORAGE_KEY = 'zapmass.birthdayGreeted';

type GreetedStore = {
  date: string;
  ids: string[];
};

const BIRTHDAY_CAMPAIGN_NAME_RE =
  /anivers[aá]rio|aniversariantes|parab[eê]ns\s+autom[aá]tico|feliz\s+anivers/i;
const BIRTHDAY_MESSAGE_RE =
  /feliz\s+anivers|parab[eé]ns|🎂|🎉|anivers[aá]rio/i;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function isTodayMs(ms: number): boolean {
  if (!Number.isFinite(ms) || ms <= 0) return false;
  const d = new Date(ms);
  const t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
}

function isTodayIso(iso?: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && isTodayMs(t);
}

function normPhoneKey(raw?: string): string {
  return String(raw || '').replace(/\D/g, '');
}

function readStore(): GreetedStore {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
    if (!raw) return { date: todayKey(), ids: [] };
    const parsed = JSON.parse(raw) as GreetedStore;
    if (!parsed || parsed.date !== todayKey() || !Array.isArray(parsed.ids)) {
      return { date: todayKey(), ids: [] };
    }
    return parsed;
  } catch {
    return { date: todayKey(), ids: [] };
  }
}

function writeStore(store: GreetedStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
}

export function getBirthdayGreetedIds(): Set<string> {
  return new Set(readStore().ids);
}

export function markBirthdayGreeted(contactId: string): void {
  const id = String(contactId || '').trim();
  if (!id) return;
  const store = readStore();
  if (!store.ids.includes(id)) store.ids.push(id);
  writeStore(store);
}

export function markBirthdayGreetedMany(contactIds: string[]): void {
  const store = readStore();
  let changed = false;
  for (const raw of contactIds) {
    const id = String(raw || '').trim();
    if (id && !store.ids.includes(id)) {
      store.ids.push(id);
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

export function isBirthdayGreetedToday(contactId: string): boolean {
  return getBirthdayGreetedIds().has(String(contactId || '').trim());
}

export function isBirthdayCampaignName(name?: string): boolean {
  return BIRTHDAY_CAMPAIGN_NAME_RE.test(String(name || ''));
}

function buildPhoneToContactId(contacts: Array<{ id: string; phone?: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contacts) {
    const key = normPhoneKey(c.phone);
    if (key.length >= 10) map.set(key, c.id);
  }
  return map;
}

function contactIdFromPhone(phoneToId: Map<string, string>, phone?: string): string | null {
  const key = normPhoneKey(phone);
  return phoneToId.get(key) || null;
}

/** Recupera envios de aniversário feitos hoje antes do controle local existir. */
export function hydrateBirthdayGreetedFromCampaigns(
  campaigns: Campaign[],
  contacts: Array<{ id: string; phone?: string }>
): number {
  const phoneToId = buildPhoneToContactId(contacts);
  const ids: string[] = [];

  for (const campaign of campaigns) {
    if (!isBirthdayCampaignName(campaign.name)) continue;
    const ranToday =
      isTodayIso(campaign.lastRunAt) ||
      isTodayIso(campaign.createdAt) ||
      (campaign.successCount > 0 && isTodayIso(campaign.reportSnapshotAt));
    if (!ranToday) continue;
    if ((campaign.successCount || 0) < 1 && (campaign.processedCount || 0) < 1) continue;

    for (const row of campaign.reportSnapshot?.rows || []) {
      if (!row.sentTimestampMs || !isTodayMs(row.sentTimestampMs)) continue;
      const st = String(row.status || '').toUpperCase();
      if (st.includes('FAIL') || st.includes('SKIP') || st.includes('PEND')) continue;
      const id = contactIdFromPhone(phoneToId, row.phone);
      if (id) ids.push(id);
    }

    const snap = campaign.scheduleStartSnapshot;
    if (snap) {
      const phones = [
        ...(snap.numbers || []),
        ...(snap.recipients || []).map((r) => r.phone)
      ];
      for (const phone of phones) {
        const id = contactIdFromPhone(phoneToId, phone);
        if (id) ids.push(id);
      }
    }
  }

  if (ids.length === 0) return 0;
  markBirthdayGreetedMany(ids);
  return ids.length;
}

/** Parabéns enviados hoje pelo Atendimento (1:1), detectados pelo texto da mensagem. */
export function hydrateBirthdayGreetedFromConversations(
  conversations: Conversation[],
  contacts: Array<{ id: string; phone?: string }>
): number {
  const phoneToId = buildPhoneToContactId(contacts);
  const ids: string[] = [];

  for (const conv of conversations) {
    const contactId = contactIdFromPhone(phoneToId, conv.contactPhone);
    if (!contactId) continue;

    const msgs = Array.isArray(conv.messages) ? conv.messages : [];
    const sentBirthdayToday = msgs.some(
      (m) =>
        m.sender === 'me' &&
        isTodayMs(Number(m.timestampMs || Date.parse(m.timestamp || ''))) &&
        BIRTHDAY_MESSAGE_RE.test(String(m.text || ''))
    );
    if (sentBirthdayToday) {
      ids.push(contactId);
    }
  }

  if (ids.length === 0) return 0;
  markBirthdayGreetedMany(ids);
  return ids.length;
}

export function excludeGreetedBirthdayContacts<T extends { id: string }>(
  items: T[],
  greeted?: Set<string>
): T[] {
  const g = greeted ?? getBirthdayGreetedIds();
  if (g.size === 0) return items;
  return items.filter((item) => !g.has(item.id));
}
