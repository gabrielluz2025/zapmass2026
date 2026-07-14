import { describe, expect, it } from 'vitest';
import { campaignRecipientNameVars } from '../src/utils/contactNameNormalize.js';
import { normalizeOutboundNumber } from './evolutionOutboundPhone.js';

/** Espelha a regra de nome usada em contactSaveToChip (sem I/O). */
function preferredContactName(name: string): string {
  const raw = (name || '').trim();
  if (!raw) return '';
  const vars = campaignRecipientNameVars(raw);
  const neat = (vars.nome_completo || vars.nome || raw).trim();
  return neat.slice(0, 80);
}

describe('save-to-chip helpers', () => {
  it('normaliza telefone BR para E.164', () => {
    expect(normalizeOutboundNumber('(11) 98888-7777')).toBe('5511988887777');
    expect(normalizeOutboundNumber('5511988887777')).toBe('5511988887777');
  });

  it('usa nome completo limpo da base', () => {
    expect(preferredContactName('  Maria Silva  ')).toContain('Maria');
    expect(preferredContactName('')).toBe('');
  });
});
