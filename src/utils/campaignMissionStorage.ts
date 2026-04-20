import type { CampaignAuditEntry, SavedCampaignTemplate } from '../types/campaignMission';

const TEMPLATES_KEY = 'zapmass_campaign_templates_v1';
const AUDIT_KEY = 'zapmass_campaign_audit_v1';
const MAX_AUDIT = 200;

const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function loadTemplates(): SavedCampaignTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTemplate(t: Omit<SavedCampaignTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): SavedCampaignTemplate {
  const list = loadTemplates();
  const now = new Date().toISOString();
  const full: SavedCampaignTemplate = {
    id: t.id || uid(),
    name: t.name.trim(),
    createdAt: t.id ? list.find((x) => x.id === t.id)?.createdAt || now : now,
    updatedAt: now,
    delaySeconds: t.delaySeconds,
    campaignFlowMode: t.campaignFlowMode,
    stages: t.stages,
    replyFlowSnapshot: t.replyFlowSnapshot
  };
  const next = t.id ? list.map((x) => (x.id === t.id ? full : x)) : [...list, full];
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next));
  return full;
}

export function deleteTemplate(id: string): void {
  const list = loadTemplates().filter((x) => x.id !== id);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
}

export function loadAuditLog(): CampaignAuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendAudit(entry: Omit<CampaignAuditEntry, 'id' | 'at'>): CampaignAuditEntry {
  const full: CampaignAuditEntry = {
    id: uid(),
    at: new Date().toISOString(),
    ...entry
  };
  const prev = loadAuditLog();
  const next = [full, ...prev].slice(0, MAX_AUDIT);
  localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
  return full;
}

export function clearAuditLog(): void {
  localStorage.removeItem(AUDIT_KEY);
}
