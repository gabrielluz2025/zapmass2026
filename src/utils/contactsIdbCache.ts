/**
 * Cache de contatos via IndexedDB — suporta centenas de MB sem cota.
 * O localStorage estoura silenciosamente com bases >42k contatos (JSON ~30-80MB).
 *
 * Estrutura:
 *   DB:    zapmass-contacts-cache  (version 1)
 *   Store: contacts
 *   Key:   `${uid}:${day}`  (ex.: "abc123:2026-06-25")
 *   Value: { uid, day, cachedAt, contacts }
 */
import type { Contact } from '../types';
import { calendarDayKey } from '../../shared/dailyFullSync';

const DB_NAME = 'zapmass-contacts-cache';
const DB_VERSION = 1;
const STORE = 'contacts';

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
  return `${uid}:${day}`;
}

export type ContactsIdbEntry = {
  uid: string;
  day: string;
  cachedAt: number;
  contacts: Contact[];
};

/**
 * Lê contatos do cache IDB do dia atual.
 * Retorna null se não existe, se o dia não bate, ou se IDB não está disponível.
 */
export async function readContactsFromIdb(uid: string): Promise<Contact[] | null> {
  if (typeof indexedDB === 'undefined' || !uid) return null;
  const day = calendarDayKey();
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(idbKey(uid, day));
      req.onsuccess = () => {
        const entry = req.result as ContactsIdbEntry | undefined;
        if (!entry || entry.uid !== uid || entry.day !== day) {
          resolve(null);
          return;
        }
        resolve(entry.contacts);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Grava contatos no IDB de forma assíncrona (não bloqueia a UI).
 * Remove automaticamente entradas de dias anteriores para este uid.
 */
export async function writeContactsToIdb(uid: string, contacts: Contact[]): Promise<void> {
  if (typeof indexedDB === 'undefined' || !uid || contacts.length === 0) return;
  const day = calendarDayKey();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const entry: ContactsIdbEntry = { uid, day, cachedAt: Date.now(), contacts };
      store.put(entry, idbKey(uid, day));

      // Limpa entradas antigas do mesmo uid (outros dias)
      const rangeReq = store.getAllKeys();
      rangeReq.onsuccess = () => {
        const allKeys = rangeReq.result as string[];
        for (const key of allKeys) {
          if (typeof key === 'string' && key.startsWith(`${uid}:`) && !key.endsWith(`:${day}`)) {
            store.delete(key);
          }
        }
      };

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
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
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    // silencioso
  }
}
