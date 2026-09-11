import { getSharedRedis } from './redisShared.js';
import { persistUserNotification } from './notificationStore.js';

export type AntiBanAlertType =
  | 'campaign-protection-paused'
  | 'chip-circuit-breaker-open'
  | 'chip-circuit-breaker-half-open'
  | 'chip-circuit-breaker-throttled'
  | 'proxy-down'
  | 'proxy-datacenter-risk'
  | 'proxy-egress-drift'
  | 'reconnect-storm-warning'
  | 'chip-reconnect-exhausted'
  | 'tenant-ban-cooldown-started'
  | 'contact-marketing-consent';

export type AntiBanAlertPayload = {
  title: string;
  body: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  campaignId?: string;
  connectionId?: string;
  reason?: string;
  message?: string;
  autoResumeAt?: number;
  hours?: number;
};

type PublishFn = (tenantId: string, event: string, payload: Record<string, unknown>) => void;

let publishFn: PublishFn | null = null;

export function registerAntiBanPublishFn(fn: PublishFn): void {
  publishFn = fn;
}

const DEDUPE_TTL_SEC = 15 * 60;

async function shouldDedupe(tenantId: string, type: AntiBanAlertType, dedupeKey: string): Promise<boolean> {
  const redis = getSharedRedis();
  if (!redis) return false;
  const key = `zapmass:anti-ban:alert:${tenantId}:${type}:${dedupeKey}`;
  const ok = await redis.set(key, '1', 'EX', DEDUPE_TTL_SEC, 'NX');
  return ok === null;
}

function buildCampaignProtectionPaused(payload: {
  campaignId: string;
  reason?: string;
  message?: string;
  autoResumeAt?: number;
}): AntiBanAlertPayload {
  const resumeHint =
    payload.autoResumeAt && payload.autoResumeAt > Date.now()
      ? ` Retomada automática prevista às ${new Date(payload.autoResumeAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`
      : '';
  return {
    title: 'Campanha pausada pela proteção anti-ban',
    body: `${payload.message || 'A campanha foi pausada preventivamente para evitar banimento.'}${resumeHint} Motivo: ${payload.reason || 'proteção'}.`,
    kind: 'warning',
    campaignId: payload.campaignId,
    reason: payload.reason,
    message: payload.message,
    autoResumeAt: payload.autoResumeAt,
  };
}

function buildCircuitBreakerOpen(payload: {
  connectionId: string;
  connectionLabel?: string;
}): AntiBanAlertPayload {
  const label = payload.connectionLabel || payload.connectionId;
  return {
    title: 'Chip isolado pelo circuit breaker',
    body: `O chip ${label} foi temporariamente isolado do pool por taxa elevada de falhas (4xx). Os demais chips continuam enviando. Aguarde a janela de recuperação (5 min) ou verifique a saúde da conexão.`,
    kind: 'warning',
    connectionId: payload.connectionId,
  };
}

function buildCircuitBreakerHalfOpen(payload: {
  connectionId: string;
  connectionLabel?: string;
  failRatePct?: number;
}): AntiBanAlertPayload {
  const label = payload.connectionLabel || payload.connectionId;
  const rate =
    typeof payload.failRatePct === 'number' ? ` (${payload.failRatePct}% de falhas na janela)` : '';
  return {
    title: 'Instabilidade detectada no chip — ação preventiva',
    body: `O chip ${label} está com taxa elevada de falhas${rate}. Reduza o ritmo de envio ou troque para outro chip saudável antes que o circuit breaker isole este canal. Verifique Conexões → Proteção de chips.`,
    kind: 'warning',
    connectionId: payload.connectionId,
  };
}

function buildCircuitBreakerThrottled(payload: {
  connectionId: string;
  connectionLabel?: string;
  deliveryRatioPct?: number;
}): AntiBanAlertPayload {
  const label = payload.connectionLabel || payload.connectionId;
  const rate =
    typeof payload.deliveryRatioPct === 'number'
      ? ` (${payload.deliveryRatioPct}% de ACK de entrega na janela)`
      : '';
  return {
    title: 'Soft-ban detectado — entrega degradada',
    body: `O chip ${label} está enviando, mas a taxa de confirmação de entrega caiu${rate}. O sistema desacelera automaticamente este chip para evitar banimento. Considere pausar a campanha ou trocar de chip.`,
    kind: 'warning',
    connectionId: payload.connectionId,
  };
}

