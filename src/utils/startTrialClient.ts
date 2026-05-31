import { apiUrl } from './apiBase';
import { formatTrialStartError, isIgnorableTrialStartError } from './trialStartError';

export type TrialStartResult =
  | { ok: true; trialEndsAt?: string; alreadyActive?: boolean }
  | { ok: false; error: string; status: number; ignorable: boolean };

export async function requestTrialStart(getIdToken: () => Promise<string>): Promise<TrialStartResult> {
  try {
    const idToken = await getIdToken();
    const res = await fetch(apiUrl('/api/billing/trial/start'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      trialEndsAt?: string;
      alreadyActive?: boolean;
    };
    if (res.ok && data?.ok) {
      return {
        ok: true,
        trialEndsAt: typeof data.trialEndsAt === 'string' ? data.trialEndsAt : undefined,
        alreadyActive: Boolean(data.alreadyActive)
      };
    }
    const rawErr = typeof data?.error === 'string' ? data.error : '';
    return {
      ok: false,
      error: formatTrialStartError(rawErr, res.status),
      status: res.status,
      ignorable: isIgnorableTrialStartError(rawErr)
    };
  } catch {
    return {
      ok: false,
      error: formatTrialStartError('', 0),
      status: 0,
      ignorable: false
    };
  }
}
