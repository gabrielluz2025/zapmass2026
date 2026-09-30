import { apiFetchJson } from '../utils/apiFetchAuth';

export async function pauseContactAutomation(conversationId: string): Promise<{
  ok: boolean;
  jobsCancelled?: number;
  replySessionClosed?: boolean;
  error?: string;
}> {
  return apiFetchJson('/api/chat/pause-contact-automation', {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}
