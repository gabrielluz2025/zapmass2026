import type { Campaign, Contact, ContactList } from '../types';

const phoneKey = (phone: string) => phone.replace(/\D/g, '');

/** Raiz legada + `users/{uid}`: mesmo id fica o do usuário; mesmo telefone em doc diferente fica só o do usuário. */
export function mergeContacts(userList: Contact[], legacyList: Contact[]): Contact[] {
  const byId = new Map<string, Contact>();
  for (const c of legacyList) byId.set(c.id, c);
  for (const c of userList) byId.set(c.id, c);
  const userPhones = new Set(userList.map((c) => phoneKey(c.phone || '')).filter(Boolean));
  const userByPhone = new Map<string, Contact>();
  for (const u of userList) {
    const k = phoneKey(u.phone || '');
    if (k) userByPhone.set(k, u);
  }
  for (const c of legacyList) {
    const k = phoneKey(c.phone || '');
    if (k && userPhones.has(k)) {
      const winner = userByPhone.get(k);
      if (winner) {
        const prev = byId.get(winner.id);
        if (prev) {
          const aliases = new Set([...(prev.aliasContactIds || []), c.id]);
          byId.set(winner.id, { ...prev, aliasContactIds: Array.from(aliases) });
        }
      }
      byId.delete(c.id);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
}

export function mergeByIdPreferUser<T extends { id: string }>(userList: T[], legacyList: T[]): T[] {
  const byId = new Map<string, T>();
  for (const c of legacyList) byId.set(c.id, c);
  for (const c of userList) byId.set(c.id, c);
  return Array.from(byId.values());
}

const createdAtSortKey = (v: string | number | undefined): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v == null || v === '') return 0;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
};

export function mergeContactLists(userList: ContactList[], legacyList: ContactList[]): ContactList[] {
  const merged = mergeByIdPreferUser(userList, legacyList);
  return merged.sort((a, b) => createdAtSortKey(b.createdAt) - createdAtSortKey(a.createdAt));
}

export function mergeCampaigns(userList: Campaign[], legacyList: Campaign[]): Campaign[] {
  const merged = mergeByIdPreferUser(userList, legacyList);
  return merged.sort((a, b) => createdAtSortKey(b.createdAt) - createdAtSortKey(a.createdAt));
}
