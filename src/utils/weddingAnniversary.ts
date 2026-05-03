import type { Contact } from '../types';

/** Dia/mês (1–12 / 1–31) extraído da data de casamento. */
export type WeddingMd = { month: number; day: number; fullYear: number | null };

/**
 * Interpreta data de casamento (mesmos formatos habituais de aniversário).
 * Ano opcional: se faltar, só serve para recorrência dia/mês (anos de casados = null).
 */
export function parseWeddingDayMonth(raw: string | undefined): WeddingMd | null {
  const t = (raw || '').trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) {
    return {
      month: parseInt(iso[2], 10),
      day: parseInt(iso[3], 10),
      fullYear: parseInt(iso[1], 10)
    };
  }
  const br = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/.exec(t);
  if (br) {
    const day = parseInt(br[1], 10);
    const month = parseInt(br[2], 10);
    const yPart = br[3];
    let fullYear: number | null = null;
    if (yPart) {
      const y = parseInt(yPart, 10);
      fullYear = yPart.length === 2 ? 2000 + y : y;
      if (fullYear < 1920 || fullYear > 2100) fullYear = null;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day, fullYear };
  }
  const tryD = new Date(t);
  if (!isNaN(tryD.getTime())) {
    return { month: tryD.getMonth() + 1, day: tryD.getDate(), fullYear: tryD.getFullYear() };
  }
  return null;
}

export function weddingNextOccurrence(md: WeddingMd, from: Date = new Date()): Date {
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), md.month - 1, md.day);
  next.setHours(0, 0, 0, 0);
  if (next < today) next = new Date(today.getFullYear() + 1, md.month - 1, md.day);
  return next;
}

export function daysUntilWeddingAnniversary(md: WeddingMd, from: Date = new Date()): number {
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  const next = weddingNextOccurrence(md, today);
  return Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Anos de casamento que se completam na próxima data de bodas (exige ano no cadastro). */
export function yearsCelebratingAtNextAnniversary(md: WeddingMd, from: Date = new Date()): number | null {
  if (!md.fullYear || md.fullYear < 1920) return null;
  const next = weddingNextOccurrence(md, from);
  return next.getFullYear() - md.fullYear;
}

export function contactHasWeddingDate(c: Contact): boolean {
  return !!parseWeddingDayMonth(c.religiousMemberProfile?.weddingDate);
}

export function contactWeddingAnniversaryInDays(c: Contact, maxDays: number, from: Date = new Date()): number | null {
  const md = parseWeddingDayMonth(c.religiousMemberProfile?.weddingDate);
  if (!md) return null;
  const d = daysUntilWeddingAnniversary(md, from);
  return d <= maxDays ? d : null;
}

export function contactWeddingMatchesToday(c: Contact, from: Date = new Date()): boolean {
  const md = parseWeddingDayMonth(c.religiousMemberProfile?.weddingDate);
  if (!md) return false;
  return md.month === from.getMonth() + 1 && md.day === from.getDate();
}

export function contactWeddingMatchesNextDays(c: Contact, days: number, from: Date = new Date()): boolean {
  const md = parseWeddingDayMonth(c.religiousMemberProfile?.weddingDate);
  if (!md) return false;
  const d = daysUntilWeddingAnniversary(md, from);
  return d >= 0 && d < days;
}
