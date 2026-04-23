import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Mini-CRM no navegador: notas, tags, status, pin e lembrete por conversa.
 * Armazenado em localStorage escopo por UID de usuario (sincroniza entre abas).
 */

export type ClientStatus = 'lead' | 'cliente' | 'pendente' | 'resolvido';

export interface ClientCrmData {
  notes?: string;
  tags?: string[];
  status?: ClientStatus;
  pinned?: boolean;
  reminderAt?: number;
  favoriteAt?: number;
  updatedAt?: number;
}

const STORAGE_KEY = 'zapmass-crm-v1';

type Store = Record<string, Record<string, ClientCrmData>>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore storage erros (quota exceeded, safari privado, etc) */
  }
}

export function useClientCrm(userUid: string | undefined) {
  const uid = userUid || 'anon';
  const [data, setData] = useState<Record<string, ClientCrmData>>({});

  useEffect(() => {
    const store = readStore();
    setData(store[uid] || {});
    // Escuta mudancas de outras abas do mesmo navegador.
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const store2 = readStore();
      setData(store2[uid] || {});
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [uid]);

  const update = useCallback(
    (conversationId: string, patch: Partial<ClientCrmData>) => {
      const store = readStore();
      const userData = store[uid] || {};
      const current = userData[conversationId] || {};
      const next: ClientCrmData = { ...current, ...patch, updatedAt: Date.now() };
      store[uid] = { ...userData, [conversationId]: next };
      writeStore(store);
      setData((prev) => ({ ...prev, [conversationId]: next }));
    },
    [uid]
  );

  const clear = useCallback(
    (conversationId: string) => {
      const store = readStore();
      const userData = store[uid] || {};
      const next = { ...userData };
      delete next[conversationId];
      store[uid] = next;
      writeStore(store);
      setData(next);
    },
    [uid]
  );

  const get = useCallback(
    (conversationId: string): ClientCrmData => data[conversationId] || {},
    [data]
  );

  const togglePin = useCallback(
    (conversationId: string) => {
      const current = data[conversationId] || {};
      update(conversationId, { pinned: !current.pinned });
    },
    [data, update]
  );

  const stats = useMemo(() => {
    const values = Object.values(data);
    return {
      total: values.length,
      pinned: values.filter((v) => v.pinned).length,
      leads: values.filter((v) => v.status === 'lead').length,
      clientes: values.filter((v) => v.status === 'cliente').length,
      pendentes: values.filter((v) => v.status === 'pendente').length,
      resolvidos: values.filter((v) => v.status === 'resolvido').length,
      comReminder: values.filter((v) => v.reminderAt && v.reminderAt > Date.now()).length
    };
  }, [data]);

  return { data, get, update, clear, togglePin, stats };
}

export const STATUS_META: Record<ClientStatus, { label: string; color: string; bg: string; emoji: string }> = {
  lead: { label: 'Lead', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', emoji: '✨' },
  cliente: { label: 'Cliente', color: '#10b981', bg: 'rgba(16,185,129,0.15)', emoji: '💚' },
  pendente: { label: 'Pendente', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', emoji: '⏳' },
  resolvido: { label: 'Resolvido', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', emoji: '✅' }
};

const TAG_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#6366f1',
  '#84cc16', '#f97316'
];

export function hashTagColor(tag: string): string {
  if (!tag) return TAG_COLORS[0];
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[h % TAG_COLORS.length];
}
