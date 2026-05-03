import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import type { PastoralVisit } from '../types/pastoralVisit';
import { parsePastoralVisitStatus } from '../utils/pastoralVisitHelpers';

const COLLECTION = 'pastoral_visits';
const MAX_DOCS = 500;

function docToVisit(d: QueryDocumentSnapshot): PastoralVisit {
  const data = d.data();
  return {
    id: d.id,
    contactId: String(data.contactId ?? ''),
    phone: String(data.phone ?? ''),
    contactName: String(data.contactName ?? ''),
    scheduledStartMs: Number(data.scheduledStartMs) || 0,
    scheduledEndMs: Number(data.scheduledEndMs) || 0,
    status: parsePastoralVisitStatus(data.status),
    doneAtMs: data.doneAtMs != null ? Number(data.doneAtMs) : null,
    communionNeeded: Boolean(data.communionNeeded),
    communionDoneAtMs: data.communionDoneAtMs != null ? Number(data.communionDoneAtMs) : null,
    notes: String(data.notes ?? ''),
    createdAtMs: Number(data.createdAtMs) || Date.now(),
    updatedAtMs: Number(data.updatedAtMs) || Date.now()
  };
}

export type PastoralVisitCreateInput = {
  contactId: string;
  phone: string;
  contactName: string;
  scheduledStartMs: number;
  scheduledEndMs: number;
  communionNeeded: boolean;
  notes: string;
};

type UsePastoralVisitsOpts = { enabled?: boolean };

export function usePastoralVisits(opts: UsePastoralVisitsOpts = {}) {
  const { enabled = true } = opts;
  const { user } = useAuth();
  const { effectiveWorkspaceUid, loading: workspaceLoading } = useWorkspace();
  const dataUid = effectiveWorkspaceUid ?? user?.uid ?? null;

  const [visits, setVisits] = useState<PastoralVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVisits([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (workspaceLoading) return;
    if (!dataUid) {
      setVisits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const q = query(
      collection(db, 'users', dataUid, COLLECTION),
      orderBy('scheduledStartMs', 'desc'),
      limit(MAX_DOCS)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setVisits(snap.docs.map(docToVisit));
        setLoading(false);
      },
      (err) => {
        console.error('[usePastoralVisits]', err);
        setError(err?.message || 'Erro ao carregar visitas');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [dataUid, workspaceLoading, enabled]);

  const addVisit = useCallback(
    async (input: PastoralVisitCreateInput) => {
      if (!enabled) throw new Error('Função indisponível');
      if (!dataUid) throw new Error('Sem sessão');
      const now = Date.now();
      await addDoc(collection(db, 'users', dataUid, COLLECTION), {
        contactId: input.contactId,
        phone: input.phone,
        contactName: input.contactName,
        scheduledStartMs: input.scheduledStartMs,
        scheduledEndMs: input.scheduledEndMs,
        status: 'scheduled',
        doneAtMs: null,
        communionNeeded: input.communionNeeded,
        communionDoneAtMs: null,
        notes: input.notes.trim(),
        createdAtMs: now,
        updatedAtMs: now
      });
    },
    [dataUid, enabled]
  );

  const updateVisit = useCallback(
    async (id: string, patch: Record<string, string | number | boolean | null>) => {
      if (!enabled) throw new Error('Função indisponível');
      if (!dataUid) throw new Error('Sem sessão');
      const payload: Record<string, string | number | boolean | null> = { updatedAtMs: Date.now() };
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) payload[k] = v;
      }
      await updateDoc(doc(db, 'users', dataUid, COLLECTION, id), payload);
    },
    [dataUid, enabled]
  );

  const deleteVisit = useCallback(
    async (id: string) => {
      if (!enabled) throw new Error('Função indisponível');
      if (!dataUid) throw new Error('Sem sessão');
      await deleteDoc(doc(db, 'users', dataUid, COLLECTION, id));
    },
    [dataUid, enabled]
  );

  const value = useMemo(
    () => ({ visits, loading, error, addVisit, updateVisit, deleteVisit, dataUid }),
    [visits, loading, error, addVisit, updateVisit, deleteVisit, dataUid]
  );

  return value;
}
