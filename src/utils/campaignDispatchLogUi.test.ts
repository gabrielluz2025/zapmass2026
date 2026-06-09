import { describe, expect, it } from 'vitest';
import { formatDispatchPhone, parseDispatchLog } from './campaignDispatchLogUi';

describe('campaignDispatchLogUi', () => {
  it('formata telefone brasileiro', () => {
    expect(formatDispatchPhone('5547999127001')).toBe('+55 (47) 99912-7001');
  });

  it('classifica envio e resposta', () => {
    const sent = parseDispatchLog({
      timestamp: new Date().toISOString(),
      event: 'campaign:info',
      payload: { message: 'Mensagem enviada', to: '5547999127001' }
    });
    expect(sent.kind).toBe('sent');
    expect(sent.label).toBe('Envio confirmado');

    const reply = parseDispatchLog({
      timestamp: new Date().toISOString(),
      event: 'campaign:info',
      payload: { message: 'Resposta recebida no fluxo por etapas', to: '5547999127001' }
    });
    expect(reply.kind).toBe('reply');
    expect(reply.label).toBe('Resposta no fluxo');
  });
});
