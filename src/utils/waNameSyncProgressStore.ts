/** Progresso do sync de nomes WA — sobrevive a remount da aba Contatos. */

import { calendarDayKey } from '../../shared/dailyFullSync';

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
  /** Evita auto-disparar várias vezes no mesmo dia neste browser. */
  autoStartedOnce: boolean;
  /** Job silencioso (auto): some o cartão ao terminar. */
  autoCloseOnDone: boolean;
};

type Listener = () => void;

const AUTO_DAY_KEY = 'zm:wa-name-sync-auto-day';

function readAutoStartedToday(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(AUTO_DAY_KEY) === calendarDayKey();
  } catch {
    return false;
  }
}

export function markWaNameSyncAutoStartedToday(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(AUTO_DAY_KEY, calendarDayKey());
  } catch {
    /* private mode */
  }
}

let state: WaNameSyncProgressState = {
  docked: false,
  job: null,
  autoStartedOnce: readAutoStartedToday(),
  autoCloseOnDone: false,
};
const listeners = new Set<Listener>();

export function getWaNameSyncProgress(): WaNameSyncProgressState {
  return state;
}

export function setWaNameSyncProgress(partial: Partial<WaNameSyncProgressState>): void {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function clearWaNameSyncProgress(): void {
  state = { ...state, docked: false, job: null, autoCloseOnDone: false };
  listeners.forEach((l) => l());
}

export function subscribeWaNameSyncProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
