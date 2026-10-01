import { describe, expect, it } from 'vitest';
import {
  isHumanManualDispatchPaused,
  markHumanManualDispatchPaused
} from './humanManualDispatchPause.js';

describe('humanManualDispatchPause', () => {
  it('marca e detecta pausa por tenant', async () => {
    const tenant = 'tenant-test-human-pause';
    const phone = '5547999887766';
    expect(await isHumanManualDispatchPaused(tenant, phone)).toBe(false);
    await markHumanManualDispatchPaused(tenant, phone);
    expect(await isHumanManualDispatchPaused(tenant, phone)).toBe(true);
    expect(await isHumanManualDispatchPaused('other-tenant', phone)).toBe(false);
  });
});
