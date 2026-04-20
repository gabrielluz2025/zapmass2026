/** Frase curta para botoes e titulos: "1 hora", "2 horas". */
export function formatTrialHoursLabel(hours: number): string {
  const h = Math.max(1, Math.min(168, Math.round(Number(hours)) || 1));
  if (h === 1) return '1 hora';
  return `${h} horas`;
}

/** Descricao tipo "uma hora" / "3 horas" para paragrafo. */
export function formatTrialDurationPhrase(hours: number): string {
  const h = Math.max(1, Math.min(168, Math.round(Number(hours)) || 1));
  if (h === 1) return 'uma hora';
  return `${h} horas`;
}
