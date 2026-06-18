import { apiFetchJson } from '../utils/apiFetchAuth';

export type SupportBotMenuOption = {
  id: string;
  label: string;
  reply: string;
  handoff?: boolean;
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
