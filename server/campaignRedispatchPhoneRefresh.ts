import { normPhoneKey, normalizeBRPhone } from '../src/utils/brPhoneNormalize.js';
import { buildPhoneDigitLookupKeys } from '../src/utils/contactPhoneLookup.js';
import { getCrmContactIndexes } from './crmContactIndexCache.js';
import { normalizePhoneKey } from './replyFlowEngine.js';

export type RedispatchTarget = { phone: string; stepIndex: number };

/** Atualiza telefones de reenvio com o cadastro CRM atual (pós "Corrigir base"). */
export async function refreshRedispatchTargetPhones(
  tenantId: string,
  targets: RedispatchTarget[]
): Promise<RedispatchTarget[]> {
  if (!targets.length) return targets;

  const indexes = await getCrmContactIndexes(tenantId).catch(() => null);

  return targets.map((t) => {
    const lookupKeys = buildPhoneDigitLookupKeys(normPhoneKey(t.phone) || normalizePhoneKey(t.phone));
    let refreshed: string | undefined;

    if (indexes?.byDigits) {
      for (const k of lookupKeys) {
        const hit = indexes.byDigits.get(k);
        if (hit) {
          refreshed = normalizeBRPhone(hit) || hit;
          break;
        }
      }
    }

    const phone = normalizePhoneKey(refreshed || t.phone) || normalizePhoneKey(t.phone) || t.phone;
    return { phone, stepIndex: t.stepIndex };
  });
}
