/** Converte payload do wizard/API em formato interno de mídia de campanha. */
export function toCampaignMediaPayload(
  raw: unknown
): { base64: string; mimeType: string; fileName: string; sendMediaAsDocument?: boolean } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const dataBase64 = String(m.dataBase64 || m.base64 || '').trim();
  const mimeType = String(m.mimeType || m.mimetype || '').trim();
  if (!dataBase64 || !mimeType) return undefined;
  return {
    base64: dataBase64,
    mimeType,
    fileName: String(m.fileName || 'anexo'),
    ...(m.sendMediaAsDocument === true ? { sendMediaAsDocument: true } : {}),
  };
}
