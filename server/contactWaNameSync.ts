import type { Contact } from '../src/types.js';
import {
  campaignRecipientNameVars,
  isSuspiciousContactName,
  normalizeContactName,
} from '../src/utils/contactNameNormalize.js';
import * as evolutionService from './evolutionService.js';
import type { PhonebookNameIndex } from './evolutionContactName.js';
import { getContactById, updateContact } from './repositories/contactsRepository.js';

export type WaNameSyncResult = {
  id: string;
  status: 'updated' | 'skipped' | 'unavailable' | 'failed';
  name?: string;
  previousName?: string;
  source?: 'phonebook' | 'conversation' | 'profile' | null;
  error?: string;
};

function waNameLooksUsable(name: string): boolean {
  const t = String(name || '').trim();
  if (!t) return false;
  if (isSuspiciousContactName(t)) return false;
  // Evita gravar o próprio número como “nome”
  if (/^[\d\s().+\-]+$/.test(t)) return false;
  return true;
}

export async function syncContactWaName(
  tenantId: string,
  contactId: string,
  opts?: {
    connectionId?: string;
    phonebookIndex?: PhonebookNameIndex | null;
    /** Se true, sobrescreve mesmo com nome “bom” (não usado pelo job padrão). */
    force?: boolean;
    onlyIfSuspicious?: boolean;
    skipProfile?: boolean;
  }
): Promise<WaNameSyncResult> {
  const onlyIfSuspicious = opts?.onlyIfSuspicious !== false;
  try {
    const contact = await getContactById(tenantId, contactId);
    if (!contact) {
      return { id: contactId, status: 'failed', error: 'Contato não encontrado.' };
    }
    const previousName = String(contact.name || '').trim();
    if (!opts?.force && onlyIfSuspicious && !isSuspiciousContactName(previousName)) {
      return { id: contactId, status: 'skipped', previousName, name: previousName };
    }

    const digits = (contact.phone || '').replace(/\D/g, '');
    if (digits.length < 10) {
      return { id: contactId, status: 'unavailable', previousName, name: previousName };
    }

    const resolved = await evolutionService.resolveWaDisplayNameForPhone(tenantId, digits, {
      connectionId: opts?.connectionId,
      phonebookIndex: opts?.phonebookIndex,
      skipProfile: opts?.skipProfile !== false,
    });
    const raw = (resolved.name || '').trim();
    if (!raw || !waNameLooksUsable(raw)) {
      return {
        id: contactId,
        status: 'unavailable',
        previousName,
        name: previousName,
        source: resolved.source,
      };
    }

    const nextName = normalizeContactName(raw) || raw;
    if (!nextName || isSuspiciousContactName(nextName)) {
      return {
        id: contactId,
        status: 'unavailable',
        previousName,
        name: previousName,
        source: resolved.source,
      };
    }
    if (nextName === previousName) {
      return {
        id: contactId,
        status: 'skipped',
        previousName,
        name: previousName,
        source: resolved.source,
      };
    }

    const updated = await updateContact(tenantId, contactId, { name: nextName });
    return {
      id: contactId,
      status: 'updated',
      previousName,
      name: updated?.name || nextName,
      source: resolved.source,
    };
  } catch (e) {
    return {
      id: contactId,
      status: 'failed',
      error: e instanceof Error ? e.message : 'Falha ao sincronizar nome.',
    };
  }
}

/** Preview local: quantos nomes suspeitos cairiam no sync (sem chamar WA). */
export function countSuspiciousNames(contacts: Contact[]): number {
  return contacts.reduce((n, c) => n + (isSuspiciousContactName(c.name || '') ? 1 : 0), 0);
}

export function campaignNameSafe(raw: string): { nome: string; nome_completo: string } {
  return campaignRecipientNameVars(raw);
}
