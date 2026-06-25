export type AiAssistPayload = {
  screen?: string;
  question: string;
  context?: unknown;
  autoSend?: boolean;
  openDrawer?: boolean;
};

export const AI_ASSIST_PAYLOAD_EVENT = 'zapmass:ai-assist-payload';

export function dispatchAiAssistPayload(payload: AiAssistPayload): void {
  window.dispatchEvent(new CustomEvent(AI_ASSIST_PAYLOAD_EVENT, { detail: payload }));
  if (payload.openDrawer !== false) {
    window.dispatchEvent(new CustomEvent('zapmass:open-gemini-assistant'));
  }
}
