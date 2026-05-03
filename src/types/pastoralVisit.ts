export type PastoralVisitStatus = 'scheduled' | 'done' | 'cancelled' | 'no_show';

export interface PastoralVisit {
  id: string;
  contactId: string;
  phone: string;
  contactName: string;
  scheduledStartMs: number;
  scheduledEndMs: number;
  status: PastoralVisitStatus;
  doneAtMs?: number | null;
  communionNeeded: boolean;
  communionDoneAtMs?: number | null;
  notes: string;
  createdAtMs: number;
  updatedAtMs: number;
}
