import { describe, expect, it, vi } from 'vitest';
import { refreshRedispatchTargetPhones } from './campaignRedispatchPhoneRefresh.js';

vi.mock('./crmContactIndexCache.js', () => ({
  getCrmContactIndexes: vi.fn(async () => ({
    nameIndex: new Map(),
    byName: new Map(),
    byDigits: new Map([
      ['554784556296', '5547984556296'],
      ['5547984556296', '5547984556296'],
    ]),
  })),
}));

describe('refreshRedispatchTargetPhones', () => {
  it('substitui telefone do snapshot pelo cadastro CRM atualizado', async () => {
    const out = await refreshRedispatchTargetPhones('tenant-1', [
      { phone: '554784556296', stepIndex: 0 },
    ]);
    expect(out[0].phone).toBe('5547984556296');
  });
});
