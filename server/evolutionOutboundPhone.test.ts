import { describe, expect, it } from 'vitest';
import {
  buildOutboundPhoneVariants,
  normalizeOutboundNumber,
  parseWhatsAppNumberCheckRows,
  pickWhatsAppCheckResult,
} from './evolutionOutboundPhone.js';

describe('normalizeOutboundNumber', () => {
  it('prefixa 55 em celular BR sem DDI', () => {
    expect(normalizeOutboundNumber('47991087007')).toBe('5547991087007');
  });
});

describe('buildOutboundPhoneVariants', () => {
  it('inclui variante sem 9º dígito', () => {
    const variants = buildOutboundPhoneVariants('5547991087007');
    expect(variants).toContain('5547991087007');
    expect(variants).toContain('554791087007');
  });
});

describe('parseWhatsAppNumberCheckRows', () => {
  it('aceita array na raiz', () => {
    const rows = parseWhatsAppNumberCheckRows([{ exists: true, number: '5547991087007' }]);
    expect(rows).toHaveLength(1);
  });

  it('aceita payload aninhado em data', () => {
    const rows = parseWhatsAppNumberCheckRows({
      data: [{ exists: false, number: '5547991087007' }],
    });
    expect(rows).toHaveLength(1);
  });
});

describe('pickWhatsAppCheckResult', () => {
  it('confirma número quando exists=true', () => {
    const r = pickWhatsAppCheckResult([{ exists: true, number: '5547991087007' }], '5547991087007');
    expect(r.exists).toBe(true);
    expect(r.canonicalNumber).toBe('5547991087007');
  });

  it('usa jid @s.whatsapp.net mesmo com exists=false', () => {
    const r = pickWhatsAppCheckResult(
      [{ exists: false, jid: '5547991087007@s.whatsapp.net', number: '5547991087007' }],
      '5547991087007'
    );
    expect(r.exists).toBe(true);
    expect(r.canonicalNumber).toBe('5547991087007');
  });

  it('marca @lid como lidOnly', () => {
    const r = pickWhatsAppCheckResult([{ exists: false, jid: '123456789012345@lid' }], '5547991087007');
    expect(r.exists).toBe(false);
    expect(r.lidOnly).toBe(true);
  });
});
