import type { Contact } from '../src/types.js';
import { normalizeContactAddressFields, contactAddressChanged } from '../src/utils/contactAddressNormalize.js';
import { ensureIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { bulkUpdateContacts, listContacts } from './repositories/contactsRepository.js';

const VIA_CEP_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Consulta ViaCEP com rate limit embutido e retorna cidade/estado corrigidos. */
async function viaCepLookup(cep: string): Promise<{ city?: string; state?: string } | null> {
  try {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { localidade?: string; uf?: string; erro?: boolean };
    if (data.erro) return null;
    return {
      city: String(data.localidade || '').trim() || undefined,
      state: String(data.uf || '').trim().toUpperCase().slice(0, 2) || undefined
    };
  } catch {
    return null;
  }
}

/**
 * Normaliza em lote os endereços do tenant que ainda não foram normalizados ou têm
 * cidade suspeita (sem UF válida). Processa em lotes de `batchSize` para não
 * sobrecarregar o banco. Consulta ViaCEP para contatos com CEP (rate limit 1 req/300ms).
 */
export async function runAddressNormalizationBatch(
  tenantId: string,
  batchSize = 200
): Promise<{ scanned: number; updated: number }> {
  const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => null);
  const VALID_UFS = new Set([
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
  ]);

  let totalScanned = 0;
  let totalUpdated = 0;
  let offset = 0;

  for (;;) {
    const page = await listContacts(tenantId, { limit: batchSize, offset });
    if (page.length === 0) break;
    offset += page.length;
    totalScanned += page.length;

    const needsWork = page.filter(
      (c) =>
        !c.addressNormalizedAt ||
        (c.city && (!c.state || !VALID_UFS.has((c.state || '').toUpperCase())))
    );

    if (needsWork.length === 0) continue;

    const items: Array<{ id: string; updates: Partial<Contact> }> = [];
    let viaCepCount = 0;

    for (const c of needsWork) {
      const norm = normalizeContactAddressFields(
        {
          city: c.city,
          state: c.state,
          phone: c.phone,
          neighborhood: c.neighborhood,
          street: c.street,
          zipCode: c.zipCode,
          number: c.number
        },
        ibgeIndex
      );

      let mergedCity = norm.city || c.city;
      let mergedState = norm.state || c.state;

      const cepDigits = (c.zipCode || '').replace(/\D/g, '');
      if (cepDigits.length === 8) {
        if (viaCepCount > 0) await sleep(VIA_CEP_DELAY_MS);
        viaCepCount++;
        const viaCep = await viaCepLookup(cepDigits);
        if (viaCep?.city && viaCep.city.toLowerCase() !== (mergedCity || '').toLowerCase()) {
          mergedCity = viaCep.city;
        }
        if (viaCep?.state && viaCep.state !== (mergedState || '').toUpperCase()) {
          mergedState = viaCep.state;
        }
      }

      const finalNorm: Partial<Contact> = {
        ...norm,
        city: mergedCity,
        state: mergedState,
        addressNormalizedAt: new Date().toISOString()
      };

      const changed =
        contactAddressChanged(c, finalNorm) || !c.addressNormalizedAt;
      if (changed) {
        items.push({ id: c.id, updates: finalNorm });
      }
    }

    if (items.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < items.length; i += CHUNK) {
        await bulkUpdateContacts(tenantId, items.slice(i, i + CHUNK));
      }
      totalUpdated += items.length;
      console.log(`[addressNormalizationJob] tenant=${tenantId} batch offset=${offset} updated=${items.length}`);
    }

    if (page.length < batchSize) break;
  }

  console.log(
    `[addressNormalizationJob] tenant=${tenantId} DONE scanned=${totalScanned} updated=${totalUpdated}`
  );
  return { scanned: totalScanned, updated: totalUpdated };
}
