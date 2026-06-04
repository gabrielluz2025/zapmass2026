import { describe, expect, it } from 'vitest';
import {
  formatContactPresenceSubtitle,
  isWaPresenceLive,
  parseEvolutionPresenceWebhook,
} from './evolutionPresence';

describe('parseEvolutionPresenceWebhook', () => {
  it('lê presences por JID', () => {
    const batch = parseEvolutionPresenceWebhook(
      {
        id: '5511999999999@s.whatsapp.net',
        presences: {
          '5511999999999@s.whatsapp.net': { lastKnownPresence: 'composing' },
        },
      },
      '2026-06-01T12:00:00.000Z'
    );
    expect(batch?.entries).toEqual([
      { remoteJid: '5511999999999@s.whatsapp.net', presence: 'composing' },
    ]);
    expect(batch?.updatedAt).toBe(Date.parse('2026-06-01T12:00:00.000Z'));
  });

  it('inclui lastSeen em unavailable', () => {
    const batch = parseEvolutionPresenceWebhook({
      presences: {
        '5511888888888@s.whatsapp.net': {
          lastKnownPresence: 'unavailable',
          lastSeen: 1717200000,
        },
      },
    });
    expect(batch?.entries[0]?.lastSeenMs).toBe(1717200000 * 1000);
  });
});

describe('formatContactPresenceSubtitle', () => {
  const now = Date.parse('2026-06-01T15:00:00.000Z');

  it('mostra digitando quando presença é recente', () => {
    expect(
      formatContactPresenceSubtitle(
        {
          waPresence: 'composing',
          waPresenceUpdatedAt: now - 5_000,
        },
        now
      )
    ).toBe('digitando…');
  });

  it('não mostra online quando presença expirou', () => {
    expect(
      formatContactPresenceSubtitle(
        {
          waPresence: 'available',
          waPresenceUpdatedAt: now - 300_000,
        },
        now
      )
    ).toBe('');
  });

  it('mostra último visto quando offline', () => {
    const label = formatContactPresenceSubtitle(
      {
        waPresence: 'unavailable',
        waLastSeenMs: Date.parse('2026-06-01T14:30:00.000Z'),
        waPresenceUpdatedAt: now - 1_000,
      },
      now
    );
    expect(label).toContain('visto por último');
  });
});

describe('isWaPresenceLive', () => {
  it('marca composing como ao vivo dentro do TTL', () => {
    const t = Date.now();
    expect(isWaPresenceLive('composing', t - 10_000, t)).toBe(true);
    expect(isWaPresenceLive('unavailable', t - 10_000, t)).toBe(false);
  });
});
