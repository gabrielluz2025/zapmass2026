/**
 * Notificações outbound do tenant: webhook URL + e-mail (emailNotif).
 */
import { sendWebhook } from './advancedFeatures.js';
import { loadTenantSettings } from './tenantSettings.js';
import {
  sendTenantCampaignCompleteEmail,
  sendTenantChipOfflineEmail,
  sendTenantJobDeadEmail,
} from './emailService.js';
import { findUserById } from './auth/userRepository.js';

async function resolveTenantEmail(tenantId: string): Promise<string | null> {
  try {
    const user = await findUserById(tenantId);
    const email = (user?.email || '').trim();
    return email || null;
  } catch {
    return null;
  }
}

export async function notifyTenantWebhook(
  tenantId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const settings = await loadTenantSettings(tenantId);
    const url = (settings?.webhookUrl || process.env.WEBHOOK_URL || '').trim();
    if (!url) return;
    await sendWebhook(event, data, url);
  } catch (e) {
    console.warn('[TenantNotify] webhook falhou:', (e as Error)?.message);
  }
}

export async function notifyTenantEmailIfEnabled(
  tenantId: string,
  kind: 'chip_offline' | 'campaign_complete' | 'job_dead',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const settings = await loadTenantSettings(tenantId);
    if (!settings?.emailNotif) return;
    const to = await resolveTenantEmail(tenantId);
    if (!to) return;

    if (kind === 'chip_offline') {
      await sendTenantChipOfflineEmail({
        to,
        connectionLabel: String(payload.connectionLabel || payload.connectionId || 'Chip'),
        connectionId: String(payload.connectionId || ''),
      });
    } else if (kind === 'campaign_complete') {
      await sendTenantCampaignCompleteEmail({
        to,
        campaignName: String(payload.campaignName || payload.campaignId || 'Campanha'),
        sent: Number(payload.sent || 0),
        failed: Number(payload.failed || 0),
        total: Number(payload.total || 0),
      });
    } else if (kind === 'job_dead') {
      await sendTenantJobDeadEmail({
        to,
        campaignId: String(payload.campaignId || ''),
        toNumber: String(payload.to || ''),
        error: String(payload.error || 'Erro desconhecido'),
      });
    }
  } catch (e) {
    console.warn('[TenantNotify] email falhou:', (e as Error)?.message);
  }
}

export async function notifyTenant(
  tenantId: string,
  event: string,
  data: Record<string, unknown>,
  emailKind?: 'chip_offline' | 'campaign_complete' | 'job_dead'
): Promise<void> {
  await notifyTenantWebhook(tenantId, event, data);
  if (emailKind) {
    await notifyTenantEmailIfEnabled(tenantId, emailKind, data);
  }
}
