import crypto from 'node:crypto';
import type { Request } from 'express';

/** Resultado da verificação HMAC oficial (Painel MP → Webhooks → chave secreta). */
export type MercadoPagoWebhookSigResult =
  | { ok: true }
  | { ok: false; reason: string };

function timingSafeHexEqual(expectedHex: string, receivedHex: string): boolean {
  try {
    const a = Buffer.from(expectedHex.trim(), 'hex');
    const b = Buffer.from(receivedHex.trim(), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Extrai ts e v1 do cabeçalho x-signature (formato comma-separated tipo ts=...,v1=...).
 */
export function parseMercadoPagoSignatureHeader(header: string): { ts: string; v1: string } | null {
  let ts = '';
  let v1 = '';
  for (const part of header.split(',').map((p) => p.trim())) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    if (key === 'v1') v1 = value;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

/**
 * Corpo oficial: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 * Manifesto: concatena apenas partes disponíveis, terminando com `;`.
 * id deve estar em minúsculas segundo a documentação.
 */
export function buildMercadoPagoSignatureManifest(opts: {
  dataId: string;
  requestId: string | undefined;
  ts: string;
}): string {
  const chunks: string[] = [];
  const id = opts.dataId.trim().toLowerCase();
  if (id) chunks.push(`id:${id}`);
  const rid = (opts.requestId || '').trim();
  if (rid) chunks.push(`request-id:${rid}`);
  chunks.push(`ts:${opts.ts}`);
  return chunks.join(';') + ';';
}

/** Extração tolerante do id da notificação (JSON Payment API / alguns gateways). */
export function extractMercadoPagoWebhookDataId(
  req: Pick<Request, 'query'>,
  body: Record<string, unknown>
): string {
  const nested = body.data as { id?: unknown } | undefined;
  if (nested && nested.id !== undefined && nested.id !== null) {
    return String(nested.id);
  }
  const qid = req.query?.['data.id'];
  if (typeof qid === 'string') return qid;
  const qsimple = req.query?.id;
  return typeof qsimple === 'string' ? qsimple : '';
}

/** Valida cabeçalhos x-signature + x-request-id em relação ao body (já parsed JSON). */
export function verifyMercadoPagoWebhookSignature(
  req: Request,
  body: Record<string, unknown>,
  webhookSecret: string
): MercadoPagoWebhookSigResult {
  const rawSig = req.headers['x-signature'];
  const xSig = typeof rawSig === 'string' ? rawSig : Array.isArray(rawSig) ? rawSig[0] : '';
  if (!xSig) return { ok: false, reason: 'missing_x_signature_header' };

  const parsed = parseMercadoPagoSignatureHeader(xSig);
  if (!parsed) return { ok: false, reason: 'invalid_x_signature_format' };

  const rawRid = req.headers['x-request-id'];
  const rid =
    typeof rawRid === 'string'
      ? rawRid.trim()
      : Array.isArray(rawRid)
        ? String(rawRid[0] || '').trim()
        : '';

  const dataId = extractMercadoPagoWebhookDataId(req, body);
  if (!dataId.trim()) return { ok: false, reason: 'missing_notification_id' };

  const manifest = buildMercadoPagoSignatureManifest({
    dataId,
    requestId: rid || undefined,
    ts: parsed.ts
  });

  const expected = crypto.createHmac('sha256', webhookSecret).update(manifest, 'utf8').digest('hex');
  if (timingSafeHexEqual(expected, parsed.v1)) return { ok: true };
  return { ok: false, reason: 'signature_mismatch' };
}
