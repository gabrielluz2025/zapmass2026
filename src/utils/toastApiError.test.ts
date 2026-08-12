import { describe, expect, it } from 'vitest';
import { isOfflineToastMessage, isTransientApiError } from './toastApiError';

describe('toastApiError', () => {
  it('reconhece Failed to fetch e a mensagem envelopada da API', () => {
    expect(isOfflineToastMessage('Failed to fetch')).toBe(true);
    expect(isOfflineToastMessage('Sem conexão com o servidor: Failed to fetch')).toBe(true);
    expect(isOfflineToastMessage(new Error('Tempo esgotado ao falar com o servidor (18s). Tente de novo.'))).toBe(
      true
    );
    expect(isOfflineToastMessage('Usuário já existe')).toBe(false);
  });

  it('trata erro de rede como transitório', () => {
    expect(isTransientApiError(new Error('Sem conexão com o servidor: Failed to fetch'))).toBe(true);
    expect(isTransientApiError(new Error('Senha inválida'))).toBe(false);
  });

  it('unifica 502 e queda de socket no mesmo aviso de servidor ocupado', () => {
    expect(isOfflineToastMessage('Erro HTTP 502')).toBe(true);
    expect(isOfflineToastMessage('Erro HTTP 503')).toBe(true);
    expect(isOfflineToastMessage('Conexão perdida com o servidor.')).toBe(true);
    expect(isTransientApiError(new Error('Erro HTTP 502'))).toBe(true);
    expect(isTransientApiError(new Error('Usuário já existe'))).toBe(false);
  });
});
