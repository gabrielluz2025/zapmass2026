export interface ScoreInputs {
  delivered: number;
  read: number;
  replied: number;
  /** Mensagens enviadas (mesma base do funil). */
  sent: number;
  throughputPerMin: number;
  failed: number;
  plannedContacts?: number;
  replyFlowMode?: boolean;
}

export const SCORE_TARGET_THROUGHPUT_PER_MIN = 4;
/** Campanhas com até N contatos no fluxo por resposta: espera do contato não penaliza velocidade. */
export const SCORE_SOFT_SPEED_CONTACT_CAP = 100;

const W_DELIVERY = 0.3;
const W_READ = 0.3;
const W_REPLY = 0.25;
const W_SPEED = 0.15;

export function effectiveSpeedPct(
  inputs: Pick<ScoreInputs, 'throughputPerMin' | 'replyFlowMode' | 'plannedContacts'>,
  sentBase: number,
  replyRate: number
): number {
  const fromThroughput = Math.min(1, inputs.throughputPerMin / SCORE_TARGET_THROUGHPUT_PER_MIN);
  if (!inputs.replyFlowMode || sentBase <= 0) return fromThroughput;

  const contactCap = Math.max(sentBase, inputs.plannedContacts || 0);
  if (contactCap > SCORE_SOFT_SPEED_CONTACT_CAP) return fromThroughput;

  if (replyRate > 0) {
    return Math.max(fromThroughput, Math.min(1, replyRate));
  }
  return fromThroughput;
}

export function computeCampaignScore(inputs: ScoreInputs): {
  score: number;
  sentBase: number;
  speedPct: number;
  scoreDelivery: number;
  scoreRead: number;
  scoreReply: number;
  scoreSpeed: number;
} {
  const sentBase = Math.max(0, inputs.sent);
  const hasSends = sentBase > 0;
  const deliveryRate = hasSends ? Math.min(1, inputs.delivered / sentBase) : 0;
  const readRate = hasSends ? Math.min(1, inputs.read / sentBase) : 0;
  const replyRate = hasSends ? Math.min(1, inputs.replied / sentBase) : 0;
  const speedPct = effectiveSpeedPct(inputs, sentBase, replyRate);

  const scoreDelivery = deliveryRate * W_DELIVERY * 100;
  const scoreRead = readRate * W_READ * 100;
  const scoreReply = Math.min(1, replyRate / 0.1) * W_REPLY * 100;
  const scoreSpeed = speedPct * W_SPEED * 100;

  const score = hasSends
    ? Math.round(scoreDelivery + scoreRead + scoreReply + scoreSpeed)
    : 0;

  return {
    score,
    sentBase,
    speedPct,
    scoreDelivery,
    scoreRead,
    scoreReply,
    scoreSpeed
  };
}
