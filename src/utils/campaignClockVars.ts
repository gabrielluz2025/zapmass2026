/**
 * Valores `{data}`, `{horario}`, `{saudacao}` para campanhas — fuso America/Sao_Paulo.
 * Usado no servidor ao personalizar texto e na pré-visualização local do assistente.
 */
export const CAMPAIGN_CLOCK_TIMEZONE = 'America/Sao_Paulo';

function hourInTimeZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hour12: false
  }).formatToParts(d);
  const v = parts.find((p) => p.type === 'hour')?.value;
  const n = v != null ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : 12;
}

/** Saudação por hora em Brasília: 05–11 Bom dia, 12–17 Boa tarde, caso contrário Boa noite. */
export function saudacaoFromHourBrazil(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Data (dd/mm/aaaa), horário (HH:mm) e saudação no instante `at`. */
export function campaignClockVars(at: Date = new Date()): Record<string, string> {
  const tz = CAMPAIGN_CLOCK_TIMEZONE;
  const data = at.toLocaleDateString('pt-BR', { timeZone: tz });
  const horario = at.toLocaleTimeString('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit'
  });
  const hour = hourInTimeZone(at, tz);
  const saudacao = saudacaoFromHourBrazil(hour);
  return { data, horario, saudacao };
}
