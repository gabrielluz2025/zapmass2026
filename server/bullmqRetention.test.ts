import { afterEach, describe, expect, it } from 'vitest';
import { bullmqRemoveOnComplete, bullmqRemoveOnFail } from './bullmqRetention.js';

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
});

describe('bullmqRetention', () => {
  it('removeOnComplete usa defaults conservadores', () => {
    delete process.env.BULLMQ_REMOVE_ON_COMPLETE_COUNT;
    delete process.env.BULLMQ_REMOVE_ON_COMPLETE_AGE_SEC;
    expect(bullmqRemoveOnComplete()).toEqual({ count: 200, age: 3600 });
  });

  it('removeOnFail respeita env', () => {
    process.env.BULLMQ_REMOVE_ON_FAIL_COUNT = '100';
    process.env.BULLMQ_REMOVE_ON_FAIL_AGE_SEC = '7200';
    expect(bullmqRemoveOnFail()).toEqual({ count: 100, age: 7200 });
  });

  it('não aceita count abaixo do mínimo', () => {
    process.env.BULLMQ_REMOVE_ON_COMPLETE_COUNT = '10';
    expect(bullmqRemoveOnComplete()).toEqual({ count: 50, age: 3600 });
  });
});
