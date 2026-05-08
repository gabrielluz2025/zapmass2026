import { describe, it, expect } from 'vitest';
import { campaignClockVars, saudacaoFromHourBrazil } from './campaignClockVars';

describe('saudacaoFromHourBrazil', () => {
  it('retorna Bom dia das 05h às 11h', () => {
    for (const h of [5, 8, 11]) expect(saudacaoFromHourBrazil(h)).toBe('Bom dia');
  });

  it('retorna Boa tarde das 12h às 17h', () => {
    for (const h of [12, 15, 17]) expect(saudacaoFromHourBrazil(h)).toBe('Boa tarde');
  });

  it('retorna Boa noite fora do intervalo diurno', () => {
    for (const h of [0, 4, 18, 23]) expect(saudacaoFromHourBrazil(h)).toBe('Boa noite');
  });
});

describe('campaignClockVars', () => {
  it('retorna as chaves data, horario e saudacao', () => {
    const vars = campaignClockVars(new Date('2026-05-08T14:00:00Z'));
    expect(vars).toHaveProperty('data');
    expect(vars).toHaveProperty('horario');
    expect(vars).toHaveProperty('saudacao');
  });

  it('data está no formato dd/mm/aaaa', () => {
    const vars = campaignClockVars(new Date('2026-01-15T12:00:00Z'));
    expect(vars.data).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('horario está no formato HH:mm', () => {
    const vars = campaignClockVars(new Date('2026-05-08T14:00:00Z'));
    expect(vars.horario).toMatch(/^\d{2}:\d{2}$/);
  });
});