function buildReconnectStormWarning(payload: {
  dropsInWindow?: number;
  threshold?: number;
  windowMinutes?: number;
}): AntiBanAlertPayload {
  const drops = payload.dropsInWindow ?? 2;
  const threshold = payload.threshold ?? 3;
  const windowMin = payload.windowMinutes ?? 30;
  return {
    title: 'Aviso: chip instável — próxima queda ativa proteção',
    body: `${drops} queda(s) de conexão nos últimos ${windowMin} min. Se cair mais ${threshold - drops} vez(es), a proteção anti-ban entra em modo reforçado por 6h (reconexão lenta e campanhas pausadas). Evite reconectar manualmente em loop — aguarde a reconexão automática ou use outro chip.`,
    kind: 'warning',
  };
}

function buildProxyDown(payload: {
  connectionId: string;
  connectionLabel?: string;
  error?: string;
}): AntiBanAlertPayload {
  const label = payload.connectionLabel || payload.connectionId;
  return {
    title: 'Proxy indisponível — envios bloqueados',
    body: `O proxy do chip ${label} falhou na checagem de egress (${payload.error || 'timeout'}). Campanhas não usarão este chip até o proxy voltar — evita vazamento pelo IP da VPS.`,
    kind: 'error',
    connectionId: payload.connectionId,
  };
}

function buildProxyDatacenterRisk(payload: {
  connectionId: string;
  connectionLabel?: string;
  egressIp?: string;
  isp?: string;
  asLabel?: string;
}): AntiBanAlertPayload {
  const label = payload.connectionLabel || payload.connectionId;
  const ip = payload.egressIp ? ` IP ${payload.egressIp}` : '';
  const isp = payload.isp ? ` (${payload.isp})` : '';
  return {
    title: 'Alto risco de banimento — proxy datacenter',
    body: `O egress do chip ${label}${ip}${isp} parece ser datacenter/hosting. Prefira proxy residencial/ISP sticky para reduzir suspensão da sessão WhatsApp.`,
    kind: 'warning',
    connectionId: payload.connectionId,
  };
}

function buildProxyEgressDrift(payload: {
  connectionId: string;
  connectionLabel?: string;
  previousIp?: string;
  egressIp?: string;
}): AntiBanAlertPayload {
  const label = payload.connectionLabel || payload.connectionId;
  return {
    title: 'Variação de IP de egress (sticky drift)',
    body: `O chip ${label} mudou de IP de saída (${payload.previousIp || '?'} → ${payload.egressIp || '?'}). Proxies sticky instáveis disparam alertas de segurança da Meta — verifique o provedor.`,
    kind: 'warning',
    connectionId: payload.connectionId,
  };
}

function buildChipReconnectExhausted(payload: {
  connectionId: string;
  connectionLabel?: string;
}): AntiBanAlertPayload {
  const label = payload.connectionLabel || payload.connectionId;
  return {
    title: 'Chip offline — reconexão automática em andamento',
    body: `O chip ${label} caiu e as tentativas rápidas de reconexão esgotaram. O sistema continuará tentando reconectar a cada ~30 min automaticamente. Se persistir, abra Conexões e use "Conectar" ou verifique o celular/WhatsApp.`,
    kind: 'warning',
    connectionId: payload.connectionId,
  };
}

function buildBanCooldownStarted(payload: { hours?: number }): AntiBanAlertPayload {
  const h = payload.hours ?? 48;
  return {
    title: 'Proteção ativada após incidente no chip',
    body: `Detectamos instabilidade ou banimento em um chip. A proteção automática entrou em cooldown de ${h}h: sync leve, nurture e automações inbound pausados. Evite reconectar agressivamente — aguarde o período de recuperação.`,
    kind: 'error',
    hours: h,
  };
}

function buildContactMarketingConsent(payload: {
  phoneDigits?: string;
  effect?: string;
  replyText?: string;
  jobsCancelled?: number;
}): AntiBanAlertPayload {
  const phone = payload.phoneDigits ? ` (${payload.phoneDigits})` : '';
  const jobs =
    typeof payload.jobsCancelled === 'number' && payload.jobsCancelled > 0
      ? ` ${payload.jobsCancelled} envio(s) pendente(s) cancelado(s).`
      : '';
  return {
    title: 'Contato descadastrado (opt-out)',
    body: `O contato${phone} solicitou parar mensagens promocionais.${jobs} Jornadas de nurture ativas foram canceladas.`,
    kind: 'info',
    message: payload.replyText,
  };
}

