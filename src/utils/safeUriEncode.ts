/** Remove surrogates UTF-16 solitários (quebram encodeURIComponent com "URI malformed"). */
export function stripBrokenSurrogates(value: string): string {
  return String(value ?? '').replace(/[\uD800-\uDFFF]/g, '');
}

export function safeEncodeURIComponent(value: string): string {
  const cleaned = stripBrokenSurrogates(value);
  try {
    return encodeURIComponent(cleaned);
  } catch {
    return encodeURIComponent('C');
  }
}
