import type { PastoralVisit } from '../types/pastoralVisit';
import { parsePastoralVisitStatus } from './pastoralVisitHelpers';

const MAX = 500;

function storageKey(uid: string): string {
  return `zapmass:pastoral_visits:${uid}`;
}

function readAll(uid: string): PastoralVisit[] {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.id || ''),
          contactId: String(r.contactId || ''),
          phone: String(r.phone || ''),
          contactName: String(r.contactName || ''),
          scheduledStartMs: Number(r.scheduledStartMs) || 0,
          scheduledEndMs: Number(r.scheduledEndMs) || 0,
          status: parsePastoralVisitStatus(r.status),
          doneAtMs: r.doneAtMs != null ? Number(r.doneAtMs) : null,
          communionNeeded: Boolean(r.communionNeeded),
          communionDoneAtMs: r.communionDoneAtMs != null ? Number(r.communionDoneAtMs) : null,
          notes: String(r.notes || ''),
          createdAtMs: Number(r.createdAtMs) || Date.now(),
          updatedAtMs: Number(r.updatedAtMs) || Date.now()
        } satisfies PastoralVisit;
      })
      .filter((v) => Boolean(v.id))
      .sort((a, b) => b.scheduledStartMs - a.scheduledStartMs)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function writeAll(uid: string, visits: PastoralVisit[]): void {
  localStorage.setItem(storageKey(uid), JSON.stringify(visits.slice(0, MAX)));
}

export function listPastoralVisits(uid: string): PastoralVisit[] {
  return readAll(uid);
}

export function addPastoralVisit(
  uid: string,
  input: Omit<PastoralVisit, 'id' | 'status' | 'doneAtMs' | 'communionDoneAtMs' | 'createdAtMs' | 'updatedAtMs'> & {
    status?: PastoralVisit['status'];
  }
): PastoralVisit {
  const now = Date.now();
  const visit: PastoralVisit = {
    id: `pv_${now}_${Math.random().toString(36).slice(2, 9)}`,
    contactId: input.contactId,
    phone: input.phone,
    contactName: input.contactName,
    scheduledStartMs: input.scheduledStartMs,
    scheduledEndMs: input.scheduledEndMs,
    status: input.status || 'scheduled',
    doneAtMs: null,
    communionNeeded: input.communionNeeded,
    communionDoneAtMs: null,
    notes: input.notes,
    createdAtMs: now,
    updatedAtMs: now
  };
  const all = readAll(uid);
  writeAll(uid, [visit, ...all]);
  return visit;
}

export function updatePastoralVisit(
  uid: string,
  id: string,
  patch: Partial<
    Pick<
      PastoralVisit,
      | 'status'
      | 'doneAtMs'
      | 'communionNeeded'
      | 'communionDoneAtMs'
      | 'notes'
      | 'scheduledStartMs'
      | 'scheduledEndMs'
      | 'contactName'
      | 'phone'
      | 'contactId'
    >
  >
): void {
  const all = readAll(uid);
  const idx = all.findIndex((v) => v.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch, updatedAtMs: Date.now() };
  writeAll(uid, all);
}

export function deletePastoralVisit(uid: string, id: string): void {
  writeAll(
    uid,
    readAll(uid).filter((v) => v.id !== id)
  );
}
