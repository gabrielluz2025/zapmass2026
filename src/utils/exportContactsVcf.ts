import type { Contact } from '../types';
import { zapMassFollowLinesForVcf } from './vcfZapMassFollowUp';

function escapeVcfValue(val: string): string {
  return String(val || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Um bloco VCARD VERSION:3.0 por contato — compatível com importação ZapMass e agenda móvel. */
function contactToVcardBlock(c: Contact): string {
  const digits = (c.phone || '').replace(/\D/g, '');
  const tel = digits.length >= 10 ? `+${digits}` : '';

  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVcfValue(c.name || 'Sem nome')}`];
  if (tel) lines.push(`TEL;TYPE=CELL:${tel}`);
  const email = (c.email || '').trim();
  if (email) lines.push(`EMAIL:${escapeVcfValue(email)}`);

  const addrBits = [(c.street || '').trim(), (c.number || '').trim(), (c.neighborhood || '').trim(), (c.city || '').trim(), (c.state || '').trim(), (c.zipCode || '').trim()]
    .filter(Boolean)
    .join(', ');
  const meta = [addrBits, (c.church || '').trim() ? `Igreja: ${(c.church || '').trim()}` : '', (c.role || '').trim(), (c.profession || '').trim()].filter(Boolean).join('\n');
  const zm = zapMassFollowLinesForVcf(c);
  const notePieces = [
    meta,
    (c.notes || '').trim(),
    ...zm
  ].filter(Boolean);
  const noteBody = notePieces.join('\n');
  if (noteBody) lines.push(`NOTE:${escapeVcfValue(noteBody)}`);

  const bday = (c.birthday || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(bday)) lines.push(`BDAY:${bday.replace(/-/g, '')}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** UTF-8: vários cartões concatenados em CRLF. */
export function contactsToVcfString(contacts: Contact[]): string {
  const valid = contacts.filter((c) => (c.phone || '').replace(/\D/g, '').length >= 10);
  return valid.map(contactToVcardBlock).join('\r\n');
}
