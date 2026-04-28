import { formatFollowUpLabel, parseFollowUpMs } from './followUp';

/** Linhas anexadas à NOTE do vCard para round-trip ZapMass — texto legível + ISO recuperável. */
export function zapMassFollowLinesForVcf(contact: {
  followUpAt?: string;
  followUpNote?: string;
}): string[] {
  const lines: string[] = [];
  if (contact.followUpAt && parseFollowUpMs(contact.followUpAt) != null) {
    lines.push(`Retorno ZapMass: ${formatFollowUpLabel(contact.followUpAt)} (ISO:${contact.followUpAt})`);
  }
  const note = (contact.followUpNote || '').trim();
  if (note) lines.push(`Nota retorno ZapMass — ${note.slice(0, 500)}`);
  return lines;
}

/**
 * Ao importar um vCard exportado pelo ZapMass, extrai ISO + nota e remove estas linhas
 * das observações gravadas na base para não duplicar.
 */
export function extractZapMassFollowFromVcfNotes(fullNotes: string): {
  cleanedNotes: string;
  followUpAt?: string;
  followUpNote?: string;
} {
  let s = (fullNotes || '').replace(/\r\n/g, '\n');
  let followUpAt: string | undefined;
  let followUpNote: string | undefined;

  const isoM = s.match(/\(ISO:([^)]+)\)/);
  if (isoM?.[1]) {
    const candidate = isoM[1].trim();
    if (parseFollowUpMs(candidate) != null) followUpAt = candidate;
  }

  const nm = s.match(/^Nota retorno ZapMass\s*[—\-]\s*([^\r\n]+)/m);
  if (nm?.[1]) followUpNote = nm[1].trim().slice(0, 500);

  s = s.replace(/^Retorno ZapMass:[^\r\n]*(?:\r?\n)?/gm, '');
  s = s.replace(/^Nota retorno ZapMass\s*[—\-][^\r\n]*(?:\r?\n)?/gm, '');

  const cleanedNotes = s.replace(/\r\n/g, '\n').trim();
  return { cleanedNotes: cleanedNotes.replace(/\r\n/g, '\n'), followUpAt, followUpNote };
}
