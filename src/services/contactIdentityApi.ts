import { apiFetchJson } from '../utils/apiFetchAuth';

export type ContactProfileSnapshot = {
  phoneDigits: string;
  contactId: string | null;
  contactName: string | null;
  optedOut: boolean;
  leadScore: number;
  leadBand: string;
  preferredConnectionId: string | null;
  lastCampaignId: string | null;
  campaignStates: Array<{
    campaignId: string;
    status: string;
    stepIndex: number;
    replyText: string | null;
  }>;
  nurturePending: boolean;
  timeline: Array<{
    id: string;
    kind: string;
    at: string;
    connectionId: string | null;
    campaignId: string | null;
    summary: string;
  }>;
  mergedMessageCount: number;
};

export async function fetchContactIdentityProfile(
  phoneDigits: string
): Promise<{ ok: boolean; profile?: ContactProfileSnapshot; error?: string }> {
  const path = `/api/contacts/identity/${encodeURIComponent(phoneDigits)}`;
  return apiFetchJson(path, { timeoutMs: 30_000 });
}

export async function reconcileContactIdentity(
  phoneDigits: string
): Promise<{ ok: boolean; profile?: ContactProfileSnapshot; error?: string }> {
  const path = `/api/contacts/identity/${encodeURIComponent(phoneDigits)}/reconcile`;
  return apiFetchJson(path, { method: 'POST', timeoutMs: 45_000 });
}
