import { describe, expect, it } from 'vitest';
import { buildEvolutionWebhookJobId } from './evolutionWebhookQueue.js';

describe('buildEvolutionWebhookJobId', () => {
  it('dedupe messages.upsert pelo id da mensagem', () => {
    const event = {
      event: 'messages.upsert',
      instance: 'conn_abc',
      data: { key: { id: 'MSG1', remoteJid: '5511999999999@c.us' }, message: { conversation: 'oi' } },
    };
    const a = buildEvolutionWebhookJobId(event);
    const b = buildEvolutionWebhookJobId(event);
    expect(a).toBe(b);
    expect(a).toContain('MU__conn_abc__MSG1');
    expect(a).not.toContain(':');
  });

  it('dedupe messages.update por id e status', () => {
    const event = {
      event: 'messages.update',
      instance: 'conn_abc',
      data: { key: { id: 'MSG2' }, update: { status: 3 } },
    };
    const id = buildEvolutionWebhookJobId(event);
    expect(id).toContain('MUPD__conn_abc__MSG2__3');
    expect(id).not.toContain(':');
  });

  it('connection.update estável para mesmo payload', () => {
    const event = {
      event: 'connection.update',
      instance: 'conn_x',
      data: { state: 'open' },
    };
    expect(buildEvolutionWebhookJobId(event)).toBe(buildEvolutionWebhookJobId(event));
  });
});
