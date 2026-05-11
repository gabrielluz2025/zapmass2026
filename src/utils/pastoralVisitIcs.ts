import type { PastoralVisit } from '../types/pastoralVisit';

function escapeIcsText(s: string): string {
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatUtcCompact(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

/** Gera conteúdo iCalendar (RFC 5545) mínimo para uma visita. Horários em UTC (instante absoluto). */
export function buildPastoralVisitIcs(v: PastoralVisit): string {
  const start = new Date(v.scheduledStartMs);
  const end = new Date(v.scheduledEndMs);
  const dtStamp = formatUtcCompact(new Date());
  const dtStart = formatUtcCompact(start);
  const dtEnd = formatUtcCompact(end);
  const uid = `${v.id}@zapmass-pastoral`;
  const summary = escapeIcsText(`Visita pastoral — ${v.contactName}`);
  const descParts = [
    v.communionNeeded ? 'Santa Ceia: sim (marcar no ZapMass ao concluir).' : null,
    v.notes?.trim() ? v.notes.trim() : null,
    `Telefone: ${v.phone}`
  ].filter(Boolean) as string[];
  const description = escapeIcsText(descParts.join('\n'));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZapMass//Pastoral//PT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.join('\r\n') + '\r\n';
}

export function downloadPastoralVisitIcs(v: PastoralVisit): void {
  const body = buildPastoralVisitIcs(v);
  const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (v.contactName || 'visita')
    .replace(/[^\w\u00C0-\u024F\s-]/g, '')
    .trim()
    .slice(0, 40)
    .replace(/\s+/g, '-');
  const day = new Date(v.scheduledStartMs).toISOString().slice(0, 10);
  a.href = url;
  a.download = `visita-pastoral-${safe}-${day}.ics`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
