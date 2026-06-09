import type { SystemLog } from '../types';
import {
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE,
  isCampaignReplyLogMessage
} from './campaignReportFromLogs';

export type DispatchLogKind = 'sent' | 'reply' | 'error' | 'warn' | 'info';

export type DispatchLogPayload = {
  message?: string;
  to?: string;
  phoneDigits?: string;
  error?: string;
  replyPreview?: string;
  replyFlowStep?: number;
  connectionId?: string;
};

export type ParsedDispatchLog = {
  kind: DispatchLogKind;
  label: string;
  detail: string;
  phone: string;
  phoneDisplay: string;
  timestamp: Date;
  event: string;
};

export function formatDispatchPhone(raw?: string): string {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.startsWith('55')) {
    const local = d.slice(2);
    if (local.length === 11) {
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
    }
    if (local.length === 10) {
      return `+55 (${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
    }
    return `+${d}`;
  }
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

export function parseDispatchLog(log: SystemLog): ParsedDispatchLog {
  const payload = (log.payload || {}) as DispatchLogPayload;
  const msg = String(payload.message || payload.error || '').trim();
  const phone = String(payload.phoneDigits || payload.to || '').replace(/\D/g, '');
  const event = String(log.event || '');
  const isErr = event.includes('error');
  const isWarn = event.includes('warn');

  let kind: DispatchLogKind = 'info';
  let label = 'Evento do disparo';
  let detail = msg || log.event;

  if (isErr) {
    kind = 'error';
    label = 'Falha no envio';
    detail = payload.error || msg || 'Erro não especificado';
  } else if (isWarn) {
    kind = 'warn';
    label = 'Atenção';
    detail = msg || 'Evento com aviso';
  } else if (msg === CAMPAIGN_SENT_LOG_MESSAGE || msg.toLowerCase().includes('mensagem enviada')) {
    kind = 'sent';
    label = 'Envio confirmado';
    detail = 'Mensagem entregue ao destinatário';
  } else if (isCampaignReplyLogMessage(msg) || msg === CAMPAIGN_REPLY_LOG_MESSAGE) {
    kind = 'reply';
    label = 'Resposta no fluxo';
    detail = payload.replyPreview
      ? `“${String(payload.replyPreview).slice(0, 120)}”`
      : payload.replyFlowStep != null
        ? `Etapa ${payload.replyFlowStep} do fluxo por resposta`
        : 'Contato respondeu no fluxo automatizado';
  } else if (msg) {
    kind = 'info';
    label = 'Informação';
    detail = msg;
  }

  return {
    kind,
    label,
    detail,
    phone,
    phoneDisplay: formatDispatchPhone(phone),
    timestamp: new Date(log.timestamp),
    event: log.event
  };
}

export type DispatchLogCounts = Record<DispatchLogKind | 'all', number>;

export function countDispatchLogs(logs: SystemLog[]): DispatchLogCounts {
  const out: DispatchLogCounts = { all: logs.length, sent: 0, reply: 0, error: 0, warn: 0, info: 0 };
  for (const log of logs) {
    const k = parseDispatchLog(log).kind;
    out[k]++;
  }
  return out;
}

export type LogFilterTab = 'ALL' | 'FAILED' | 'SENT';

export function filterDispatchLogs(logs: SystemLog[], filter: LogFilterTab): SystemLog[] {
  if (filter === 'ALL') return logs;
  return logs.filter((log) => {
    const p = parseDispatchLog(log);
    if (filter === 'FAILED') return p.kind === 'error' || p.kind === 'warn';
    if (filter === 'SENT') return p.kind === 'sent' || p.kind === 'reply';
    return true;
  });
}

export function searchDispatchLogs(logs: SystemLog[], query: string): SystemLog[] {
  const q = query.trim().toLowerCase();
  if (!q) return logs;
  return logs.filter((log) => {
    const p = parseDispatchLog(log);
    const hay = [p.label, p.detail, p.phone, p.phoneDisplay, p.event, log.timestamp].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export const DISPATCH_LOG_STYLES: Record<
  DispatchLogKind,
  { accent: string; bg: string; border: string; IconName: 'sent' | 'reply' | 'error' | 'warn' | 'info' }
> = {
  sent: { accent: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.35)', IconName: 'sent' },
  reply: { accent: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)', IconName: 'reply' },
  error: { accent: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)', IconName: 'error' },
  warn: { accent: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', IconName: 'warn' },
  info: { accent: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)', IconName: 'info' }
};
