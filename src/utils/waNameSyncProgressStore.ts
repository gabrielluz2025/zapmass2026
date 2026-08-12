/** Progresso do sync de nomes WA — sobrevive a remount da aba Contatos. */

export type WaNameSyncProgressJob = {
  id: string;
  status: string;
  total: number;
  scanned: number;
  updated: number;
  skipped: number;
  unavailable: number;
  failed: number;
  percent: number;
  message: string;
  error?: string;
};

export type WaNameSyncProgressState = {
  docked: boolean;
  job: WaNameSyncProgressJob | null;
  /** Evita auto-disparar várias vezes na mesma sessão. */
  autoStartedOnce: boolean;
};

type Listener = () => void;

let state: WaNameSyncProgressState = { docked: false, job: null, autoStartedOnce: false };
const listeners = new Set<Listener>();

export function getWaNameSyncProgress(): WaNameSyncProgressState {
  return state;
}

export function setWaNameSyncProgress(partial: Partial<WaNameSyncProgressState>): void {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function clearWaNameSyncProgress(): void {
  state = { ...state, docked: false, job: null };
  listeners.forEach((l) => l());
}

export function subscribeWaNameSyncProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
