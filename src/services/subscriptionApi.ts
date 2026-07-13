import type { UserSubscription } from '../types';
import { apiFetchJson } from '../utils/apiFetchAuth';
import { BOOTSTRAP_API_TIMEOUT_MS } from '../utils/bootstrapSessionCache';

export async function fetchSubscription(): Promise<UserSubscription | null> {
  const j = await apiFetchJson<{ subscription?: UserSubscription | null }>('/api/subscription', {
    timeoutMs: BOOTSTRAP_API_TIMEOUT_MS
  });
  return j.subscription ?? null;
}
