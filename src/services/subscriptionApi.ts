import type { UserSubscription } from '../types';
import { apiFetchJson } from '../utils/apiFetchAuth';

export async function fetchSubscription(): Promise<UserSubscription | null> {
  const j = await apiFetchJson<{ subscription?: UserSubscription | null }>('/api/subscription');
  return j.subscription ?? null;
}
