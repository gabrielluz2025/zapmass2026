const STORAGE_KEY = 'zapmass:campaign_greetings';

export const DEFAULT_CAMPAIGN_GREETINGS = ['Olá', 'Oi', 'Paz', 'E aí', 'Bom dia'];

export function loadCampaignGreetings(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_CAMPAIGN_GREETINGS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_CAMPAIGN_GREETINGS];
    const list = parsed.map((s) => String(s || '').trim()).filter(Boolean);
    return list.length > 0 ? list.slice(0, 24) : [...DEFAULT_CAMPAIGN_GREETINGS];
  } catch {
    return [...DEFAULT_CAMPAIGN_GREETINGS];
  }
}

export function saveCampaignGreetings(list: string[]): void {
  const cleaned = list.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 24);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned.length > 0 ? cleaned : DEFAULT_CAMPAIGN_GREETINGS));
}
