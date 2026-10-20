import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBSCRIPTION_REQUIRED_MSG,
  formatSubscriptionRequiredMessage,
  isSubscriptionRequiredError,
  SubscriptionRequiredError,
} from './subscriptionRequiredFlow';

describe('subscriptionRequiredFlow', () => {
  it('usa mensagem padrão quando vazia', () => {
    expect(formatSubscriptionRequiredMessage()).toBe(DEFAULT_SUBSCRIPTION_REQUIRED_MSG);
    expect(formatSubscriptionRequiredMessage('  ')).toBe(DEFAULT_SUBSCRIPTION_REQUIRED_MSG);
    expect(formatSubscriptionRequiredMessage('  Custom  ')).toBe('Custom');
  });

  it('identifica SubscriptionRequiredError', () => {
    const err = new SubscriptionRequiredError('x');
    expect(isSubscriptionRequiredError(err)).toBe(true);
    expect(isSubscriptionRequiredError(new Error('x'))).toBe(false);
  });
});
