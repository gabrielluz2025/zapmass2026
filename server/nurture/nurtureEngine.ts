import { vpsDataEnabled } from '../auth/dataMode.js';
import { getZapmassPool } from '../db/postgres.js';
import { getClaimerSync } from '../inboxAssignments.js';
import { insertNotificationPg } from '../repositories/notificationsRepository.js';
import { applyMessageVars, publishOwnerEvent } from '../whatsappService.js';
import { formatNurtureSocialLinks } from './nurtureSocialLinks.js';
import {
  bumpNurtureMetricPg,
  findActiveEnrollmentPg,
  findEnrollmentByPhonePg,
  getOrCreatePrimaryJourneyPg,
  loadNurtureEnrollmentDispatchRowsPg,
  listNurtureEnrollmentsPg,
  refreshActiveEnrollmentCountPg,
  updateEnrollmentStatusPg,
  upsertEnrollmentPg
} from './nurtureRepository.js';
import type { NurtureEnrollmentStatus, NurtureJourneyDoc, NurtureStep } from './nurtureTypes.js';

export type NurtureEnqueueMedia = {
  url: string;
  mimeType: string;
  fileName: string;
  caption?: string;
  sendAsDocument?: boolean;
};

export type NurtureEnqueueFn = (params: {
  tenantId: string;
  journeyId: string;
  enrollmentId: string;
  connectionId: string;
  contactPhone: string;
  message: string;
  stepIndex: number;
  delayMs: number;
  media?: NurtureEnqueueMedia;
}) => Promise<void>;

export type NurtureSendTextFn = (conversationId: string, text: string) => Promise<void>;

let enqueueFn: NurtureEnqueueFn | null = null;

export function registerNurtureEnqueue(fn: NurtureEnqueueFn): void {
  enqueueFn = fn;
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 9 * 60;
  return h * 60 + m;
}

