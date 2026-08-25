import { describe, expect, it } from 'vitest';
import {
  md5MessageContent,
  normalizeMessageForContentHash,
} from '../server/campaignContentHashLock.js';
import {
  INBOUND_OPT_OUT_REGEX,
  matchesInboundOptOutTrigger,
  normalizeOptOutPhoneSuffix,
  phoneMatchesJobTarget,
} from '../server/contactOptOutService.js';

describe('campaignContentHashLock', () => {
  it('normaliza espaços e caixa', () => {
    expect(normalizeMessageForContentHash('  Olá   Mundo  ')).toBe('olá mundo');
  });

  it('hash estável para mesmo conteúdo', () => {
    const a = md5MessageContent('Promoção {A|B}');
    const b = md5MessageContent('  promoção {a|b}  ');
    expect(a).toBe(b);
  });
});

describe('contactOptOutService', () => {
  it('detecta gatilhos exatos de opt-out', () => {
    expect(matchesInboundOptOutTrigger('PARAR')).toBe(true);
    expect(matchesInboundOptOutTrigger('cancelar')).toBe(true);
    expect(matchesInboundOptOutTrigger('stop')).toBe(true);
    expect(INBOUND_OPT_OUT_REGEX.test('descadastrar')).toBe(true);
    expect(matchesInboundOptOutTrigger('quero parar')).toBe(false);
    expect(matchesInboundOptOutTrigger('')).toBe(false);
  });

  it('casa variantes BR do telefone nos jobs', () => {
    expect(phoneMatchesJobTarget('5547999127001', '554799127001')).toBe(true);
    expect(phoneMatchesJobTarget('554799127001', '5547999127001')).toBe(true);
    expect(phoneMatchesJobTarget('554732375383', '5547999127001')).toBe(false);
  });

  it('normaliza sufixo de 8 dígitos para opt-out', () => {
    expect(normalizeOptOutPhoneSuffix('5547999127001')).toBe('99127001');
    expect(normalizeOptOutPhoneSuffix('554799127001')).toBe('99127001');
  });
});
