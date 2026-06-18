import { vpsDataEnabled } from '../auth/dataMode.js';
import { getZapmassPool } from '../db/postgres.js';
import { getClaimerSync } from '../inboxAssignments.js';
import { insertNotificationPg } from '../repositories/notificationsRepository.js';
import {
  bumpSupportBotMetricPg,
  loadSupportBotConfigPg,
  loadSupportBotSessionPg,
  normalizeSupportBotConfig,
  upsertSupportBotSessionPg
} from './supportBotRepository.js';
import type { SupportBotConfig, SupportBotMenuOption } from './supportBotTypes.js';

const configCache = new Map<string, { config: SupportBotConfig; at: number }>();
const CONFIG_TTL_MS = 45_000;

export function invalidateSupportBotConfigCache(tenantId?: string): void {
  if (!tenantId) {
    configCache.clear();
    return;
  }
  configCache.delete(tenantId);
}

async function getConfig(tenantId: string): Promise<SupportBotConfig> {
  const hit = configCache.get(tenantId);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.config;
  const config = await loadSupportBotConfigPg(tenantId);
  configCache.set(tenantId, { config, at: Date.now() });
  return config;
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function isWithinBusinessHours(config: SupportBotConfig, now = new Date()): boolean {
  const bh = config.businessHours;
  if (!bh.enabled) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: bh.timezone || 'America/Sao_Paulo',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const dow = weekdayMap[weekdayStr] ?? now.getDay();
    if (!bh.weekdays.includes(dow)) return false;
    const mins = hour * 60 + minute;
    return mins >= parseHm(bh.start) && mins < parseHm(bh.end);
  } catch {
    return true;
  }
}

function buildMenuText(config: SupportBotConfig): string {
  const lines = config.options.map((o, i) => `${i + 1} — ${o.label}`);
  return `${config.welcomeMessage}\n\n${config.menuPrompt}\n\n${lines.join('\n')}`;
}

function normalizeReplyToken(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u00FF0-9]/g, '')
    .replace(/\s+/g, ' ');
}

function matchMenuOption(config: SupportBotConfig, bodyText: string): SupportBotMenuOption | null {
  const norm = normalizeReplyToken(bodyText);
  if (!norm) return null;
  const first = norm.split(' ')[0] || norm;
  for (let i = 0; i < config.options.length; i++) {
    const opt = config.options[i];
    const n = String(i + 1);
    if (first === n || norm === n || first === opt.id || norm === opt.id.toLowerCase()) {
      return opt;
    }
    if (normalizeReplyToken(opt.label) === norm) return opt;
  }
  return null;
}

function wantsHuman(config: SupportBotConfig, bodyText: string): boolean {
  const norm = normalizeReplyToken(bodyText);
  if (!norm) return false;
  return config.humanKeywords.some((kw) => norm.includes(kw));
}

export type SupportBotIncomingParams = {
  tenantId: string;
  connectionId: string;
  phoneDigits: string;
  bodyText: string;
  incomingConvId: string;
  hasReplyFlowSession: boolean;
  sendText: (conversationId: string, text: string) => Promise<void>;
};

export async function handleSupportBotIncoming(params: SupportBotIncomingParams): Promise<void> {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  const { tenantId, connectionId, phoneDigits, bodyText, incomingConvId, hasReplyFlowSession, sendText } =
    params;

  if (hasReplyFlowSession) return;

  const config = await getConfig(tenantId);
  if (!config.enabled) return;

  if (config.connectionIds.length > 0 && !config.connectionIds.includes(connectionId)) return;

  if (getClaimerSync(tenantId, incomingConvId)) return;

  const withinHours = isWithinBusinessHours(config);
  if (config.botOnlyOutsideHours && withinHours) return;
  if (!config.botOnlyOutsideHours && !withinHours) {
    const session = await loadSupportBotSessionPg(tenantId, connectionId, phoneDigits);
    if (session?.state === 'handoff') return;
    const now = Date.now();
    const last = session?.lastMenuSentAt?.getTime() ?? 0;
    if (now - last < config.menuCooldownMinutes * 60_000) return;
    await sendText(incomingConvId, config.offHoursMessage);
    await upsertSupportBotSessionPg(tenantId, connectionId, phoneDigits, incomingConvId, {
      lastMenuSentAt: new Date()
    });
    return;
  }

  const session = await loadSupportBotSessionPg(tenantId, connectionId, phoneDigits);
  if (session?.state === 'handoff') return;

  const doHandoff = async (preview: string) => {
    await sendText(incomingConvId, config.handoffMessage);
    await upsertSupportBotSessionPg(tenantId, connectionId, phoneDigits, incomingConvId, {
      state: 'handoff',
      handedOffAt: new Date()
    });
    await bumpSupportBotMetricPg(tenantId, 'handoffs');
    await insertNotificationPg(tenantId, {
      title: 'Atendimento: cliente aguarda humano',
      body: `${preview.slice(0, 120)} — abra o Bate-papo para assumir a conversa.`,
      kind: 'warning',
      category: 'system'
    });
  };

  if (wantsHuman(config, bodyText)) {
    await doHandoff(bodyText);
    return;
  }

  const matched = matchMenuOption(config, bodyText);
  if (matched) {
    if (matched.handoff) {
      await doHandoff(bodyText);
      return;
    }
    const reply = matched.reply.trim();
    if (reply) {
      await sendText(incomingConvId, reply);
      await bumpSupportBotMetricPg(tenantId, 'botReplies');
    }
    await sendText(incomingConvId, buildMenuText(config));
    await upsertSupportBotSessionPg(tenantId, connectionId, phoneDigits, incomingConvId, {
      state: 'menu',
      lastMenuSentAt: new Date()
    });
    await bumpSupportBotMetricPg(tenantId, 'menuShown');
    return;
  }

  const now = Date.now();
  const lastMenu = session?.lastMenuSentAt?.getTime() ?? 0;
  const hasRecentMenu = now - lastMenu < config.menuCooldownMinutes * 60_000;

  if (session && hasRecentMenu && bodyText.trim()) {
    await sendText(incomingConvId, `${config.invalidOptionMessage}\n\n${buildMenuText(config).split('\n\n').slice(1).join('\n\n')}`);
    return;
  }

  await sendText(incomingConvId, buildMenuText(config));
  await upsertSupportBotSessionPg(tenantId, connectionId, phoneDigits, incomingConvId, {
    state: 'menu',
    lastMenuSentAt: new Date()
  });
  await bumpSupportBotMetricPg(tenantId, 'menuShown');
}
