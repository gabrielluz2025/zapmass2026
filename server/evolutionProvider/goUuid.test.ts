import { describe, expect, it } from 'vitest';
import { isEvolutionGoUuid, pickGoInstanceUuid, pickGoInstanceUuidFromRow } from './goUuid.js';

describe('isEvolutionGoUuid', () => {
  it('aceita UUID com hífens', () => {
    expect(isEvolutionGoUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });

  it('rejeita conn_* do ZapMass (length 20 típica)', () => {
    expect(isEvolutionGoUuid('conn_1787847087384_1')).toBe(false);
    expect('conn_1787847087384_1'.length).toBe(20);
  });
});

describe('pickGoInstanceUuidFromRow', () => {
  it('ignora id igual ao nome conn_* e pega instanceId UUID', () => {
    expect(
      pickGoInstanceUuidFromRow({
        id: 'conn_1787847087384_1',
        instanceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      })
    ).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });
});

describe('pickGoInstanceUuid', () => {
  it('pula candidatos inválidos', () => {
    expect(pickGoInstanceUuid('conn_1_2', '', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
  });
});