/**
 * Centraliza alertas proativos: persiste notificação + emite socket para o tenant.
 */
export async function emitAntiBanAlert(
  tenantId: string,
  type: AntiBanAlertType,
  raw: Record<string, unknown>
): Promise<void> {
  const tid = String(tenantId || '').trim();
  if (!tid) return;

  let alert: AntiBanAlertPayload;
  let dedupeKey: string;

  switch (type) {
    case 'campaign-protection-paused': {
      const campaignId = String(raw.campaignId || '').trim();
      if (!campaignId) return;
      dedupeKey = `${campaignId}:${String(raw.reason || '')}`;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildCampaignProtectionPaused({
        campaignId,
        reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        message: typeof raw.message === 'string' ? raw.message : undefined,
        autoResumeAt: typeof raw.autoResumeAt === 'number' ? raw.autoResumeAt : undefined,
      });
      break;
    }
    case 'chip-circuit-breaker-open': {
      const connectionId = String(raw.connectionId || '').trim();
      if (!connectionId) return;
      dedupeKey = connectionId;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildCircuitBreakerOpen({
        connectionId,
        connectionLabel: typeof raw.connectionLabel === 'string' ? raw.connectionLabel : undefined,
      });
      break;
    }
    case 'chip-circuit-breaker-half-open': {
      const connectionId = String(raw.connectionId || '').trim();
      if (!connectionId) return;
      dedupeKey = connectionId;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildCircuitBreakerHalfOpen({
        connectionId,
        connectionLabel: typeof raw.connectionLabel === 'string' ? raw.connectionLabel : undefined,
        failRatePct: typeof raw.failRatePct === 'number' ? raw.failRatePct : undefined,
      });
      break;
    }
    case 'chip-circuit-breaker-throttled': {
      const connectionId = String(raw.connectionId || '').trim();
      if (!connectionId) return;
      dedupeKey = connectionId;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildCircuitBreakerThrottled({
        connectionId,
        connectionLabel: typeof raw.connectionLabel === 'string' ? raw.connectionLabel : undefined,
        deliveryRatioPct: typeof raw.deliveryRatioPct === 'number' ? raw.deliveryRatioPct : undefined,
      });
      break;
    }
    case 'proxy-down': {
      const connectionId = String(raw.connectionId || '').trim();
      if (!connectionId) return;
      dedupeKey = connectionId;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildProxyDown({
        connectionId,
        connectionLabel: typeof raw.connectionLabel === 'string' ? raw.connectionLabel : undefined,
        error: typeof raw.error === 'string' ? raw.error : undefined,
      });
      break;
    }
    case 'proxy-datacenter-risk': {
      const connectionId = String(raw.connectionId || '').trim();
      if (!connectionId) return;
      dedupeKey = `${connectionId}:${String(raw.egressIp || '')}`;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildProxyDatacenterRisk({
        connectionId,
        connectionLabel: typeof raw.connectionLabel === 'string' ? raw.connectionLabel : undefined,
        egressIp: typeof raw.egressIp === 'string' ? raw.egressIp : undefined,
        isp: typeof raw.isp === 'string' ? raw.isp : undefined,
        asLabel: typeof raw.asLabel === 'string' ? raw.asLabel : undefined,
      });
      break;
    }
    case 'proxy-egress-drift': {
      const connectionId = String(raw.connectionId || '').trim();
      if (!connectionId) return;
      dedupeKey = `${connectionId}:${String(raw.egressIp || '')}`;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildProxyEgressDrift({
        connectionId,
        connectionLabel: typeof raw.connectionLabel === 'string' ? raw.connectionLabel : undefined,
        previousIp: typeof raw.previousIp === 'string' ? raw.previousIp : undefined,
        egressIp: typeof raw.egressIp === 'string' ? raw.egressIp : undefined,
      });
      break;
    }
    case 'reconnect-storm-warning': {
      dedupeKey = `storm:${raw.dropsInWindow ?? 2}`;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildReconnectStormWarning({
        dropsInWindow: typeof raw.dropsInWindow === 'number' ? raw.dropsInWindow : undefined,
        threshold: typeof raw.threshold === 'number' ? raw.threshold : undefined,
        windowMinutes: typeof raw.windowMinutes === 'number' ? raw.windowMinutes : undefined,
      });
      break;
    }
    case 'chip-reconnect-exhausted': {
      const connectionId = String(raw.connectionId || '').trim();
      if (!connectionId) return;
      dedupeKey = connectionId;
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildChipReconnectExhausted({
        connectionId,
        connectionLabel: typeof raw.connectionLabel === 'string' ? raw.connectionLabel : undefined,
      });
      break;
    }
    case 'tenant-ban-cooldown-started': {
      dedupeKey = 'ban';
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildBanCooldownStarted({
        hours: typeof raw.hours === 'number' ? raw.hours : undefined,
      });
      break;
    }
    case 'contact-marketing-consent': {
      const phoneDigits = String(raw.phoneDigits || raw.phoneSuffix || '').trim();
      dedupeKey = phoneDigits || String(raw.replyText || 'opt_out');
      if (await shouldDedupe(tid, type, dedupeKey)) return;
      alert = buildContactMarketingConsent({
        phoneDigits: phoneDigits || undefined,
        effect: typeof raw.effect === 'string' ? raw.effect : undefined,
        replyText: typeof raw.replyText === 'string' ? raw.replyText : undefined,
        jobsCancelled: typeof raw.jobsCancelled === 'number' ? raw.jobsCancelled : undefined,
      });
      break;
    }
    default:
      return;
  }

  await persistUserNotification(tid, {
    title: alert.title,
    body: alert.body,
    kind: alert.kind,
    category: type === 'campaign-protection-paused' ? 'campaign' : 'system',
    campaignId: alert.campaignId,
  });

  publishFn?.(tid, type, {
    ...alert,
    type,
    at: new Date().toISOString(),
  });

  publishFn?.(tid, 'tenant-notification', {
    title: alert.title,
    body: alert.body,
    kind: alert.kind,
    category:
      type === 'campaign-protection-paused'
        ? 'campaign'
        : type === 'contact-marketing-consent'
          ? 'contacts'
          : 'system',
    campaignId: alert.campaignId,
    type,
    at: new Date().toISOString(),
  });

  if (type === 'contact-marketing-consent') {
    publishFn?.(tid, 'contact-marketing-consent', {
      ...raw,
      title: alert.title,
      body: alert.body,
      kind: alert.kind,
      at: new Date().toISOString(),
    });
  }

  if (type === 'chip-circuit-breaker-open' && alert.connectionId) {
    publishFn?.(tid, 'circuit-breaker-open', { connectionId: alert.connectionId });
    publishFn?.(tid, 'chip-circuit-breaker-open', { connectionId: alert.connectionId });
  }

  if (type === 'chip-circuit-breaker-half-open' && alert.connectionId) {
    publishFn?.(tid, 'chip-circuit-breaker-half-open', {
      connectionId: alert.connectionId,
      title: alert.title,
      body: alert.body,
    });
  }

  if (type === 'chip-circuit-breaker-throttled' && alert.connectionId) {
    publishFn?.(tid, 'chip-circuit-breaker-throttled', {
      connectionId: alert.connectionId,
      title: alert.title,
      body: alert.body,
    });
  }

  if (type === 'proxy-down' && alert.connectionId) {
    publishFn?.(tid, 'proxy-down', { connectionId: alert.connectionId, title: alert.title, body: alert.body });
  }
  if (type === 'proxy-datacenter-risk' && alert.connectionId) {
    publishFn?.(tid, 'proxy-datacenter-risk', { connectionId: alert.connectionId, title: alert.title, body: alert.body });
  }
  if (type === 'proxy-egress-drift' && alert.connectionId) {
    publishFn?.(tid, 'proxy-egress-drift', { connectionId: alert.connectionId, title: alert.title, body: alert.body });
  }

  if (type === 'reconnect-storm-warning') {
    publishFn?.(tid, 'reconnect-storm-warning', {
      title: alert.title,
      body: alert.body,
    });
  }

  if (type === 'chip-reconnect-exhausted' && alert.connectionId) {
    publishFn?.(tid, 'chip-reconnect-exhausted', {
      connectionId: alert.connectionId,
      title: alert.title,
      body: alert.body,
    });
  }
}
