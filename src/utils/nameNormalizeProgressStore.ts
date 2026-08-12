/** Progresso da padronização de nomes — sobrevive a remount da aba Contatos. */

export type NameNormalizeProgressJob = {
  id: string;
  status: string;
  total: number;
  scanned: number;
  updated: number;
  percent: number;
  message: string;
  error?: string;
};

export type NameNormalizeProgressState = {
  docked: boolean;
  job: NameNormalizeProgressJob | null;
};

type Listener = () => void;

let state: NameNormalizeProgressState = { docked: false, job: null };
const listeners = new Set<Listener>();

export function getNameNormalizeProgress(): NameNormalizeProgressState {
  return state;
}

export function setNameNormalizeProgress(partial: Partial<NameNormalizeProgressState>): void {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function clearNameNormalizeProgress(): void {
  state = { docked: false, job: null };
  listeners.forEach((l) => l());
}

export function subscribeNameNormalizeProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
