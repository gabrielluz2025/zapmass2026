import { describe, expect, it } from 'vitest';
import {
  buildQueueRemoveConfirmPhrase,
  maskQueuePhone,
  parseQueueRemoveConfirm,
  queueJobStepIndex,
} from '../shared/campaignQueueTenantHelpers.js';
import {
  inferRemoveConfirmScope,
  isTenantDeadChannelJob,
  queueJobBelongsToTenant,
} from './campaignQueueTenant.js';

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

  it('confirmação runtime órfão usa prefixo curto do UUID', () => {
    const cid = '47a44a3c-aaaa-bbbb-cccc-ddddeeeeffff';
    const phrase = buildQueueRemoveConfirmPhrase('runtime-campaign', cid);
    expect(phrase).toBe('LIMPAR RUNTIME 47a44a3c');
    expect(parseQueueRemoveConfirm({ confirm: phrase }, 'runtime-campaign', cid)).toBe(true);
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
  it('resolve dono via campanha quando ownerUid ausente', () => {
    const owner = (cid: string) => (cid === 'c1' ? 'tenant-a' : undefined);
    expect(queueJobBelongsToTenant({ campaignId: 'c1' }, 'tenant-a', owner)).toBe(true);
    expect(queueJobBelongsToTenant({ campaignId: 'c2' }, 'tenant-a', owner)).toBe(false);
  });

  it('rejeita job sem dono resolvível', () => {
    expect(queueJobBelongsToTenant({ campaignId: 'x' }, 'tenant-a')).toBe(false);
  });
});

describe('isTenantDeadChannelJob', () => {
  it('marca chip fora da conta ou offline', () => {
    const active = new Set(['a']);
    expect(isTenantDeadChannelJob('b', active)).toBe(true);
    expect(isTenantDeadChannelJob('a', active, () => false)).toBe(true);
    expect(isTenantDeadChannelJob('a', active, () => true)).toBe(false);
  });
});
