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

  it('@lid sem telefone bloqueia envio (não manda @lid à API)', () => {
    expect(() => resolveOutboundSendTarget('69385314111689@lid', {})).toThrow(
      /não foi possível obter o número/i
    );
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
  it('traduz exists:false @lid para mensagem acionável', () => {
    const msg = formatEvolutionHttpError({
      response: {
        data: {
          response: { message: [{ exists: false, jid: '123@lid' }] }
        }
      },
      message: 'Request failed with status code 400'
    });
    expect(msg).toMatch(/não foi possível obter o número/i);
  });

  it('traduz invalid UUID do Evolution Go', () => {
    const msg = formatEvolutionHttpError({
      response: { data: { error: 'invalid UUID format: invalid UUID length: 20' } },
      message: 'Request failed with status code 400',
    });
    expect(msg).toMatch(/não reconheceu o identificador/i);
  });
});

describe('postEvolutionSendTextWithBrVariants', () => {
  it('retenta com variante sem 9º dígito após exists:false', async () => {
    const { postEvolutionSendTextWithBrVariants } = await import('./evolutionChatSend.js');
    const calls: string[] = [];
    const api = {
      post: async (url: string, body: { number?: string; numbers?: string[] }) => {
        if (String(url).includes('whatsappNumbers')) {
          return { data: [] };
        }
        calls.push(String(body.number || ''));
        if (body.number === '5547991087007') {
          const err: any = new Error('Request failed with status code 400');
          err.response = {
            data: { response: { message: [{ exists: false, jid: '5547991087007@s.whatsapp.net' }] } }
          };
          throw err;
        }
        return { data: { key: { id: 'ok1' }, status: 'PENDING' } };
      }
    };
    const result = await postEvolutionSendTextWithBrVariants(
      api as never,
      'inst',
      '5547991087007',
      'oi'
    );
    expect(calls).toEqual(['5547991087007', '554791087007']);
    expect(result.numberUsed).toBe('554791087007');
    expect(result.messageId).toBe('ok1');
  });

  it('fixo com 9 indevido envia o número de 12 dígitos primeiro', async () => {
    const { postEvolutionSendTextWithBrVariants } = await import('./evolutionChatSend.js');
    const calls: string[] = [];
    const api = {
      post: async (url: string, body: { number?: string }) => {
        if (String(url).includes('whatsappNumbers')) return { data: [] };
        calls.push(String(body.number || ''));
        return { data: { key: { id: 'ok-fixo' }, status: 'PENDING' } };
      }
    };
    const result = await postEvolutionSendTextWithBrVariants(
      api as never,
      'inst',
      '5547932375383',
      'parabens'
    );
    expect(calls[0]).toBe('554732375383');
    expect(result.numberUsed).toBe('554732375383');
  });
});
