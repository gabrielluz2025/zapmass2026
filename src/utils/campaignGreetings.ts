const KITS_STORAGE_KEY = 'zapmass:campaign_greeting_kits';
const LEGACY_STORAGE_KEY = 'zapmass:campaign_greetings';

export const DEFAULT_CAMPAIGN_GREETINGS = ['Olá', 'Oi', 'Paz', 'E aí', 'Bom dia'];

export type CampaignGreetingKit = {
  id: string;
  name: string;
  items: string[];
  createdAt: number;
};

function newKitId(): string {
  return `kit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultKits(): CampaignGreetingKit[] {
  return [
    {
      id: 'kit_default',
      name: 'Padrão',
      items: [...DEFAULT_CAMPAIGN_GREETINGS],
      createdAt: Date.now()
    }
  ];
}

function normalizeItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = String(raw || '').trim();
    if (!t || t.length > 48) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 32) break;
  }
  return out;
}

function migrateLegacyFlatList(): CampaignGreetingKit[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const items = normalizeItems(parsed.map((s) => String(s)));
    if (items.length === 0) return null;
    return [
      {
        id: newKitId(),
        name: 'Importado',
        items,
        createdAt: Date.now()
      }
    ];
  } catch {
    return null;
  }
}

export function loadCampaignGreetingKits(): CampaignGreetingKit[] {
  try {
    const raw = localStorage.getItem(KITS_STORAGE_KEY);
    if (!raw) {
      const migrated = migrateLegacyFlatList();
      const kits = migrated ?? defaultKits();
      saveCampaignGreetingKits(kits);
      if (migrated) localStorage.removeItem(LEGACY_STORAGE_KEY);
      return kits;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultKits();
    const kits: CampaignGreetingKit[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const name = String(o.name || '').trim();
      const items = normalizeItems(Array.isArray(o.items) ? (o.items as string[]) : []);
      if (!name || items.length === 0) continue;
      kits.push({
        id: String(o.id || newKitId()),
        name: name.slice(0, 48),
        items,
        createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now()
      });
    }
    return kits.length > 0 ? kits.slice(0, 40) : defaultKits();
  } catch {
    return defaultKits();
  }
}

export function saveCampaignGreetingKits(kits: CampaignGreetingKit[]): void {
  const cleaned = kits
    .map((k) => ({
      ...k,
      name: k.name.trim().slice(0, 48),
      items: normalizeItems(k.items)
    }))
    .filter((k) => k.name.length > 0 && k.items.length > 0)
    .slice(0, 40);
  localStorage.setItem(KITS_STORAGE_KEY, JSON.stringify(cleaned.length > 0 ? cleaned : defaultKits()));
}

export function createCampaignGreetingKit(name: string, items: string[]): CampaignGreetingKit | null {
  const trimmedName = name.trim().slice(0, 48);
  const normalized = normalizeItems(items);
  if (!trimmedName || normalized.length === 0) return null;
  return {
    id: newKitId(),
    name: trimmedName,
    items: normalized,
    createdAt: Date.now()
  };
}

/** @deprecated Use loadCampaignGreetingKits — mantido para compatibilidade. */
export function loadCampaignGreetings(): string[] {
  const kits = loadCampaignGreetingKits();
  return kits[0]?.items ?? [...DEFAULT_CAMPAIGN_GREETINGS];
}

/** @deprecated */
export function saveCampaignGreetings(list: string[]): void {
  const kits = loadCampaignGreetingKits();
  const first = kits[0] ?? defaultKits()[0];
  const next = [{ ...first, items: normalizeItems(list) }, ...kits.slice(1)];
  saveCampaignGreetingKits(next);
}
