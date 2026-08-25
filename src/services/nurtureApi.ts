import { apiFetchJson } from '../utils/apiFetchAuth';

export type NurtureStepOption = {
  id: string;
  tokens: string[];
  reply: string;
  handoff?: boolean;
};

export type NurtureStepMedia = {
  url: string;
  mimeType: string;
  fileName: string;
  sendAsDocument?: boolean;
};

export type NurtureStep = {
  id: string;
  label?: string;
  kind: 'message' | 'wait_reply';
  body: string;
  delayHours?: number;
  calendar?: { weekday: number; time: string };
  options?: NurtureStepOption[];
  timeoutHours?: number;
  timeoutMessage?: string;
  media?: NurtureStepMedia;
  linkUrl?: string;
};

export type NurtureJourneyDoc = {
  enabled: boolean;
  name: string;
  connectionIds: string[];
  scheduleMode: 'relative' | 'calendar';
  entryRules: {
    autoEnrollOnOptIn: boolean;
    requireMarketingOptIn: boolean;
    defaultConnectionId?: string;
  };
  steps: NurtureStep[];
  businessHours: {
    enabled: boolean;
    timezone: string;
    weekdays: number[];
    start: string;
    end: string;
  };
  stopOnHumanClaim: boolean;
  globalOptOutKeywords: string[];
  maxMessagesPerDayPerContact: number;
  socialLinks?: {
    instagram?: string;
    facebook?: string;
    youtube?: string;
    tiktok?: string;
    linkedin?: string;
    website?: string;
  };
};

export type NurtureSocialLinks = NonNullable<NurtureJourneyDoc['socialLinks']>;

export type NurtureJourney = {
  id: string;
  name: string;
  enabled: boolean;
  doc: NurtureJourneyDoc;
  createdAt: string;
  updatedAt: string;
};

export type NurtureMetrics = {
  materialsSent: number;
  repliesReceived: number;
  handoffs: number;
  optOuts: number;
  completed: number;
  activeEnrollments: number;
};

export type NurtureEnrollment = {
  id: string;
  journeyId: string;
  contactPhone: string;
  connectionId: string;
  conversationId: string;
  status: string;
  currentStepIndex: number;
  stepEnteredAt: string;
  nextRunAt: string | null;
  enrolledAt: string;
  completedAt: string | null;
  pauseReason: string | null;
  contactName?: string | null;
};

export async function fetchNurtureJourney(opts?: {
  status?: string;
  search?: string;
}): Promise<{
  journey: NurtureJourney;
  metrics: NurtureMetrics;
  enrollments: NurtureEnrollment[];
}> {
  const qs = new URLSearchParams();
  if (opts?.status && opts.status !== 'all') qs.set('status', opts.status);
  if (opts?.search?.trim()) qs.set('search', opts.search.trim());
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const j = await apiFetchJson<{
    journey?: NurtureJourney;
    metrics?: NurtureMetrics;
    enrollments?: NurtureEnrollment[];
  }>(`/api/nurture${suffix}`);
  return {
    journey: j.journey as NurtureJourney,
    metrics: {
      materialsSent: Number(j.metrics?.materialsSent) || 0,
      repliesReceived: Number(j.metrics?.repliesReceived) || 0,
      handoffs: Number(j.metrics?.handoffs) || 0,
      optOuts: Number(j.metrics?.optOuts) || 0,
      completed: Number(j.metrics?.completed) || 0,
      activeEnrollments: Number(j.metrics?.activeEnrollments) || 0
    },
    enrollments: Array.isArray(j.enrollments) ? j.enrollments : []
  };
}

export async function saveNurtureJourney(payload: {
  journeyId: string;
  name?: string;
  enabled?: boolean;
  doc: NurtureJourneyDoc;
}): Promise<{ journey: NurtureJourney; metrics: NurtureMetrics }> {
  const j = await apiFetchJson<{ journey?: NurtureJourney; metrics?: NurtureMetrics }>('/api/nurture', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return {
    journey: j.journey as NurtureJourney,
    metrics: {
      materialsSent: Number(j.metrics?.materialsSent) || 0,
      repliesReceived: Number(j.metrics?.repliesReceived) || 0,
      handoffs: Number(j.metrics?.handoffs) || 0,
      optOuts: Number(j.metrics?.optOuts) || 0,
      completed: Number(j.metrics?.completed) || 0,
      activeEnrollments: Number(j.metrics?.activeEnrollments) || 0
    }
  };
}

export async function fetchEnrollmentByPhone(phone: string): Promise<NurtureEnrollment | null> {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  const j = await apiFetchJson<{ enrollment?: NurtureEnrollment | null }>(
    `/api/nurture/enrollment?phone=${encodeURIComponent(digits)}`
  );
  return j.enrollment ?? null;
}

export async function uploadNurtureMedia(payload: {
  dataBase64: string;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const j = await apiFetchJson<{ url?: string }>('/api/nurture/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!j.url) throw new Error('URL da mídia não retornada.');
  return j.url;
}

export async function dispatchNurtureNow(payload: {
  journeyId: string;
  enrollmentIds?: string[];
  allActive?: boolean;
}): Promise<{ queued: number; enrollments: NurtureEnrollment[] }> {
  const j = await apiFetchJson<{ queued?: number; enrollments?: NurtureEnrollment[] }>(
    '/api/nurture/dispatch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  return {
    queued: Number(j.queued) || 0,
    enrollments: Array.isArray(j.enrollments) ? j.enrollments : []
  };
}

export async function cancelNurtureEnrollment(enrollmentId: string): Promise<NurtureEnrollment[]> {
  const j = await apiFetchJson<{ enrollments?: NurtureEnrollment[] }>('/api/nurture/enrollments/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentId })
  });
  return Array.isArray(j.enrollments) ? j.enrollments : [];
}

export async function enrollContactInNurture(payload: {
  contactPhone: string;
  connectionId: string;
  conversationId?: string;
  journeyId?: string;
}): Promise<NurtureEnrollment | null> {
  const j = await apiFetchJson<{ enrollment?: NurtureEnrollment | null }>('/api/nurture/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return j.enrollment ?? null;
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  enrolled: 'Inscrito',
  active: 'Ativo',
  waiting_reply: 'Interagindo',
  paused: 'Pausado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  failed: 'Falhou'
};

export const ENROLLMENT_STATUS_COLOR: Record<string, string> = {
  enrolled: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  waiting_reply: 'bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/35',
  paused: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  completed: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/25',
  cancelled: 'bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/25',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30'
};
