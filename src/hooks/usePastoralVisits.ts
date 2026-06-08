import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import type { PastoralVisit } from '../types/pastoralVisit';
import {
  addPastoralVisit,
  deletePastoralVisit,
  listPastoralVisits,
  updatePastoralVisit
} from '../utils/pastoralVisitsStorage';

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

  const reload = useCallback(() => {
    if (!dataUid) {
      setVisits([]);
      return;
    }
    setVisits(listPastoralVisits(dataUid));
  }, [dataUid]);

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
    try {
      reload();
    } catch (err) {
      console.error('[usePastoralVisits]', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar visitas');
    } finally {
      setLoading(false);
    }
  }, [dataUid, workspaceLoading, enabled, reload]);

  const addVisit = useCallback(
    async (input: PastoralVisitCreateInput) => {
      if (!enabled) throw new Error('Função indisponível');
      if (!dataUid) throw new Error('Sem sessão');
      addPastoralVisit(dataUid, {
        contactId: input.contactId,
        phone: input.phone,
        contactName: input.contactName,
        scheduledStartMs: input.scheduledStartMs,
        scheduledEndMs: input.scheduledEndMs,
        communionNeeded: input.communionNeeded,
        notes: input.notes.trim()
      });
      reload();
    },
    [dataUid, enabled, reload]
  );

  const updateVisit = useCallback(
    async (id: string, patch: Record<string, string | number | boolean | null>) => {
      if (!enabled) throw new Error('Função indisponível');
      if (!dataUid) throw new Error('Sem sessão');
      updatePastoralVisit(dataUid, id, patch);
      reload();
    },
    [dataUid, enabled, reload]
  );

  const deleteVisit = useCallback(
    async (id: string) => {
      if (!enabled) throw new Error('Função indisponível');
      if (!dataUid) throw new Error('Sem sessão');
      deletePastoralVisit(dataUid, id);
      reload();
    },
    [dataUid, enabled, reload]
  );

  const value = useMemo(
    () => ({ visits, loading, error, addVisit, updateVisit, deleteVisit, dataUid }),
    [visits, loading, error, addVisit, updateVisit, deleteVisit, dataUid]
  );

  return value;
}
