/** Mensagens típicas do aquecimento automático — não são respostas de campanha. */
export const WARMUP_GREETING_MESSAGES = [
  'Oi! Tudo bem?',
  'Olá, boa tarde!',
  'Tudo bem por aí?',
  'Bom dia! Como vai?',
  'Boa tarde!',
  'Olá! Tudo certo por aí?',
  'E aí, como tá o dia?',
  'Fala! Beleza?',
  'Oi! Quanto tempo!',
  'Ei, tudo tranquilo?',
  'Opa! Como está?',
  'Bom dia! Tudo bem com você?',
  'Boa noite! Como foi o dia?',
  'Olá! Alguma novidade?',
  'Oi! Saudades!',
  'Como vai a semana?',
  'Tudo certo?',
  'Fala aí! Sumiu hein!',
  'Opa, e aí?',
  'Olá! Passando pra dar um oi!',
  'Boa! Como tá?',
  'Ei! Vamos conversar?',
];

function normWarmupText(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s?!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detecta saudações do auto-aquecimento (inbound ou outbound). */
export function isWarmupGreetingMessage(text: string): boolean {
  const norm = normWarmupText(text);
  if (!norm) return false;
  for (const raw of WARMUP_GREETING_MESSAGES) {
    if (normWarmupText(raw) === norm) return true;
  }
  return false;
}
