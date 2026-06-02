import { apiFetchJson } from '../utils/apiFetchAuth';
import type { UseSegmentId } from '../constants/useSegments';

export async function fetchAppProfile(): Promise<UseSegmentId | null> {
  const j = await apiFetchJson<{ useSegment?: string | null }>('/api/app-profile');
  const raw = j.useSegment;
  return typeof raw === 'string' && raw.length > 0 ? (raw as UseSegmentId) : null;
}

export async function saveAppProfileSegment(useSegment: UseSegmentId): Promise<void> {
  await apiFetchJson('/api/app-profile', {
    method: 'PUT',
    body: JSON.stringify({ useSegment })
  });
}
