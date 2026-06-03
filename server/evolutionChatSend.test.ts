import { describe, expect, it } from 'vitest';
import { formatEvolutionHttpError, resolveOutboundSendTarget } from './evolutionChatSend.js';

describe('resolveOutboundSendTarget', () => {
  it('normaliza telefone BR do JID @c.us', () => {
    expect(resolveOutboundSendTarget('5511999887766@c.us', null).number).toBe('5511999887766');
  });

  it('prefixa 55 em número local de 11 dígitos', () => {
    expect(resolveOutboundSendTarget('11999887766@s.whatsapp.net', null).number).toBe(
      '5511999887766'
    );
  });

  it('@lid usa contactPhone quando disponível', () => {
    expect(
      resolveOutboundSendTarget('69385314111689@lid', {
        contactPhone: '+55 11 99988-7766'
      }).number
    ).toBe('5511999887766');
  });

  it('@lid sem telefone envia JID completo', () => {
    expect(resolveOutboundSendTarget('69385314111689@lid', {}).number).toBe('69385314111689@lid');
  });

  it('prefere waJidAlt em chat @lid', () => {
    expect(
      resolveOutboundSendTarget('69385314111689@lid', {
        waJidAlt: '5511888777666@s.whatsapp.net'
      }).number
    ).toBe('5511888777666');
  });
});

describe('formatEvolutionHttpError', () => {
  it('traduz exists:false da Evolution', () => {
    const msg = formatEvolutionHttpError({
      response: {
        data: {
          response: { message: [{ exists: false, jid: '123@lid' }] }
        }
      },
      message: 'Request failed with status code 400'
    });
    expect(msg).toContain('Contato não encontrado');
    expect(msg).toContain('123@lid');
  });
});
