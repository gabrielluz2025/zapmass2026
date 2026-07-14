import type { Contact } from '../src/types.js';
import * as evolutionService from './evolutionService.js';
import { getContactById } from './repositories/contactsRepository.js';
import { normalizeOutboundNumber } from './evolutionOutboundPhone.js';
import { campaignRecipientNameVars } from '../src/utils/contactNameNormalize.js';

/** Lote pequeno na etapa 1 — evita sobrecarregar o chip / Evolution. */
export const SAVE_TO_CHIP_MAX_BATCH = 40;

export type SaveToChipAction = 'added' | 'updated';

export type SaveToChipResult = {
  id: string;
  ok: boolean;
  action?: SaveToChipAction;
  number?: string;
  name?: string;
  error?: string;
};

function preferredContactName(contact: Contact): string {
  const raw = (contact.name || '').trim();
  if (!raw) return '';
  const vars = campaignRecipientNameVars(raw);
  const neat = (vars.nome_completo || vars.nome || raw).trim();
  return neat.slice(0, 80);
}

export async function saveContactToChip(
  tenantId: string,
  contactId: string,
  connectionId: string
): Promise<SaveToChipResult> {
  const contact = await getContactById(tenantId, contactId);
  if (!contact) {
    return { id: contactId, ok: false, error: 'Contato não encontrado.' };
  }
  const name = preferredContactName(contact);
  if (!name) {
    return { id: contactId, ok: false, error: 'Contato sem nome — edite o nome antes de salvar no chip.' };
  }
  const digits = normalizeOutboundNumber(contact.phone || '');
  if (digits.length < 12) {
    return { id: contactId, ok: false, error: 'Telefone inválido para o WhatsApp.' };
  }

  try {
    const r = await evolutionService.saveContactOnChipPhonebook(connectionId, digits, name);
    return {
      id: contactId,
      ok: true,
      action: r.action,
      number: r.number,
      name: r.name
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'SAVE_CONTACT_UNSUPPORTED') {
      return {
        id: contactId,
        ok: false,
        error:
          'Esta Evolution API ainda não permite gravar na agenda do celular. Atualize a imagem Evolution ou contacte o suporte.'
      };
    }
    return { id: contactId, ok: false, error: message.slice(0, 240) || 'Falha ao gravar no chip.' };
  }
}

export async function saveContactsToChipBatch(
  tenantId: string,
  ids: string[],
  connectionId: string
): Promise<{
  results: SaveToChipResult[];
  summary: { ok: number; failed: number; added: number; updated: number };
}> {
  const uniq = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))].slice(
    0,
    SAVE_TO_CHIP_MAX_BATCH
  );
  const results: SaveToChipResult[] = [];
  let added = 0;
  let updated = 0;
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < uniq.length; i++) {
    const id = uniq[i];
    const r = await saveContactToChip(tenantId, id, connectionId);
    results.push(r);
    if (r.ok) {
      ok += 1;
      if (r.action === 'updated') updated += 1;
      else added += 1;
    } else {
      failed += 1;
    }
    // Pausa leve entre gravações para não saturar o Baileys/chip.
    if (i < uniq.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  return { results, summary: { ok, failed, added, updated } };
}
