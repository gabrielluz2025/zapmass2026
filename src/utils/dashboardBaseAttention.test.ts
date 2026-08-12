import { describe, expect, it } from 'vitest';
import type { Contact } from '../types';
import { baseAttentionBadge, computeBaseAttention } from './dashboardBaseAttention';

const c = (over: Partial<Contact>): Contact =>
  ({
    id: over.id || '1',
    name: 'Maria Silva',
    phone: '47999990000',
    tags: [],
    status: 'VALID',
    ...over
  }) as Contact;

describe('computeBaseAttention', () => {
  it('conta prontos e nomes genéricos', () => {
    const now = Date.parse('2026-08-12T12:00:00.000Z');
    const stats = computeBaseAttention(
      [
        c({ id: 'a', name: 'João', phone: '47911112222' }),
        c({ id: 'b', name: '- Casas', phone: '47911113333' }),
        c({ id: 'c', name: 'Ana', phone: '123' }),
        c({ id: 'd', name: 'Pedro', phone: '47911112222' }),
        c({ id: 'e', name: 'Lia', phone: '47911114444', marketingOptOut: true }),
        c({ id: 'f', name: 'Bia', phone: '47911115555', followUpAt: '2026-08-01T12:00:00.000Z' })
      ],
      now
    );
    expect(stats.genericNames).toBe(1);
    expect(stats.invalidPhone).toBe(1);
    expect(stats.duplicates).toBe(1);
    expect(stats.optOut).toBe(1);
    expect(stats.overdueFollowUps).toBe(1);
    expect(stats.ready).toBe(3); // João, Pedro (dup mas válido), Bia
    expect(baseAttentionBadge(stats).label).toBe('Atenção');
  });

  it('base limpa fica Pronta', () => {
    const stats = computeBaseAttention([c({ id: 'a' }), c({ id: 'b', phone: '47988887777' })]);
    expect(stats.issueCount).toBe(0);
    expect(stats.readyPct).toBe(100);
    expect(baseAttentionBadge(stats).label).toBe('Pronta');
  });
});
