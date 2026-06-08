import { useEffect, useRef } from 'react';
import type { Contact } from '../types';
import { apiFetchContactProfilePicturesBatch } from '../services/contactsApi';

const BATCH_SIZE = 8;
const MAX_TOTAL = 80;
const DELAY_MS = 700;

function needsPicture(c: Contact): boolean {
  const pic = (c.profilePicUrl || '').trim();
  if (pic.startsWith('http') || pic.startsWith('data:')) return false;
  const digits = (c.phone || '').replace(/\D/g, '');
  return digits.length >= 10;
}

/**
 * Busca fotos do WhatsApp para contatos visíveis (sem foto) e persiste no CRM.
 */
export function useContactPicturePrefetch(
  rows: Contact[],
  enabled: boolean,
  onPicturesUpdated: (updates: Array<{ id: string; profilePicUrl: string }>) => void
): void {
  const attemptedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled || rows.length === 0) return;

    const queue = rows
      .filter((c) => needsPicture(c) && !attemptedRef.current.has(c.id))
      .map((c) => c.id)
      .slice(0, MAX_TOTAL);

    if (queue.length === 0 || runningRef.current) return;

    let cancelled = false;
    runningRef.current = true;

    void (async () => {
      try {
        for (let i = 0; i < queue.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = queue.slice(i, i + BATCH_SIZE);
          batch.forEach((id) => attemptedRef.current.add(id));
          const results = await apiFetchContactProfilePicturesBatch(batch);
          const hits = results
            .filter((r) => r.profilePicUrl)
            .map((r) => ({ id: r.id, profilePicUrl: r.profilePicUrl! }));
          if (hits.length > 0) onPicturesUpdated(hits);
          if (i + BATCH_SIZE < queue.length) {
            await new Promise((r) => setTimeout(r, DELAY_MS));
          }
        }
      } catch {
        /* silencioso — fotos são opcionais */
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rows, enabled, onPicturesUpdated]);
}