export function brazilDayKey(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function isWithinBusinessHours(doc: NurtureJourneyDoc, now = new Date()): boolean {
  const bh = doc.businessHours;
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

function nextBusinessWindowMs(doc: NurtureJourneyDoc, from = new Date()): number {
  if (isWithinBusinessHours(doc, from)) return 0;
  for (let i = 0; i < 8 * 24; i++) {
    const probe = new Date(from.getTime() + i * 3600_000);
    if (isWithinBusinessHours(doc, probe)) {
      return Math.max(0, probe.getTime() - from.getTime());
    }
  }
  return 3600_000;
}

export function computeStepDelayMs(
  doc: NurtureJourneyDoc,
  step: NurtureStep,
  stepIndex: number,
  from = new Date()
): number {
  if (doc.scheduleMode === 'calendar' && step.calendar) {
    const { weekday, time } = step.calendar;
    const [hh, mm] = time.split(':').map(Number);
    const tz = doc.businessHours.timezone || 'America/Sao_Paulo';
    for (let d = 0; d < 14; d++) {
      const probe = new Date(from.getTime() + d * 86400_000);
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).formatToParts(probe);
      const wStr = parts.find((p) => p.type === 'weekday')?.value || '';
      const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const day = map[wStr] ?? probe.getDay();
      if (day === weekday) {
        const brParts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(probe);
        const y = Number(brParts.find((p) => p.type === 'year')?.value);
        const mo = Number(brParts.find((p) => p.type === 'month')?.value) - 1;
        const da = Number(brParts.find((p) => p.type === 'day')?.value);
        const utcGuess = Date.UTC(y, mo, da, (hh || 9) + 3, mm || 0);
        if (utcGuess > from.getTime()) {
          return Math.max(0, utcGuess - from.getTime()) + nextBusinessWindowMs(doc, new Date(utcGuess));
        }
      }
    }
  }
  const hours = stepIndex === 0 ? 0 : Math.max(0, Number(step.delayHours) || 24);
  const target = from.getTime() + hours * 3600_000;
  return Math.max(0, target - from.getTime()) + nextBusinessWindowMs(doc, new Date(target));
}

function normalizeToken(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function wantsOptOut(doc: NurtureJourneyDoc, text: string): boolean {
  const norm = normalizeToken(text);
  if (!norm) return false;
  return doc.globalOptOutKeywords.some((kw) => norm === kw || norm.includes(kw));
}

function matchStepOption(step: NurtureStep, text: string) {
  if (!step.options?.length) return null;
  const norm = normalizeToken(text);
  for (const opt of step.options) {
    if (opt.tokens.some((t) => norm === t || norm.includes(t))) return opt;
  }
  return null;
}

export function buildNurtureStepMessage(
  step: NurtureStep,
  phone: string,
  doc?: NurtureJourneyDoc
): string {
  let msg = applyMessageVars(step.body || '', phone);
  if (doc?.socialLinks) {
    const block = formatNurtureSocialLinks(doc.socialLinks);
    msg = msg.replace(/\{redes_sociais\}/gi, block);
  } else {
    msg = msg.replace(/\{redes_sociais\}/gi, '');
  }
  const link = step.linkUrl?.trim();
  if (link) {
    msg = msg.trim() ? `${msg.trim()}\n\n${link}` : link;
  }
  return msg.trim();
}

export function buildNurtureStepMedia(step: NurtureStep): NurtureEnqueueMedia | undefined {
  const m = step.media;
  if (!m?.url || !m.mimeType) return undefined;
  return {
    url: m.url,
    mimeType: m.mimeType,
    fileName: m.fileName || 'anexo',
    caption: step.body?.trim() || undefined,
    sendAsDocument: m.sendAsDocument
  };
}

export async function enrollContactInNurture(params: {
  tenantId: string;
  contactPhone: string;
  connectionId: string;
  conversationId?: string;
  journeyId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!vpsDataEnabled() || !getZapmassPool()) {
    return { ok: false, error: 'Requer PostgreSQL (modo VPS).' };
  }
  const phone = params.contactPhone.replace(/\D/g, '');
  if (phone.length < 8) return { ok: false, error: 'Telefone inválido.' };

  const journey = await getOrCreatePrimaryJourneyPg(params.tenantId);
  if (params.journeyId && journey.id !== params.journeyId) {
    return { ok: false, error: 'Jornada não encontrada.' };
  }
  const doc = journey.doc;
  if (!journey.enabled && !doc.enabled) {
    return { ok: false, error: 'Ative a jornada antes de inscrever contatos.' };
  }
  if (doc.connectionIds.length > 0 && !doc.connectionIds.includes(params.connectionId)) {
    return { ok: false, error: 'Chip não permitido nesta jornada.' };
  }

  const convId = params.conversationId || `${params.connectionId}:${phone}`;
  const step0 = doc.steps[0];
  if (!step0) return { ok: false, error: 'Jornada sem passos.' };

  const delayMs = computeStepDelayMs(doc, step0, 0);
  const nextRun = new Date(Date.now() + delayMs);

  await upsertEnrollmentPg(params.tenantId, journey.id, {
    contactPhone: phone,
    connectionId: params.connectionId,
    conversationId: convId,
    status: 'enrolled',
    currentStepIndex: 0,
    nextRunAt: nextRun
  });
  await refreshActiveEnrollmentCountPg(params.tenantId, journey.id);
  return { ok: true };
}

export async function tryAutoEnrollOnOptIn(params: {
  tenantId: string;
  phoneDigits: string;
  connectionId?: string;
  conversationId?: string;
}): Promise<void> {
  const { tryAutoEnrollHotLead } = await import('./nurtureHotLeads.js');
  return tryAutoEnrollHotLead(params);
}

export async function processNurtureDueEnrollment(
  row: {
    id: string;
    tenantId: string;
    journeyId: string;
    contactPhone: string;
    connectionId: string;
    conversationId: string;
    currentStepIndex: number;
    journeyDoc: NurtureJourneyDoc;
    lastSentDayKey: string | null;
  },
  opts?: { force?: boolean; delayMs?: number }
): Promise<void> {
  if (!enqueueFn) return;
  const doc = row.journeyDoc;
  const step = doc.steps[row.currentStepIndex];
  if (!step) {
    await updateEnrollmentStatusPg(row.tenantId, row.id, { status: 'completed' });
    await bumpNurtureMetricPg(row.tenantId, row.journeyId, 'completed');
    await refreshActiveEnrollmentCountPg(row.tenantId, row.journeyId);
    return;
  }

  const convId = row.conversationId || `${row.connectionId}:${row.contactPhone}`;
  if (doc.stopOnHumanClaim && getClaimerSync(row.tenantId, convId)) {
    await updateEnrollmentStatusPg(row.tenantId, row.id, {
      status: 'paused',
      pauseReason: 'human_claim',
      nextRunAt: null
    });
    return;
  }

  const todayKey = brazilDayKey();
  if (
    !opts?.force &&
    row.lastSentDayKey === todayKey &&
    doc.maxMessagesPerDayPerContact <= 1
  ) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    await updateEnrollmentStatusPg(row.tenantId, row.id, { nextRunAt: tomorrow });
    return;
  }

  if (!opts?.force && !isWithinBusinessHours(doc)) {
    const wait = nextBusinessWindowMs(doc);
    await updateEnrollmentStatusPg(row.tenantId, row.id, {
      nextRunAt: new Date(Date.now() + wait)
    });
    return;
  }

  const message = buildNurtureStepMessage(step, row.contactPhone, doc);
  const media = buildNurtureStepMedia(step);
  if (!message.trim() && !media) {
    await updateEnrollmentStatusPg(row.tenantId, row.id, {
      status: 'failed',
      pauseReason: 'empty_step',
      nextRunAt: null
    });
    return;
  }
  const humanDelay =
    opts?.delayMs ?? (opts?.force ? 0 : 45_000 + Math.floor(Math.random() * 75_000));

  await enqueueFn({
    tenantId: row.tenantId,
    journeyId: row.journeyId,
    enrollmentId: row.id,
    connectionId: row.connectionId,
    contactPhone: row.contactPhone,
    message,
    stepIndex: row.currentStepIndex,
    delayMs: humanDelay,
    media
  });

  await updateEnrollmentStatusPg(row.tenantId, row.id, {
    status: 'active',
    nextRunAt: new Date(Date.now() + 30 * 60_000),
    lastSentDayKey: todayKey
  });
}

/** Chamado após envio BullMQ confirmado (processCampaignJob). */
export async function completeNurtureStepAfterSend(params: {
  tenantId: string;
  enrollmentId: string;
  journeyId: string;
  sentStepIndex: number;
  journeyDoc: NurtureJourneyDoc;
}): Promise<void> {
  const { doc } = { doc: params.journeyDoc };
  const step = doc.steps[params.sentStepIndex];
  if (!step) {
    await updateEnrollmentStatusPg(params.tenantId, params.enrollmentId, {
      status: 'completed',
      nextRunAt: null
    });
    await bumpNurtureMetricPg(params.tenantId, params.journeyId, 'completed');
    await refreshActiveEnrollmentCountPg(params.tenantId, params.journeyId);
    return;
  }

  await bumpNurtureMetricPg(params.tenantId, params.journeyId, 'materialsSent');

  const nextIndex = params.sentStepIndex + 1;
  const nextStep = doc.steps[nextIndex];

  if (step.kind === 'wait_reply') {
    let nextRunAt: Date | null = null;
    if (step.timeoutHours) {
      nextRunAt = new Date(Date.now() + step.timeoutHours * 3600_000);
    }
    await updateEnrollmentStatusPg(params.tenantId, params.enrollmentId, {
      status: 'waiting_reply',
      currentStepIndex: params.sentStepIndex,
      nextRunAt
    });
    await refreshActiveEnrollmentCountPg(params.tenantId, params.journeyId);
    return;
  }

  if (!nextStep) {
    await updateEnrollmentStatusPg(params.tenantId, params.enrollmentId, {
      status: 'completed',
      currentStepIndex: nextIndex,
      nextRunAt: null
    });
    await bumpNurtureMetricPg(params.tenantId, params.journeyId, 'completed');
    await refreshActiveEnrollmentCountPg(params.tenantId, params.journeyId);
    return;
  }

  const delayMs = computeStepDelayMs(doc, nextStep, nextIndex);
  await updateEnrollmentStatusPg(params.tenantId, params.enrollmentId, {
    status: 'active',
    currentStepIndex: nextIndex,
    nextRunAt: new Date(Date.now() + delayMs)
  });
  await refreshActiveEnrollmentCountPg(params.tenantId, params.journeyId);
}

export type NurtureInboundParams = {
  tenantId: string;
  connectionId: string;
  phoneDigits: string;
  bodyText: string;
  incomingConvId: string;
  hasReplyFlowSession: boolean;
  sendText: NurtureSendTextFn;
};

export async function handleNurtureIncoming(params: NurtureInboundParams): Promise<boolean> {
  if (!vpsDataEnabled() || !getZapmassPool()) return false;
  if (params.hasReplyFlowSession) return false;

  const phone = params.phoneDigits.replace(/\D/g, '');
  const enrollment = await findActiveEnrollmentPg(params.tenantId, params.connectionId, phone);
  if (!enrollment || !enrollment.journeyEnabled) return false;

  const doc = enrollment.journeyDoc;
  if (doc.connectionIds.length > 0 && !doc.connectionIds.includes(params.connectionId)) return false;
  if (getClaimerSync(params.tenantId, params.incomingConvId)) return false;

  if (wantsOptOut(doc, params.bodyText)) {
    await updateEnrollmentStatusPg(params.tenantId, enrollment.id, {
      status: 'cancelled',
      pauseReason: 'opt_out',
      nextRunAt: null
    });
    await bumpNurtureMetricPg(params.tenantId, enrollment.journeyId, 'optOuts');
    publishOwnerEvent(params.tenantId, 'contact-marketing-consent', {
      campaignId: 'nurture_journey',
      phoneDigits: phone,
      effect: 'opt_out',
      replyText: params.bodyText.slice(0, 500),
      at: new Date().toISOString()
    });
    await params.sendText(
      params.incomingConvId,
      applyMessageVars('Certo, você não receberá mais mensagens desta jornada. 👍', phone)
    );
    await refreshActiveEnrollmentCountPg(params.tenantId, enrollment.journeyId);
    return true;
  }

  if (enrollment.status !== 'waiting_reply') {
    return false;
  }

  const step = doc.steps[enrollment.currentStepIndex];
  if (!step) return false;

  await bumpNurtureMetricPg(params.tenantId, enrollment.journeyId, 'repliesReceived');

  const matched = matchStepOption(step, params.bodyText);
  if (matched) {
    if (matched.reply.trim()) {
      await params.sendText(params.incomingConvId, applyMessageVars(matched.reply, phone));
    }
    if (matched.handoff) {
      await bumpNurtureMetricPg(params.tenantId, enrollment.journeyId, 'handoffs');
      await updateEnrollmentStatusPg(params.tenantId, enrollment.id, {
        status: 'paused',
        pauseReason: 'handoff',
        nextRunAt: null
      });
      await insertNotificationPg(params.tenantId, {
        title: 'Jornada: lead pediu atendimento humano',
        body: `${params.bodyText.slice(0, 120)} — abra o Bate-papo.`,
        kind: 'warning',
        category: 'system'
      });
      return true;
    }
  } else if (step.kind === 'wait_reply' && step.options?.length) {
    await params.sendText(
      params.incomingConvId,
      applyMessageVars('Não entendi. Responda com uma das opções indicadas na mensagem anterior.', phone)
    );
    return true;
  }

  const nextIndex = enrollment.currentStepIndex + 1;
  const nextStep = doc.steps[nextIndex];
  if (!nextStep) {
    await updateEnrollmentStatusPg(params.tenantId, enrollment.id, {
      status: 'completed',
      nextRunAt: null
    });
    await bumpNurtureMetricPg(params.tenantId, enrollment.journeyId, 'completed');
    await refreshActiveEnrollmentCountPg(params.tenantId, enrollment.journeyId);
    return true;
  }

  const delayMs = computeStepDelayMs(doc, nextStep, nextIndex);
  await updateEnrollmentStatusPg(params.tenantId, enrollment.id, {
    status: 'active',
    currentStepIndex: nextIndex,
    nextRunAt: new Date(Date.now() + delayMs)
  });
  return true;
}

export async function forceDispatchNurtureEnrollments(params: {
  tenantId: string;
  journeyId: string;
  enrollmentIds?: string[];
  allActive?: boolean;
}): Promise<{ ok: boolean; queued: number; error?: string }> {
  if (!enqueueFn) return { ok: false, queued: 0, error: 'Motor de fila indisponível.' };
  let ids = (params.enrollmentIds || []).filter(Boolean).slice(0, 100);
  if (params.allActive) {
    const active = await listNurtureEnrollmentsPg(params.tenantId, params.journeyId, 100, {
      status: 'active'
    });
    ids = active.map((e) => e.id);
  }
  if (ids.length === 0) {
    return { ok: false, queued: 0, error: 'Nenhum inscrito selecionado.' };
  }
  const rows = await loadNurtureEnrollmentDispatchRowsPg(params.tenantId, params.journeyId, ids);
  let queued = 0;
  for (const row of rows) {
    if (!['enrolled', 'active', 'waiting_reply', 'paused'].includes(row.enrollment.status)) continue;
    try {
      await processNurtureDueEnrollment(
        {
          id: row.enrollment.id,
          tenantId: params.tenantId,
          journeyId: params.journeyId,
          contactPhone: row.enrollment.contactPhone,
          connectionId: row.enrollment.connectionId,
          conversationId: row.enrollment.conversationId,
          currentStepIndex: row.enrollment.currentStepIndex,
          journeyDoc: row.journeyDoc,
          lastSentDayKey: row.lastSentDayKey
        },
        { force: true, delayMs: 0 }
      );
      queued += 1;
    } catch (e) {
      console.warn('[nurture] force dispatch falhou', row.enrollment.id, (e as Error)?.message);
    }
  }
  return { ok: queued > 0, queued, error: queued === 0 ? 'Nenhum envio enfileirado.' : undefined };
}

export async function cancelNurtureEnrollment(tenantId: string, enrollmentId: string): Promise<void> {
  await updateEnrollmentStatusPg(tenantId, enrollmentId, {
    status: 'cancelled',
    pauseReason: 'manual',
    nextRunAt: null
  });
}
