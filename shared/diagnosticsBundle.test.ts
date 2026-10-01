import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticsErrorSample,
  maskPhoneForDiagnostics,
  sanitizeDiagnosticsRecord,
} from './diagnosticsBundle.js';

describe('diagnosticsBundle', () => {
  it('mascara telefone', () => {
    expect(maskPhoneForDiagnostics('5547999197637')).toBe('***7637');
  });

  it('remove segredos do objeto', () => {
    const out = sanitizeDiagnosticsRecord({ apiKey: 'x', name: 'ok' }) as Record<string, unknown>;
    expect(out.apiKey).toBe('[redacted]');
    expect(out.name).toBe('ok');
  });

  it('classifica erro de mídia', () => {
    const s = buildDiagnosticsErrorSample({
      at: new Date().toISOString(),
      source: 'campaign',
      level: 'error',
      message: 'URL is required',
    });
    expect(s.code).toBe('media_url_required');
  });
});
