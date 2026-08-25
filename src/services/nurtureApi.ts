import { apiFetchJson } from '../utils/apiFetchAuth';

export type NurtureStepOption = {
  id: string;
  tokens: string[];
  reply: string;
  handoff?: boolean;
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
};

export type NurtureJourneyDoc = {
  enabled: boolean;
  name: string;
  connectionIds: string[];
  scheduleMode: 'relative' | 'calendar';
  entryRules: {
    autoEnrollOnOptIn: boolean;
    requireMarketingOptIn: boolean;
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
};

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
};

export async function fetchNurtureJourney(): Promise<{
  journey: NurtureJourney;
  metrics: NurtureMetrics;
  enrollments: NurtureEnrollment[];
}> {
  const j = await apiFetchJson<{
    journey?: NurtureJourney;
    metrics?: NurtureMetrics;
    enrollments?: NurtureEnrollment[];
  }>('/api/nurture');
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
}): Promise<NurtureEnrollment[]> {
  const j = await apiFetchJson<{ enrollments?: NurtureEnrollment[] }>('/api/nurture/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return Array.isArray(j.enrollments) ? j.enrollments : [];
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  enrolled: 'Inscrito',
  active: 'Ativo',
  waiting_reply: 'Aguardando resposta',
  paused: 'Pausado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  failed: 'Falhou'
};
