import {
  appendContactEvent,
  saveReplyFlowStateForContact,
  upsertPreferredConnection,
} from './contactEventsRepository.js';
import type { ReplyFlowSession } from '../replyFlowEngine.js';

/** Eventos de identidade — fire-and-forget, nunca bloqueia envio/inbound. */
export function recordContactOutboundSent(params: {
  tenantId: string;
  phone: string;
  connectionId: string;
  campaignId?: string;
  stageIndex?: number;
}): void {
  void appendContactEvent({
    tenantId: params.tenantId,
    phone: params.phone,
    kind: 'outbound_sent',
    connectionId: params.connectionId,
    campaignId: params.campaignId,
    payload: { stage: params.stageIndex ?? null },
  }).catch(() => undefined);
  void upsertPreferredConnection(params.tenantId, params.phone, params.connectionId).catch(() => undefined);
}

export function recordContactInboundReply(params: {
  tenantId: string;
  phone: string;
  connectionId: string;
  campaignId?: string;
  preview?: string;
}): void {
  void appendContactEvent({
    tenantId: params.tenantId,
    phone: params.phone,
    kind: 'inbound_reply',
    connectionId: params.connectionId,
    campaignId: params.campaignId,
    payload: { preview: params.preview?.slice(0, 200) },
  }).catch(() => undefined);
  void upsertPreferredConnection(params.tenantId, params.phone, params.connectionId).catch(() => undefined);
}

export function recordContactOptOutEvent(params: {
  tenantId: string;
  phone: string;
  connectionId?: string;
  source?: string;
}): void {
  void appendContactEvent({
    tenantId: params.tenantId,
    phone: params.phone,
    kind: 'opt_out',
    connectionId: params.connectionId,
    payload: { source: params.source || 'opt_out' },
  }).catch(() => undefined);
}

export function recordContactChipFailover(params: {
  tenantId: string;
  phone: string;
  fromConnectionId: string;
  toConnectionId: string;
  campaignId?: string;
}): void {
  void appendContactEvent({
    tenantId: params.tenantId,
    phone: params.phone,
    kind: 'chip_failover',
    connectionId: params.toConnectionId,
    campaignId: params.campaignId,
    payload: { from: params.fromConnectionId, to: params.toConnectionId },
  }).catch(() => undefined);
  void upsertPreferredConnection(params.tenantId, params.phone, params.toConnectionId).catch(() => undefined);
}

export function persistReplyFlowSessionForContact(
  tenantId: string | undefined,
  phoneDigits: string,
  session: ReplyFlowSession
): void {
  if (!tenantId) return;
  const state = {
    campaignId: session.campaignId,
    awaitingAfterStep: session.awaitingAfterStep,
    ownerUid: session.ownerUid,
    updatedAt: new Date().toISOString(),
  };
  void saveReplyFlowStateForContact(tenantId, phoneDigits, state).catch(() => undefined);
}
