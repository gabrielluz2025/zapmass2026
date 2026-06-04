import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCampaignGreetingKit,
  loadCampaignGreetingKits,
  saveCampaignGreetingKits,
  type CampaignGreetingKit
} from './campaignGreetings';

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  });
}

describe('campaignGreetingKits', () => {
  beforeEach(() => {
    installLocalStorageMock();
    localStorage.clear();
  });

  it('cria conjunto com nome e itens', () => {
    const kit = createCampaignGreetingKit('Igreja', ['Olá', 'Paz', 'Olá']);
    expect(kit?.name).toBe('Igreja');
    expect(kit?.items).toEqual(['Olá', 'Paz']);
  });

  it('persiste e recarrega conjuntos', () => {
    const kits: CampaignGreetingKit[] = [
      createCampaignGreetingKit('Vendas', ['Oi', 'E aí'])!,
      createCampaignGreetingKit('Formal', ['Bom dia'])!
    ];
    saveCampaignGreetingKits(kits);
    const loaded = loadCampaignGreetingKits();
    expect(loaded.length).toBe(2);
    expect(loaded.some((k) => k.name === 'Vendas' && k.items.includes('Oi'))).toBe(true);
  });
});
