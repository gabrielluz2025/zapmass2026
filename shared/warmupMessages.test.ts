import { describe, expect, it } from 'vitest';
import { isWarmupGreetingMessage } from './warmupMessages.ts';

describe('warmup greeting detection', () => {
  it('reconhece saudações do auto-aquecimento', () => {
    expect(isWarmupGreetingMessage('Ei, tudo tranquilo?')).toBe(true);
    expect(isWarmupGreetingMessage('Boa noite! Como foi o dia?')).toBe(true);
    expect(isWarmupGreetingMessage('Olá! Alguma novidade?')).toBe(true);
  });

  it('não confunde respostas de campanha', () => {
    expect(isWarmupGreetingMessage('quero')).toBe(false);
    expect(isWarmupGreetingMessage('sim')).toBe(false);
    expect(isWarmupGreetingMessage('Amém')).toBe(false);
  });
});
