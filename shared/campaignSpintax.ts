/**
 * SpinTrax de campanhas.
 *
 * A sintaxe suportada é `{opção A|opção B|opção C}`. Variáveis como `{nome}`
 * não são blocos de SpinTrax e permanecem intactas até a personalização.
 */

export type CampaignSpintaxBlock = {
  raw: string;
  options: string[];
  start: number;
  end: number;
};

const SPINTAX_BLOCK_RE = /\{([^{}]+(?:\|[^{}]+)+)\}/g;
const MAX_VARIATIONS = 1_000_000;

function cleanOptions(inner: string): string[] {
  return inner
    .split('|')
    .map((option) => option.replace(/｜/g, '|').trim())
    .filter(Boolean);
}

/** Encontra somente blocos com pipe; `{nome}` não é confundido com SpinTrax. */
export function extractCampaignSpintaxBlocks(text: string): CampaignSpintaxBlock[] {
  const blocks: CampaignSpintaxBlock[] = [];
  for (const match of text.matchAll(SPINTAX_BLOCK_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    blocks.push({
      raw,
      options: cleanOptions(match[1] ?? ''),
      start,
      end: start + raw.length,
    });
  }
  return blocks;
}

/** Monta um bloco pronto para ser inserido na mensagem. */
export function buildCampaignSpintax(options: string[]): string | null {
  const cleaned = options
    .map((option) => String(option || '').replace(/[\r\n]+/g, ' ').trim())
    .filter(Boolean);

  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return cleaned[0]!;

  // Permite que uma frase contenha pipe sem quebrar o bloco.
  const escaped = cleaned.map((option) => option.replace(/\|/g, '｜'));
  return `{${escaped.join('|')}}`;
}

/** Resolve os blocos de forma determinística, sem Math.random no envio. */
export function resolveCampaignSpintax(text: string, rotationIndex: number): string {
  const safeIndex = Number.isFinite(rotationIndex) ? Math.floor(rotationIndex) : 0;
  return text.replace(SPINTAX_BLOCK_RE, (_, inner: string) => {
    const options = cleanOptions(inner);
    if (options.length === 0) return '';
    const index = ((safeIndex % options.length) + options.length) % options.length;
    return options[index] ?? '';
  });
}

/** Retorna o número de combinações possíveis sem permitir overflow do contador. */
export function countCampaignSpintaxVariations(text: string): number {
  return extractCampaignSpintaxBlocks(text).reduce((total, block) => {
    const next = total * Math.max(block.options.length, 1);
    return Number.isSafeInteger(next) ? Math.min(next, MAX_VARIATIONS) : MAX_VARIATIONS;
  }, 1);
}

export function analyzeCampaignSpintax(text: string, rotationIndex = 0): {
  blocks: CampaignSpintaxBlock[];
  variations: number;
  sample: string;
} {
  const blocks = extractCampaignSpintaxBlocks(text);
  return {
    blocks,
    variations: countCampaignSpintaxVariations(text),
    sample: resolveCampaignSpintax(text, rotationIndex),
  };
}

/** Índice estável por telefone quando o índice da fila não está disponível. */
export function campaignRotationIndexFromPhone(phone: string): number {
  const digits = (phone || '').replace(/\D/g, '');
  let hash = 0;
  for (let i = 0; i < digits.length; i++) {
    hash = (hash * 31 + digits.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function hasCampaignSpintax(text: string): boolean {
  return extractCampaignSpintaxBlocks(text).some((block) => block.options.length > 1);
}

/**
 * Detecta sintaxe de template que permaneceu depois da personalização.
 * É mais seguro bloquear o envio do que entregar `{nome}` ou `{A|B}` literalmente.
 */
export function hasUnresolvedCampaignTemplateTokens(text: string): boolean {
  return /\{\s*[^{}]*\|[^{}]*\s*\}|\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}/.test(String(text || ''));
}

/**
 * Fallback de segurança para gateways: resolve a variação por índice e remove
 * placeholders simples sem valor, evitando que qualquer sintaxe chegue ao canal.
 */
export function sanitizeCampaignTemplateForOutbound(text: string, rotationIndex = 0): string {
  const resolved = resolveCampaignSpintax(String(text || ''), rotationIndex);
  return resolved
    .replace(/\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;!?])/g, '$1')
    .trim();
}

export function isCampaignSpintaxBlock(value: string): boolean {
  return /^\{[^{}]+(?:\|[^{}]+)+\}$/.test(value.trim());
}

// Compatibilidade nominal com integrações que usam o nome SpinTrax.
export const SPINTRAX_LABEL = 'SpinTrax';
