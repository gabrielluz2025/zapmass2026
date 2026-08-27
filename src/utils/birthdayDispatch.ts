import { localDateTimeToUtcIso } from './campaignSchedule';

export const BIRTHDAY_SCHEDULE_TZ = 'America/Sao_Paulo';

export type BirthdayDispatchMode = 'today_now' | 'week_schedule';

export interface BirthdayPerson {
  id: string;
  name: string;
  phone: string;
  birthdayLabel: string;
  daysRemaining: number;
  age: number | null;
  /** YYYY-MM-DD — dia em que a mensagem deve sair */
  sendLocalDate: string;
}

export function computeSendLocalDate(daysRemaining: number, now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysRemaining);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatBirthdayWhen(daysRemaining: number): string {
  if (daysRemaining === 0) return 'Hoje';
  if (daysRemaining === 1) return 'Amanhã';
  return `Em ${daysRemaining} dias`;
}

export function formatSendDateLabel(sendLocalDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sendLocalDate);
  if (!m) return sendLocalDate;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function groupBirthdaysBySendDate(
  people: BirthdayPerson[]
): Array<{ date: string; people: BirthdayPerson[] }> {
  const map = new Map<string, BirthdayPerson[]>();
  for (const p of people) {
    const arr = map.get(p.sendLocalDate) ?? [];
    arr.push(p);
    map.set(p.sendLocalDate, arr);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, grouped]) => ({ date, people: grouped }));
}

/** Se o horário programado já passou (ou é inválido), dispara imediatamente. */
export function shouldSendBirthdayImmediately(
  sendLocalDate: string,
  scheduleTime: string,
  timeZone: string,
  nowMs = Date.now()
): boolean {
  const utc = localDateTimeToUtcIso(sendLocalDate, scheduleTime, timeZone);
  if (!utc) return true;
  return Date.parse(utc) <= nowMs;
}

export function buildBirthdayRecipients(people: BirthdayPerson[]) {
  return people.map((b) => {
    const parts = (b.name || '').trim().split(/\s+/);
    const nome = parts[0] || 'amigo(a)';
    const nomeCompleto = (b.name || '').trim() || nome;
    return {
      phone: b.phone,
      vars: {
        nome,
        nome_completo: nomeCompleto,
        telefone: b.phone,
        aniversario: b.birthdayLabel,
        idade: b.age != null ? String(b.age) : '',
      },
    };
  });
}
