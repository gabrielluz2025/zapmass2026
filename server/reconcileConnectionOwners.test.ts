import { describe, expect, it } from 'vitest';
import { planConnectionOwnerReconciliation, type TenantUser } from './reconcileConnectionOwners.js';

const tenant: TenantUser = {
  id: 'd497c1c3-4d3e-41ea-a0a9-cb9ab61b77bc',
  email: 'cliente@example.com',
  displayName: 'Cliente',
};

describe('planConnectionOwnerReconciliation', () => {
  it('não remove conn_* restaurado que já tem ownerUid (mesmo sem friendlyName)', async () => {
    const actions = await planConnectionOwnerReconciliation(
      {
        conn_1788007756061_5: { ownerUid: tenant.id, createdByUid: tenant.id },
      },
      { users: [tenant], evolutionLabels: {} }
    );
    expect(actions.filter((a) => a.kind === 'remove')).toEqual([]);
  });

  it('remove só conn_* órfão de verdade (sem dono e sem nome)', async () => {
    const actions = await planConnectionOwnerReconciliation(
      {
        conn_1788007756061_5: {},
      },
      { users: [tenant], evolutionLabels: {} }
    );
    expect(actions).toEqual([
      {
        kind: 'remove',
        connId: 'conn_1788007756061_5',
        label: 'conn_1788007756061_5',
        reason: 'Canal offline órfão (sem nome amigável)',
      },
    ]);
  });

  it('respeita opts.users em vez do cache global', async () => {
    const other: TenantUser = {
      id: '012d0184-b072-4795-bfd0-c90a0f1667a9',
      email: 'outro@example.com',
      displayName: 'Outro',
    };
    const actions = await planConnectionOwnerReconciliation(
      {
        conn_1788007756061_5: { ownerUid: other.id, createdByUid: other.id },
      },
      { users: [other], evolutionLabels: {} }
    );
    expect(actions.filter((a) => a.kind === 'remove')).toEqual([]);
  });
});
