/**
 * Erros de entrega de mídia (Evolution Go / payload) — candidatos a fallback base64 ou texto.
 */
export function isRecoverableMediaDeliveryError(detail?: string): boolean {
  const d = String(detail || '').trim();
  if (!d) return false;
  return (
    /URL is required/i.test(d) ||
    /Mídia sem URL ou base64/i.test(d) ||
    /Mídia sem conteúdo \(base64 vazio\)/i.test(d) ||
    /Sem mídia/i.test(d)
  );
}

/** Não adianta girar chips quando o payload de mídia é inválido (mesmo erro em todos). */
export function shouldSkipChipFailoverForMediaError(
  detail: string | undefined,
  opts: { replyFlowResponse?: boolean; hasTextFallback: boolean }
): boolean {
  if (!isRecoverableMediaDeliveryError(detail)) return false;
  return Boolean(opts.replyFlowResponse && opts.hasTextFallback);
}
