import { describe, expect, it } from 'vitest';
import {
  buildInboxWebhookHealthForOwner,
  classifyWebhookEventKind,
  markEvolutionWebhookRepairAttempt,
  recordEvolutionWebhookActivity,
} from './evolutionWebhookHealth.js';

describe('evolutionWebhookHealth', () => {
  it('classifica eventos de inbox', () => {
    expect(classifyWebhookEventKind('MESSAGES_UPSERT')).toBe('inbox');
    expect(classifyWebhookEventKind('messages.update')).toBe('inbox');
    expect(classifyWebhookEventKind('HISTORY_SYNC')).toBe('inbox');
    expect(classifyWebhookEventKind('CONNECTION_UPDATE')).toBe('connection');
  });

  it('marca waiting quando chip open sem mensagens recentes (dentro do grace)', async () => {
    const health = await buildInboxWebhookHealthForOwner(
      'tenant-1',
      [{ id: 'chip-wait', lastOpenAt: Date.now() - 20 * 60_000 }],
      'evolution-go'
    );
    expect(health.openChips).toBe(1);
    expect(health.status).toBe('waiting');
  });

  it('marca ok após MESSAGES_UPSERT', async () => {
    recordEvolutionWebhookActivity('chip-b', 'inbox');
    const health = await buildInboxWebhookHealthForOwner(
      'tenant-1',
      [{ id: 'chip-b', lastOpenAt: Date.now() - 3600_000 }],
      'evolution-go'
    );
    expect(health.status).toBe('ok');
    expect(health.lastInboxWebhookAt).toBeTruthy();
  });

  it('grace pós-reparo evita status stale contínuo', async () => {
    await markEvolutionWebhookRepairAttempt('chip-repair');
    const health = await buildInboxWebhookHealthForOwner(
      'tenant-1',
      [{ id: 'chip-repair', lastOpenAt: Date.now() - 8 * 3600_000 }],
      'evolution-go'
    );
    expect(health.status).toBe('waiting');
    expect(health.staleConnectionIds).toBeUndefined();
  });
});
