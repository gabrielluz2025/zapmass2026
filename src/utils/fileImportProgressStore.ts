/** Progresso da importação por ficheiro — sobrevive a remount da aba Contatos. */

export type FileImportJobPhase = 'autofix' | 'import' | 'list' | 'done' | 'error';

export type FileImportJobState = {
  phase: FileImportJobPhase;
  percent: number;
  current: number;
  total: number;
  message: string;
  error?: string;
  queuedBehind?: number;
};

export type FileImportProgressState = {
  docked: boolean;
  label: string;
  job: FileImportJobState | null;
};

type Listener = () => void;

let state: FileImportProgressState = {
  docked: false,
  label: '',
  job: null,
};

const listeners = new Set<Listener>();

export function getFileImportProgress(): FileImportProgressState {
  return state;
}

export function setFileImportProgress(partial: Partial<FileImportProgressState>): void {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

export function patchFileImportJob(
  job: FileImportJobState,
  extras?: Partial<Pick<FileImportProgressState, 'docked' | 'label'>>
): void {
  state = {
    docked: extras?.docked ?? state.docked,
    label: extras?.label ?? state.label,
    job,
  };
  listeners.forEach((l) => l());
}

export function clearFileImportProgress(): void {
  state = { docked: false, label: '', job: null };
  listeners.forEach((l) => l());
}

export function subscribeFileImportProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Impede dois pipelines em paralelo mesmo se a aba Contatos remountar. */
export const fileImportPipelineBusy = { current: false };
