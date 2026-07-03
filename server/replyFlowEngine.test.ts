import { describe, expect, it } from 'vitest';
import { matchReplyTriggerToken, replyMatchesGate } from './replyFlowEngine.js';

describe('matchReplyTriggerToken', () => {
  it('aceita resposta exata', () => {
    expect(matchReplyTriggerToken('1', '1')).toBe(true);
    expect(matchReplyTriggerToken('excluir', 'excluir')).toBe(true);
  });

  it('aceita palavra-chave com pontuação', () => {
    expect(matchReplyTriggerToken('1', '1!')).toBe(true);
    expect(matchReplyTriggerToken('sim', 'Sim,')).toBe(true);
  });

  it('aceita palavra-chave como primeira palavra', () => {
    expect(matchReplyTriggerToken('1', '1 quero saber')).toBe(true);
    expect(matchReplyTriggerToken('excluir', 'excluir minha conta')).toBe(true);
  });

  it('aceita palavra-chave em qualquer posição da frase', () => {
    expect(matchReplyTriggerToken('1', 'OI!! 1')).toBe(true);
    expect(matchReplyTriggerToken('excluir', 'quero excluir')).toBe(true);
    expect(matchReplyTriggerToken('excluir', 'por favor excluir meu cadastro')).toBe(true);
  });

  it('não confunde substring dentro de outra palavra', () => {
    expect(matchReplyTriggerToken('sim', 'simples')).toBe(false);
    expect(matchReplyTriggerToken('1', '10')).toBe(false);
  });

  it('aceita gatilho com espaço', () => {
    expect(matchReplyTriggerToken('nao quero', 'eu nao quero receber')).toBe(true);
  });
});

describe('replyMatchesGate', () => {
  const step = {
    body: 'test',
    acceptAnyReply: false,
    validTokens: ['excluir', '1'],
    invalidReplyBody: ''
  };

  it('dispara com qualquer token válido na frase', () => {
    expect(replyMatchesGate(step, 'quero excluir')).toBe(true);
    expect(replyMatchesGate(step, 'ok 1')).toBe(true);
  });

  it('respeita acceptAnyReply', () => {
    expect(replyMatchesGate({ ...step, acceptAnyReply: true }, 'qualquer coisa')).toBe(true);
  });
});
