/** Progresso da união de duplicados — sobrevive a remount da aba Contatos. */

export type ContactDedupeProgressJob = {
  id: string;
  status: string;
  total: number;
  scanned: number;
  groups: number;
  merged: number;
  deleted: number;
  listsUpdated: number;
  percent: number;
  message: string;
  error?: string;
};

export type ContactDedupeProgressState = {
  docked: boolean;
  job: ContactDedupeProgressJob | null;
};

type Listener = () => void;

let state: ContactDedupeProgressState = { docked: false, job: null };
const listeners = new Set<Listener>();

export function getContactDedupeProgress(): ContactDedupeProgressState {
  return state;
}

export function setContactDedupeProgress(partial: Partial<ContactDedupeProgressState>): void {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function clearContactDedupeProgress(): void {
  state = { docked: false, job: null };
  listeners.forEach((l) => l());
}

export function subscribeContactDedupeProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
