/**
 * Heurística local (sem API) para sinalizar risco de bloqueio / aparência de spam.
 * Não substitui revisão humana nem políticas da Meta.
 */
export type MessageRiskLevel = 'low' | 'medium' | 'high';

export interface MessageRiskResult {
  score: number;
  level: MessageRiskLevel;
  hints: string[];
}

const SPAM_WORDS = [
  'ganhe dinheiro',
  'clique aqui agora',
  'promoção imperdível',
  'você foi selecionado',
  'urgente!!!',
  'parabéns você ganhou',
  'pix grátis',
  'investimento garantido'
];

export function analyzeMessageRisk(text: string): MessageRiskResult {
  const t = (text || '').trim();
  const hints: string[] = [];
  let score = 0;

  if (t.length === 0) {
    return { score: 0, level: 'low', hints: ['Mensagem vazia.'] };
  }

  if (t.length < 20) {
    score += 15;
    hints.push('Texto muito curto pode parecer genérico ou suspeito.');
  }

  const upperRatio = t.replace(/[^A-Za-zÀ-ÿ]/g, '').length
    ? t.replace(/[^A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '').length / Math.max(1, t.replace(/[^A-Za-zÀ-ÿ]/g, '').length)
    : 0;
  if (upperRatio > 0.5 && t.length > 30) {
    score += 20;
    hints.push('Muitas letras maiúsculas (parece “gritar” ou spam).');
  }

  const excl = (t.match(/!/g) || []).length;
  if (excl > 5) {
    score += 15;
    hints.push('Muitas exclamações.');
  }

  const linkCount = (t.match(/https?:\/\/|wa\.me|bit\.ly/gi) || []).length;
  if (linkCount > 2) {
    score += 15;
    hints.push('Vários links na mesma mensagem aumentam risco de filtro.');
  }

  const lower = t.toLowerCase();
  for (const w of SPAM_WORDS) {
    if (lower.includes(w)) {
      score += 25;
      hints.push(`Trecho comum em spam detectado (“${w}”).`);
      break;
    }
  }

  if (/\b\d{4}\s*\d{4}\s*\d{4}\s*\d{4}\b/.test(t.replace(/\D/g, ' '))) {
    score += 10;
    hints.push('Possível cartão/banco no texto — evite dados sensíveis.');
  }

  const level: MessageRiskLevel = score >= 55 ? 'high' : score >= 28 ? 'medium' : 'low';
  if (hints.length === 0 && level === 'low') {
    hints.push('Nada crítico detectado pela análise local.');
  }

  return { score: Math.min(100, score), level, hints };
}
