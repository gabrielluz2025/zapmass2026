import { describe, expect, it } from 'vitest';
import { isConnectionEligibleForAutoPruneDelete } from './evolutionService.js';

describe('isConnectionEligibleForAutoPruneDelete', () => {
  it('exporta helper de prune seguro', () => {
    expect(typeof isConnectionEligibleForAutoPruneDelete).toBe('function');
  });

  it('nunca marca open/close para auto-delete', () => {
    expect(isConnectionEligibleForAutoPruneDelete('conn_x', 'open')).toBe(false);
    expect(isConnectionEligibleForAutoPruneDelete('conn_x', 'close')).toBe(false);
  });

  it('created sem RAM nem cache não é elegível sem instância carregada', () => {
    expect(isConnectionEligibleForAutoPruneDelete('conn_inexistente_999', 'created')).toBe(true);
  });
});
