import type { PastoralVisit, PastoralVisitStatus } from '../types/pastoralVisit';

export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Conflito só entre visitas ainda `scheduled` (horários sobrepostos). */
export function findOverlappingScheduledVisit(
  visits: PastoralVisit[],
  startMs: number,
  endMs: number,
  excludeId?: string
): PastoralVisit | undefined {
  return visits.find(
    (v) =>
      v.id !== excludeId &&
      v.status === 'scheduled' &&
      intervalsOverlap(startMs, endMs, v.scheduledStartMs, v.scheduledEndMs)
  );
}

export function parsePastoralVisitStatus(raw: unknown): PastoralVisitStatus {
  const s = String(raw || '').trim();
  if (s === 'done' || s === 'cancelled' || s === 'no_show' || s === 'scheduled') return s;
  return 'scheduled';
}

export function visitsDoneInCalendarMonth(visits: PastoralVisit[], year: number, monthIndex0: number): PastoralVisit[] {
  return visits.filter((v) => {
    if (v.status !== 'done' || v.doneAtMs == null) return false;
    const d = new Date(v.doneAtMs);
    return d.getFullYear() === year && d.getMonth() === monthIndex0;
  });
}

export function scheduledVisitsInCalendarMonth(
  visits: PastoralVisit[],
  year: number,
  monthIndex0: number
): PastoralVisit[] {
  return visits.filter((v) => {
    if (v.status !== 'scheduled') return false;
    const d = new Date(v.scheduledStartMs);
    return d.getFullYear() === year && d.getMonth() === monthIndex0;
  });
}

/** Última visita realizada por telefone (normalizado só dígitos). */
export function lastDoneVisitMsByPhone(visits: PastoralVisit[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of visits) {
    if (v.status !== 'done' || v.doneAtMs == null) continue;
    const key = (v.phone || '').replace(/\D/g, '');
    if (!key) continue;
    const prev = m.get(key);
    if (prev == null || v.doneAtMs > prev) m.set(key, v.doneAtMs);
  }
  return m;
}

export function communionPendingVisits(visits: PastoralVisit[]): PastoralVisit[] {
  return visits.filter((v) => {
    if (v.status === 'scheduled' && v.communionNeeded) return true;
    if (v.status === 'done' && v.communionNeeded && (v.communionDoneAtMs == null || v.communionDoneAtMs <= 0))
      return true;
    return false;
  });
}
