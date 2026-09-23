export type LeadBand = 'cold' | 'warm' | 'hot' | 'blocked';

export type ContactEventKind =
  | 'outbound_sent'
  | 'inbound_reply'
  | 'opt_out'
  | 'opt_in'
  | 'reply_flow_step'
  | 'chip_failover'
  | 'campaign_failed'
  | 'tag_hot'
  | 'tag_warm';

const SCORE: Partial<Record<ContactEventKind, number>> = {
  inbound_reply: 15,
  reply_flow_step: 8,
  outbound_sent: 2,
  tag_hot: 40,
  tag_warm: 20,
  opt_out: -100,
  opt_in: 5,
  campaign_failed: -5,
  chip_failover: 0,
};

export function scoreDeltaForEvent(kind: string): number {
  return SCORE[kind as ContactEventKind] ?? 0;
}

export function leadBandFromScore(score: number, optedOut: boolean): LeadBand {
  if (optedOut) return 'blocked';
  if (score >= 55) return 'hot';
  if (score >= 22) return 'warm';
  return 'cold';
}
