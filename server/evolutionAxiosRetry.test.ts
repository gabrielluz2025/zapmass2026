import { describe, expect, it } from 'vitest';
import { evolutionNetworkUserMessage, isTransientEvolutionNetworkError } from './evolutionAxiosRetry.js';
import { formatEvolutionHttpError } from './evolutionChatSend.js';

describe('isTransientEvolutionNetworkError', () => {
  it('reconhece EAI_AGAIN do hostname evolution', () => {
    expect(
      isTransientEvolutionNetworkError({
        code: 'EAI_AGAIN',
        message: 'getaddrinfo EAI_AGAIN evolution',
      })
    ).toBe(true);
  });

  it('não trata HTTP 400 exists:false como rede', () => {
    expect(
      isTransientEvolutionNetworkError({
        message: 'Request failed with status code 400',
        response: { status: 400, data: {} },
      })
    ).toBe(false);
  });
});

describe('formatEvolutionHttpError rede', () => {
  it('não mostra contato inexistente quando o DNS da Evolution falha', () => {
    const msg = formatEvolutionHttpError({
      code: 'EAI_AGAIN',
      message: 'getaddrinfo EAI_AGAIN evolution',
    });
    expect(msg).toBe(evolutionNetworkUserMessage());
    expect(msg).not.toMatch(/não encontrado/i);
  });
});
