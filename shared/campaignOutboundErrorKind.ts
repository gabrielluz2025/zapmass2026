/**
 * Classifica erros de envio de campanha (Evolution/Baileys/WhatsApp).
 * Usado no worker (failover) e na UI (reenvio seletivo).
 */

export type CampaignOutboundErrorKind =
  | 'not_registered'
  | 'reachout_timelock'
  | 'chip_auth'
  | 'content_dup'
  | 'other';

const KIND_LABELS: Record<CampaignOutboundErrorKind, string> = {
  not_registered: 'Sem WhatsApp',
  reachout_timelock: 'Restrição Meta (463)',
  chip_auth: 'Chip / sessão',
  content_dup: 'Pausa por texto igual',
  other: 'Outro',
};

/** Erro do destinatário/política — não adianta trocar de chip. */
export function isRecipientPolicyOutboundError(detail?: string): boolean {
  if (!detail) return false;
  return (
    /\b463\b/i.test(detail) ||
    /reachout|timelock|NackCallerReachout/i.test(detail) ||
    /not registered|exists:\s*false|não encontrado no WhatsApp|Contato não encontrado/i.test(detail) ||
    /Número inválido|mensagem vazia/i.test(detail)
  );
}

/** Falha definitiva do contato (não retry BullMQ / não inflar failCount com retry). */
export function isUnrecoverableCampaignOutboundError(detail?: string): boolean {
  if (!detail) return false;
  if (isRecipientPolicyOutboundError(detail)) return true;
  return /HTTP 400|status code 400|recusou o envio \(400\)|não foi possível obter o número/i.test(
    detail
  );
}

/** 4xx que deve abrir circuit breaker do chip (auth/rate) — exclui 463 (política Meta). */
export function isChipHealthOutbound4xx(detail?: string): boolean {
  if (!detail) return false;
  if (/\b463\b/i.test(detail) || /reachout|timelock/i.test(detail)) return false;
  if (isRecipientPolicyOutboundError(detail) && /not registered|exists:\s*false/i.test(detail)) {
    return false;
  }
  return /\b401\b|\b403\b|\b429\b|not authorized|device JID/i.test(detail);
}

export function classifyCampaignOutboundError(detail?: string): CampaignOutboundErrorKind {
  const d = String(detail || '');
  if (!d.trim()) return 'other';
  if (/\b463\b/i.test(d) || /reachout|timelock|NackCallerReachout/i.test(d)) {
    return 'reachout_timelock';
  }
  if (/not registered|exists:\s*false|não encontrado no WhatsApp|Contato não encontrado/i.test(d)) {
    return 'not_registered';
  }
  if (/duplica(ç|c)ão de (texto|mídia)|PAUSED_BY_HIGH_DUPLICATION|conteúdo idêntico/i.test(d)) {
    return 'content_dup';
  }
  if (/not authorized|device JID|HTTP 401|status code 401|logged.?out|session/i.test(d)) {
    return 'chip_auth';
  }
  return 'other';
}

export function campaignOutboundErrorKindLabel(kind: CampaignOutboundErrorKind): string {
  return KIND_LABELS[kind];
}

/** Texto amigável para o relatório (mantém detalhe técnico no final se útil). */
export function humanizeCampaignOutboundError(detail?: string): string {
  const d = String(detail || '').trim();
  if (!d) return '';
  const kind = classifyCampaignOutboundError(d);
  if (kind === 'reachout_timelock') {
    return 'Restrição Meta (463 / reachout) — chip não pode falar com este contato frio. Não reenvie em lote.';
  }
  if (kind === 'not_registered') {
    return 'Número sem WhatsApp (ou formato inválido). Valide a base antes de reenviar.';
  }
  if (kind === 'chip_auth') {
    return `Problema de sessão/auth do chip — reconecte e reenvie só estes. (${d.slice(0, 120)})`;
  }
  if (kind === 'content_dup') {
    return 'Pausa anti-spam por texto igual — jobs adiados. Ao retomar, o envio continua (varie Spintax para evitar nova pausa).';
  }
  return d;
}

/** Pode reenviar com segurança relativa (chip ok / erro genérico / pausa por texto). */
export function isRetryableCampaignOutboundKind(kind: CampaignOutboundErrorKind): boolean {
  return kind === 'chip_auth' || kind === 'other' || kind === 'content_dup';
}

/**
 * Falha de job que NÃO é erro real de envio (anti-spam / adiamento / BullMQ delayed).
 * Não deve entrar em failedCount nem DLQ definitiva.
 */
export function isPhantomCampaignJobFailure(detail?: string): boolean {
  const d = String(detail || '');
  if (!d.trim()) return false;
  if (classifyCampaignOutboundError(d) === 'content_dup') return true;
  return /DelayedError|moveToDelayed|circuit breaker de hash|jobs adiados, não marcados como falha/i.test(
    d
  );
}
