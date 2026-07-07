/**
 * Serviço de notificações por tenant.
 * Emite eventos via socket (publishOwnerEvent) e opcionalmente via webhook configurado.
 */

import axios from 'axios';
import { loadTenantSettings } from './tenantSettings.js';

type NotifyData = Record<string, unknown>;

/**
 * Notifica o tenant via socket. Se o tenant tiver webhook configurado,
 * também envia o payload HTTP (fire-and-forget).
 */
export async function notifyTenant(
  ownerUid: string,
  eventType: string,
  data: NotifyData,
  _key?: string
): Promise<void> {
  try {
    const settings = await loadTenantSettings(ownerUid).catch(() => null);
    const webhookUrl = settings?.webhookUrl?.trim();
    if (webhookUrl) {
      void axios
        .post(webhookUrl, { event: eventType, ...data, at: new Date().toISOString() }, {
          timeout: 8000,
          headers: { 'Content-Type': 'application/json' },
        })
        .catch(() => {});
    }
  } catch {
    // fire-and-forget: nunca lança para não quebrar fluxo de envio
  }
}

/**
 * Envia apenas o webhook do tenant (sem socket).
 */
export async function notifyTenantWebhook(
  tenantId: string,
  eventType: string,
  data: NotifyData
): Promise<void> {
  return notifyTenant(tenantId, eventType, data);
}
