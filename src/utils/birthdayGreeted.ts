const STORAGE_KEY = 'zapmass.birthdayGreeted';

type GreetedStore = {
  date: string;
  ids: string[];
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readStore(): GreetedStore {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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
  for (const raw of contactIds) {
    const id = String(raw || '').trim();
    if (id && !store.ids.includes(id)) store.ids.push(id);
  }
  writeStore(store);
}

export function isBirthdayGreetedToday(contactId: string): boolean {
  return getBirthdayGreetedIds().has(String(contactId || '').trim());
}
