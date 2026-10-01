import type { DiagnosticsBundle } from '../../shared/diagnosticsBundle';
import { apiFetchJson } from '../utils/apiFetchAuth';
import { APP_VERSION } from '../config/appVersion';

export type DiagnosticsRecentResponse = {
  ok: boolean;
  exportedAt?: string;
  appVersion?: string;
  recentErrors?: DiagnosticsBundle['recentErrors'];
  connections?: DiagnosticsBundle['connections'];
  campaigns?: DiagnosticsBundle['campaigns'];
  queue?: DiagnosticsBundle['queue'];
  error?: string;
};

export async function fetchDiagnosticsRecent(): Promise<DiagnosticsRecentResponse> {
  return apiFetchJson<DiagnosticsRecentResponse>('/api/diagnostics/recent');
}

export async function fetchDiagnosticsExport(clientHints?: Record<string, unknown>): Promise<{
  ok: boolean;
  bundle?: DiagnosticsBundle;
  error?: string;
}> {
  return apiFetchJson('/api/diagnostics/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientHints: {
        uiAppVersion: APP_VERSION,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
        ...clientHints,
      },
    }),
  });
}
