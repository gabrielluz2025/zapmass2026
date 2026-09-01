export type AccessUser = {
  uid: string;
  email: string;
  status: string;
  provider: string;
  plan: string | null;
  blocked: boolean;
  manualGrant: boolean;
  trialEndsAt: string | null;
  accessEndsAt: string | null;
  manualAccessEndsAt: string | null;
  includedChannels: number;
  manualExtraChannelSlots: number;
  manualExtraChannelSlotsEndsAt: string | null;
  adminBonusChannelSlots: number;
  adminNote: string;
  updatedAt: string | null;
};

export type AccessAudit = {
  id: string;
  targetUid: string;
  targetEmail: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  note: string;
  createdAt: string | null;
};

export type AccessUserInsights = {
  uid: string;
  email: string;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  firstActivityAt: string | null;
  daysSinceFirstActivity: number;
  counts: {
    contactsTotal: number;
    contactsValid: number;
    contactsInvalid: number;
    contactLists: number;
    connectionsTotal: number;
    connectionsConnected: number;
    campaignsTotal: number;
    campaignsRunning: number;
    campaignsCompleted: number;
  };
  campaignTotals: {
    targeted: number;
    processed: number;
    success: number;
    failed: number;
  };
  contactTagsTop: Array<{ tag: string; count: number }>;
  listSegmentsTop: Array<{ listName: string; contacts: number }>;
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string | null;
    successCount: number;
    failedCount: number;
    totalContacts: number;
  }>;
  usage: {
    totalActiveMs: number;
    lastActiveAt: string | null;
  } | null;
};

export type AccessFilter = 'all' | 'manual' | 'blocked' | 'active' | 'trialing' | 'expiring7';

export type AccessHealth = 'blocked' | 'critical' | 'warning' | 'ok' | 'open';

export type AccessExpirySlice = {
  key: 'trial' | 'paid' | 'manual';
  label: string;
  at: string | null;
  ms: number;
};

export const toPtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

export const formatAppUsageMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 60_000) return `≈ ${Math.max(1, Math.round(ms / 1000))} s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
};

export const userInitial = (email: string): string => {
  const s = (email || '?').trim();
  return s ? s[0].toUpperCase() : '?';
};

export const statusBadgeVariant = (
  status: string,
  blocked: boolean
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (blocked) return 'danger';
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'trialing') return 'info';
  return 'neutral';
};

export function accessExpirySlices(u: AccessUser): AccessExpirySlice[] {
  return [
    { key: 'trial', label: 'Trial', at: u.trialEndsAt, ms: u.trialEndsAt ? new Date(u.trialEndsAt).getTime() : 0 },
    { key: 'paid', label: 'Pago', at: u.accessEndsAt, ms: u.accessEndsAt ? new Date(u.accessEndsAt).getTime() : 0 },
    {
      key: 'manual',
      label: 'Manual',
      at: u.manualAccessEndsAt,
      ms: u.manualAccessEndsAt ? new Date(u.manualAccessEndsAt).getTime() : 0
    }
  ];
}

export function computeAccessHealth(u: AccessUser, now = Date.now()): {
  health: AccessHealth;
  daysRemaining: number | null;
  nextLabel: string;
  nextAt: string | null;
} {
  if (u.blocked) {
    return { health: 'blocked', daysRemaining: null, nextLabel: 'Bloqueado', nextAt: null };
  }

  const future = accessExpirySlices(u)
    .filter((s) => s.ms > now)
    .sort((a, b) => a.ms - b.ms);

  if (future.length === 0) {
    if (u.manualGrant && !u.manualAccessEndsAt) {
      return { health: 'open', daysRemaining: null, nextLabel: 'Manual sem prazo', nextAt: null };
    }
    return { health: 'critical', daysRemaining: 0, nextLabel: 'Sem prazo ativo', nextAt: null };
  }

  const next = future[0]!;
  const daysRemaining = Math.ceil((next.ms - now) / (24 * 60 * 60 * 1000));
  let health: AccessHealth = 'ok';
  if (daysRemaining <= 3) health = 'critical';
  else if (daysRemaining <= 7) health = 'warning';

  return {
    health,
    daysRemaining,
    nextLabel: next.label,
    nextAt: next.at
  };
}

export const accessHealthStyles: Record<
  AccessHealth,
  { ring: string; bg: string; text: string; dot: string }
> = {
  blocked: {
    ring: 'ring-red-500/40',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    dot: 'bg-red-500'
  },
  critical: {
    ring: 'ring-red-500/30',
    bg: 'bg-red-500/8',
    text: 'text-red-400',
    dot: 'bg-red-500'
  },
  warning: {
    ring: 'ring-amber-500/35',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    dot: 'bg-amber-500'
  },
  ok: {
    ring: 'ring-emerald-500/30',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    dot: 'bg-emerald-500'
  },
  open: {
    ring: 'ring-sky-500/30',
    bg: 'bg-sky-500/10',
    text: 'text-sky-400',
    dot: 'bg-sky-500'
  }
};
