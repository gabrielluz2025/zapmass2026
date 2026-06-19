import { describe, expect, it } from 'vitest';
import { normalizeContactName, isSuspiciousContactName } from './contactNameNormalize';

describe('normalizeContactName', () => {
  it('converte CAIXA ALTA em Title Case', () => {
    expect(normalizeContactName('JOÃO DA SILVA')).toBe('João da Silva');
  });

  it('converte minúsculo em Title Case', () => {
    expect(normalizeContactName('maria souza')).toBe('Maria Souza');
  });

  it('preserva capitalização mista intencional', () => {
    expect(normalizeContactName('iPhone da Maria')).toBe('iPhone da Maria');
    expect(normalizeContactName('McDonald Lima')).toBe('McDonald Lima');
  });

  it('colapsa espaços e apara as bordas', () => {
    expect(normalizeContactName('  Ana    Paula  ')).toBe('Ana Paula');
  });

  it('mantém partículas em minúsculo', () => {
    expect(normalizeContactName('PEDRO DE ALCANTARA DOS SANTOS')).toBe('Pedro de Alcantara dos Santos');
  });

  it('vazio retorna vazio', () => {
    expect(normalizeContactName('')).toBe('');
    expect(normalizeContactName('   ')).toBe('');
  });

  it('marca nomes suspeitos', () => {
    expect(isSuspiciousContactName('')).toBe(true);
    expect(isSuspiciousContactName('Sem Nome')).toBe(true);
    expect(isSuspiciousContactName('1234')).toBe(true);
    expect(isSuspiciousContactName('João')).toBe(false);
  });
});
