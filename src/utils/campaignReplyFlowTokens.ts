/** Separa gatilhos do menu (vírgula, ponto-e-vírgula ou quebra de linha). */
export const parseValidTokensText = (s: string): string[] =>
  s.split(/[,;\n\r]+/).map((t) => t.trim()).filter(Boolean);

/** Rótulo legível para prévia (todos os gatilhos ou fallback). */
export const formatTokensPreview = (tokensText: string, fallback: string): string => {
  const tokens = parseValidTokensText(tokensText);
  return tokens.length > 0 ? tokens.join(' · ') : fallback;
};
