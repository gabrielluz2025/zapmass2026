/**
 * Adiciona meses calendario (respeita meses com 28–31 dias).
 * Ex.: 31/01 + 1 mes → ultimo dia de fevereiro.
 */
export function addCalendarMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}
