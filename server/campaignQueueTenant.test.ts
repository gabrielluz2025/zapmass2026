import { describe, expect, it } from 'vitest';
import {
  buildQueueRemoveConfirmPhrase,
  maskQueuePhone,
  parseQueueRemoveConfirm,
  queueJobStepIndex,
} from '../shared/campaignQueueTenantHelpers.js';
import { inferRemoveConfirmScope, queueJobBelongsToTenant } from './campaignQueueTenant.js';

describe('campaignQueueTenantHelpers', () => {
  it('queueJobStepIndex prefere multiStepContact', () => {
    expect(queueJobStepIndex({ stageIndex: 0, multiStepContact: { stepIndex: 2 } })).toBe(2);
  });

  it('maskQueuePhone mascara dígitos', () => {
    expect(maskQueuePhone('5511999887766')).toMatch(/7766/);
    expect(maskQueuePhone('5511999887766')).not.toContain('998877');
  });

  it('confirmação de purge exige frase exata', () => {
    const phrase = buildQueueRemoveConfirmPhrase('campaign', 'abc');
    expect(phrase).toBe('LIMPAR CAMPANHA abc');
    expect(parseQueueRemoveConfirm({ confirm: phrase }, 'campaign', 'abc')).toBe(true);
    expect(parseQueueRemoveConfirm({ confirm: 'errado' }, 'campaign', 'abc')).toBe(false);
  });
});

describe('inferRemoveConfirmScope', () => {
  it('deriva escopo por filtros', () => {
    expect(inferRemoveConfirmScope({ campaignId: 'c1', stepIndex: 2 }).scope).toBe('step');
    expect(inferRemoveConfirmScope({ connectionId: 'ch1' }).scope).toBe('channel');
    expect(inferRemoveConfirmScope({ jobIds: ['j1'] }).scope).toBe('jobs');
  });
});

describe('queueJobBelongsToTenant', () => {
  it('aceita job sem owner (legado)', () => {
    expect(queueJobBelongsToTenant({ campaignId: 'x' }, 'tenant-a')).toBe(true);
  });
});
