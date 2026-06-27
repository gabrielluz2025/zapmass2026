import { apiFetchJson } from '../utils/apiFetchAuth';

export type SupportBotMenuOption = {
  id: string;
  label: string;
  reply: string;
  handoff?: boolean;
  marketingEffect?: 'none' | 'opt_in' | 'opt_out';
};

export type SupportBotFaqItem = {
  id: string;
  keywords: string[];
  reply: string;
  marketingEffect?: 'none' | 'opt_in' | 'opt_out';
};

export type SupportBotConfig = {
  enabled: boolean;
  connectionIds: string[];
  welcomeMessage: string;
  menuPrompt: string;
  options: SupportBotMenuOption[];
  offHoursMessage: string;
  handoffMessage: string;
  invalidOptionMessage: string;
  humanKeywords: string[];
  faqItems: SupportBotFaqItem[];
  resetKeywords: string[];
  resetMessage: string;
  businessHours: {
    enabled: boolean;
    timezone: string;
    weekdays: number[];
    start: string;
    end: string;
  };
  botOnlyOutsideHours: boolean;
  menuCooldownMinutes: number;
};

export type SupportBotMetrics = {
  botReplies: number;
  handoffs: number;
  menuShown: number;
};

export type SupportBotHandoffRow = {
  id: string;
  connectionId: string;
  phoneDigits: string;
  conversationId: string;
  previewMessage: string;
  createdAt: string;
};

export async function fetchSupportBotConfig(): Promise<{
  config: SupportBotConfig;
  metrics: SupportBotMetrics;
}> {
  const j = await apiFetchJson<{ config?: SupportBotConfig; metrics?: SupportBotMetrics }>(
    '/api/support-bot'
  );
  return {
    config: j.config as SupportBotConfig,
    metrics: {
      botReplies: Number(j.metrics?.botReplies) || 0,
      handoffs: Number(j.metrics?.handoffs) || 0,
      menuShown: Number(j.metrics?.menuShown) || 0
    }
  };
}

export async function saveSupportBotConfig(
  config: SupportBotConfig
): Promise<{ config: SupportBotConfig; metrics: SupportBotMetrics }> {
  const j = await apiFetchJson<{ config?: SupportBotConfig; metrics?: SupportBotMetrics }>(
    '/api/support-bot',
    {
      method: 'PATCH',
      body: JSON.stringify({ config })
    }
  );
  return {
    config: j.config as SupportBotConfig,
    metrics: {
      botReplies: Number(j.metrics?.botReplies) || 0,
      handoffs: Number(j.metrics?.handoffs) || 0,
      menuShown: Number(j.metrics?.menuShown) || 0
    }
  };
}

export async function fetchSupportBotHandoffs(limit = 30): Promise<SupportBotHandoffRow[]> {
  const j = await apiFetchJson<{ handoffs?: SupportBotHandoffRow[] }>(
    `/api/support-bot/handoffs?limit=${limit}`
  );
  return Array.isArray(j.handoffs) ? j.handoffs : [];
}

export async function resetSupportBotSession(
  connectionId: string,
  phoneDigits: string
): Promise<void> {
  await apiFetchJson('/api/support-bot/sessions/reset', {
    method: 'POST',
    body: JSON.stringify({ connectionId, phoneDigits })
  });
}
