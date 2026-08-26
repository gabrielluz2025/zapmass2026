import { getConnections, resolveConnectionOwnerUid } from '../evolutionService.js';
import type { NurtureJourneyRow } from './nurtureTypes.js';
import {
  getOrCreatePrimaryJourneyPg,
  saveNurtureJourneyPg,
} from './nurtureRepository.js';

function resolveNurtureConnectionId(
  journey: NurtureJourneyRow,
  preferred?: string
): string {
  let connectionId = String(preferred ?? '').trim();
  if (!connectionId) {
    connectionId = String(journey.doc.entryRules.defaultConnectionId ?? '').trim();
  }
  if (!connectionId && journey.doc.connectionIds.length > 0) {
    connectionId = journey.doc.connectionIds[0];
  }
  return connectionId;
}

/** Ativa jornada e chip padrão automaticamente para inscrição de leads quentes. */
export async function ensureNurtureJourneyReadyForHotLeads(
  tenantId: string,
  opts?: { preferredConnectionId?: string }
): Promise<{ journey: NurtureJourneyRow; connectionId: string }> {
  let journey = await getOrCreatePrimaryJourneyPg(tenantId);
  if (journey.doc.steps.length === 0) {
    throw new Error('Adicione pelo menos um passo na jornada.');
  }

  if (!journey.enabled && !journey.doc.enabled) {
    journey = await saveNurtureJourneyPg(tenantId, journey.id, {
      enabled: true,
      doc: { ...journey.doc, enabled: true },
    });
  }

  let connectionId = resolveNurtureConnectionId(journey, opts?.preferredConnectionId);
  if (!connectionId) {
    const openChip = getConnections().find(
      (c) => c.status === 'CONNECTED' && resolveConnectionOwnerUid(c.id) === tenantId
    );
    connectionId = openChip?.id || '';
  }

  if (!connectionId) {
    throw new Error('Conecte um chip WhatsApp antes de inscrever leads quentes.');
  }

  const needsChipPersist =
    !journey.doc.entryRules.defaultConnectionId ||
    (journey.doc.connectionIds.length > 0 && !journey.doc.connectionIds.includes(connectionId));

  if (needsChipPersist || journey.doc.connectionIds.length === 0) {
    journey = await saveNurtureJourneyPg(tenantId, journey.id, {
      doc: {
        ...journey.doc,
        connectionIds: journey.doc.connectionIds.includes(connectionId)
          ? journey.doc.connectionIds
          : [...journey.doc.connectionIds, connectionId],
        entryRules: {
          ...journey.doc.entryRules,
          defaultConnectionId: journey.doc.entryRules.defaultConnectionId || connectionId,
        },
      },
    });
  }

  return { journey, connectionId };
}
