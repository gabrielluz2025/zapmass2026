/** Preview da revisão de importação (XLSX/CSV) — sobrevive a remount da aba Contatos. */

export type FileImportPreviewFilter = 'all' | 'problem' | 'duplicate' | 'ready';

export type ImportTargetMode = 'none' | 'new' | 'existing';

export type FileImportPreviewRow = {
  id: string;
  lineNumber: number;
  include: boolean;
  contact: {
    name: string;
    phone: string;
    city?: string;
    state?: string;
    neighborhood?: string;
    street?: string;
    zipCode?: string;
    number?: string;
    email?: string;
    birthday?: string;
    notes?: string;
    tags?: string[];
    [key: string]: unknown;
  };
};

export type FileImportPreviewSnapshot = {
  open: boolean;
  rows: FileImportPreviewRow[];
  label: string;
  filter: FileImportPreviewFilter;
  targetMode: ImportTargetMode;
  targetListId: string;
  newListName: string;
};

type Listener = () => void;

let snapshot: FileImportPreviewSnapshot | null = null;
const listeners = new Set<Listener>();

export function getFileImportPreviewSnapshot(): FileImportPreviewSnapshot | null {
  return snapshot;
}

export function setFileImportPreviewSnapshot(next: FileImportPreviewSnapshot | null): void {
  snapshot = next;
  listeners.forEach((l) => l());
}

export function patchFileImportPreviewSnapshot(
  partial: Partial<FileImportPreviewSnapshot>
): void {
  if (!snapshot) return;
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((l) => l());
}

export function subscribeFileImportPreviewSnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
