import { describe, expect, it } from 'vitest';
import { classifyIntent, normalizeQuestionKey, resolveNavigateView } from './assistantRouter.js';

describe('assistantRouter', () => {
  it('classifica perguntas de dados', () => {
    expect(classifyIntent('quantos contatos tenho?')).toBe('data_contacts');
    expect(classifyIntent('campanhas ativas')).toBe('data_campaigns');
    expect(classifyIntent('chips online')).toBe('data_connections');
    expect(classifyIntent('resumo da minha conta')).toBe('data_overview');
  });

  it('classifica tutorial e criativo', () => {
    expect(classifyIntent('como conectar whatsapp qr code')).toBe('tutorial');
    expect(classifyIntent('sugira uma mensagem de cobrança')).toBe('creative');
  });

  it('resolve navegação', () => {
    expect(resolveNavigateView('ir para campanhas')).toBe('campaigns');
    expect(resolveNavigateView('abrir conexoes')).toBe('connections');
  });

  it('normaliza chave de cache', () => {
    expect(normalizeQuestionKey('  Quantos   CONTATOS? ')).toBe('quantos contatos');
  });
});
