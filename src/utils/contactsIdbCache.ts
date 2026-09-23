/**
 * Cache de contatos via IndexedDB — suporta centenas de MB sem cota.
 * O localStorage estoura silenciosamente com bases >42k contatos (JSON ~30-80MB).
 *
 * Estrutura:
 *   DB:    zapmass-contacts-cache  (version 1)
 *   Store: contacts
 *   Key:   `${uid}:${day}:phone-v2`
 *   Value: { uid, day, cachedAt, contacts }
 */
import type { Contact } from '../types';
import { calendarDayKey, DEFAULT_FULL_SYNC_INTERVAL_MS } from '../../shared/dailyFullSync';

const DB_NAME = 'zapmass-contacts-cache';
const DB_VERSION = 1;
const STORE = 'contacts';

/** Quanto tempo o cache local vale sem rebaixar a base inteira. */
export const CONTACTS_CACHE_MAX_AGE_MS = DEFAULT_FULL_SYNC_INTERVAL_MS;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

function idbKey(uid: string, day: string): string {
  return `${uid}:${day}:phone-v2`;
}

export type ContactsIdbEntry = {
  uid: string;
  day: string;
  cachedAt: number;
  contacts: Contact[];
};

function isFresh(cachedAt: number, maxAgeMs = CONTACTS_CACHE_MAX_AGE_MS): boolean {
  if (!cachedAt || cachedAt <= 0) return false;
  return Date.now() - cachedAt < maxAgeMs;
}

/**
 * Lê contatos do cache IDB.
 * Aceita qualquer entrada do uid com menos de 24h (não só o dia civil) —
 * evita rebaixar a base à meia-noite se o cache ainda está fresco.
 */
export async function readContactsFromIdb(uid: string): Promise<Contact[] | null> {
  if (typeof indexedDB === 'undefined' || !uid) return null;
  const day = calendarDayKey();
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);

      const tryToday = store.get(idbKey(uid, day));
      tryToday.onsuccess = () => {
        const entry = tryToday.result as ContactsIdbEntry | undefined;
        if (entry?.uid === uid && Array.isArray(entry.contacts) && entry.contacts.length > 0) {
          if (isFresh(entry.cachedAt) || entry.day === day) {
            resolve(entry.contacts);
            return;
          }
        }

        // Fallback: qualquer entrada fresca deste uid (mudança de dia civil).
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const rows = (allReq.result as ContactsIdbEntry[]).filter(
            (e) => e?.uid === uid && Array.isArray(e.contacts) && e.contacts.length > 0
          );
          rows.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
          const best = rows[0];
          if (best && isFresh(best.cachedAt)) {
            resolve(best.contacts);
            return;
          }
          resolve(null);
        };
        allReq.onerror = () => resolve(null);
      };
      tryToday.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Grava contatos no IDB de forma assíncrona (não bloqueia a UI).
 * Remove entradas antigas do mesmo uid — sem apagar a chave recém-gravada.
 */
export async function writeContactsToIdb(uid: string, contacts: Contact[]): Promise<void> {
  if (typeof indexedDB === 'undefined' || !uid || contacts.length === 0) return;
  const day = calendarDayKey();
  const todayKey = idbKey(uid, day);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const entry: ContactsIdbEntry = { uid, day, cachedAt: Date.now(), contacts };
      store.put(entry, todayKey);

      // BUGFIX: a chave é `${uid}:${day}:phone-v2` — NÃO termina com `:${day}`.
      // Antes: `!key.endsWith(':'+day)` apagava inclusive a entrada de hoje.
      const rangeReq = store.getAllKeys();
      rangeReq.onsuccess = () => {
        const allKeys = rangeReq.result as string[];
        for (const key of allKeys) {
          if (typeof key === 'string' && key.startsWith(`${uid}:`) && key !== todayKey) {
            store.delete(key);
          }
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // IDB não disponível (ex.: modo privado Firefox) — silencioso
  }
}

/**
 * Remove todas as entradas do uid no IDB.
 */
export async function clearContactsIdb(uid: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || !uid) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const rangeReq = store.getAllKeys();
      rangeReq.onsuccess = () => {
        const allKeys = rangeReq.result as string[];
        for (const key of allKeys) {
          if (typeof key === 'string' && key.startsWith(`${uid}:`)) {
            store.delete(key);
          }
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // silencioso
  }
}
