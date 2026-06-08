import type { Contact } from '../src/types.js';
import * as evolutionService from './evolutionService.js';
import { getContactById, updateContact } from './repositories/contactsRepository.js';

const MAX_BATCH = 12;

export async function fetchAndPersistContactProfilePicture(
  tenantId: string,
  contactId: string,
  opts?: { connectionId?: string; force?: boolean }
): Promise<{ profilePicUrl: string | null; contact?: Contact }> {
  const contact = await getContactById(tenantId, contactId);
  if (!contact) {
    throw new Error('Contato não encontrado.');
  }
  const existing = (contact.profilePicUrl || '').trim();
  if (!opts?.force && existing && (existing.startsWith('http') || existing.startsWith('data:'))) {
    return { profilePicUrl: existing, contact };
  }
  const digits = (contact.phone || '').replace(/\D/g, '');
  if (digits.length < 10) {
    return { profilePicUrl: null, contact };
  }
  const pic = await evolutionService.fetchProfilePictureForPhone(
    tenantId,
    digits,
    opts?.connectionId
  );
  if (!pic) {
    return { profilePicUrl: null, contact };
  }
  const updated = await updateContact(tenantId, contactId, { profilePicUrl: pic });
  return { profilePicUrl: pic, contact: updated ?? { ...contact, profilePicUrl: pic } };
}

export async function fetchAndPersistContactProfilePicturesBatch(
  tenantId: string,
  ids: string[],
  opts?: { connectionId?: string }
): Promise<Array<{ id: string; profilePicUrl: string | null }>> {
  const uniq = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))].slice(
    0,
    MAX_BATCH
  );
  const results: Array<{ id: string; profilePicUrl: string | null }> = [];
  for (const id of uniq) {
    try {
      const r = await fetchAndPersistContactProfilePicture(tenantId, id, {
        connectionId: opts?.connectionId,
        force: false
      });
      results.push({ id, profilePicUrl: r.profilePicUrl });
    } catch {
      results.push({ id, profilePicUrl: null });
    }
  }
  return results;
}
