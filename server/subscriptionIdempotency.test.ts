import { describe, expect, it } from 'vitest';
import {
  isPaymentAlreadyProcessed,
  isPreapprovalAlreadyActivated,
  MP_PROCESSED_PAYMENT_IDS_MAX,
  shouldConsumePreapprovalBridge,
  withProcessedPaymentId,
  withTenantLock
} from './subscriptionIdempotency.js';

describe('isPaymentAlreadyProcessed', () => {
  it('detects the last payment id and ids in the processed list', () => {
    expect(isPaymentAlreadyProcessed({ mercadoPagoLastPaymentId: '10' }, '10')).toBe(true);
    expect(isPaymentAlreadyProcessed({ mercadoPagoProcessedPaymentIds: ['1', '2'] }, '2')).toBe(true);
    expect(isPaymentAlreadyProcessed({ mercadoPagoProcessedPaymentIds: ['1'] }, '3')).toBe(false);
  });

  it('is false for empty ids and missing subscription', () => {
    expect(isPaymentAlreadyProcessed(null, '1')).toBe(false);
    expect(isPaymentAlreadyProcessed({ mercadoPagoLastPaymentId: '1' }, '')).toBe(false);
  });
});

describe('withProcessedPaymentId', () => {
  it('appends without duplicates and caps the list size', () => {
    expect(withProcessedPaymentId({ mercadoPagoProcessedPaymentIds: ['1', '2'] }, '2')).toEqual(['1', '2']);
    let list: string[] = [];
    for (let i = 0; i < MP_PROCESSED_PAYMENT_IDS_MAX + 5; i++) {
      list = withProcessedPaymentId({ mercadoPagoProcessedPaymentIds: list }, String(i));
    }
    expect(list).toHaveLength(MP_PROCESSED_PAYMENT_IDS_MAX);
    expect(list[list.length - 1]).toBe(String(MP_PROCESSED_PAYMENT_IDS_MAX + 4));
  });
});

describe('preapproval helpers', () => {
  it('only treats the same preapproval id as already activated', () => {
    expect(isPreapprovalAlreadyActivated({ mercadoPagoPreapprovalActivatedId: 'a' }, 'a')).toBe(true);
    expect(isPreapprovalAlreadyActivated({ mercadoPagoPreapprovalActivatedId: 'a' }, 'b')).toBe(false);
    expect(isPreapprovalAlreadyActivated(null, 'a')).toBe(false);
  });

  it('bridge flag is consumed only when pending', () => {
    expect(shouldConsumePreapprovalBridge({ mercadoPagoPreapprovalBridgePending: true })).toBe(true);
    expect(shouldConsumePreapprovalBridge({})).toBe(false);
    expect(shouldConsumePreapprovalBridge(undefined)).toBe(false);
  });
});

describe('withTenantLock', () => {
  it('runs tasks for the same key sequentially', async () => {
    const order: string[] = [];
    const slow = withTenantLock('t1', async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a:end');
    });
    const fast = withTenantLock('t1', async () => {
      order.push('b:start');
      order.push('b:end');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('keeps going after a failing task', async () => {
    await expect(withTenantLock('t2', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(withTenantLock('t2', async () => 'ok')).resolves.toBe('ok');
  });
});
