import type { Contact } from '../types';
import { normPhoneKey } from './brPhoneNormalize';
import { isSuspiciousContactName } from './contactNameNormalize';
import { parseFollowUpMs } from './followUp';

export type BaseAttentionStats = {
  sampleSize: number;
  ready: number;
  readyPct: number;
  genericNames: number;
  invalidPhone: number;
  duplicates: number;
  overdueFollowUps: number;
  optOut: number;
  issueCount: number;
};

/** Contagens acionáveis da base carregada (não um “score 100%” vazio). */
export function computeBaseAttention(contacts: Contact[], nowMs = Date.now()): BaseAttentionStats {
  const n = contacts.length;
  if (!n) {
    return {
      sampleSize: 0,
      ready: 0,
      readyPct: 0,
      genericNames: 0,
      invalidPhone: 0,
      duplicates: 0,
      overdueFollowUps: 0,
      optOut: 0,
      issueCount: 0
    };
  }

  let ready = 0;
  let genericNames = 0;
  let invalidPhone = 0;
  let overdueFollowUps = 0;
  let optOut = 0;
  const keyCounts = new Map<string, number>();

  for (const c of contacts) {
    const digits = (c.phone || '').replace(/\D/g, '');
    const phoneOk = digits.length >= 10;
    if (!phoneOk) invalidPhone++;

    const name = String(c.name || '').trim();
    const nameBad = isSuspiciousContactName(name);
    if (nameBad) genericNames++;

    if (c.marketingOptOut) optOut++;

    const followMs = parseFollowUpMs(c.followUpAt);
    if (followMs != null && followMs < nowMs) overdueFollowUps++;

    const k = normPhoneKey(c.phone);
    if (k.length >= 10) keyCounts.set(k, (keyCounts.get(k) || 0) + 1);

    if (phoneOk && !nameBad && !c.marketingOptOut) ready++;
  }

  let duplicates = 0;
  for (const count of keyCounts.values()) {
    if (count > 1) duplicates += count - 1;
  }

  const issueCount = genericNames + invalidPhone + duplicates + overdueFollowUps + optOut;
  return {
    sampleSize: n,
    ready,
    readyPct: Math.round((ready / n) * 100),
    genericNames,
    invalidPhone,
    duplicates,
    overdueFollowUps,
    optOut,
    issueCount
  };
}

export function baseAttentionBadge(stats: BaseAttentionStats): { label: string; color: string } {
  if (stats.sampleSize === 0) return { label: 'Vazia', color: '#94a3b8' };
  if (stats.issueCount === 0 && stats.readyPct >= 90) return { label: 'Pronta', color: '#10b981' };
  if (stats.genericNames > 0 || stats.invalidPhone > 0) return { label: 'Atenção', color: '#f59e0b' };
  if (stats.issueCount > 0) return { label: 'Revisar', color: '#38bdf8' };
  return { label: 'Ok', color: '#10b981' };
}
