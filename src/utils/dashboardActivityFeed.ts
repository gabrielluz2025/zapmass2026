import type { Campaign } from '../types';
import { CampaignStatus } from '../types';
import type { SystemLog } from '../types';
import { campaignStatusLabel, formatCampaignWhen } from './dashboardCampaignInsights';

export type DashboardActivityItem = {
  id: string;
  title: string;
  sub: string;
  ts: string;
  tone: 'default' | 'warn' | 'err' | 'success';
};

const NOISE_PREFIXES = ['socket:', 'sync:', 'debug:', 'ping', 'pong'];

export function isNoiseSystemLog(log: SystemLog): boolean {
  const ev = (log.event || '').toLowerCase();
  if (!ev) return true;
  if (NOISE_PREFIXES.some((p) => ev.startsWith(p))) return true;
  if (ev === 'system' && !String((log.payload as { message?: string })?.message || '').trim()) return true;
  return false;
}

export function formatDashboardActivity(log: SystemLog): Omit<DashboardActivityItem, 'id' | 'ts'> {
  const p = (log.payload || {}) as { message?: string; error?: string; campaignId?: string };
  const msg = String(p.message || p.error || '').trim();
  const ev = (log.event || '').toLowerCase();

  if (ev.includes('campaign:error') || ev.endsWith(':error')) {
    return { title: 'Erro na campanha', sub: msg || 'Algo falhou no envio.', tone: 'err' };
  }
  if (ev.includes('campaign:warn') || ev.endsWith(':warn')) {
    return { title: 'Aviso na campanha', sub: msg || 'Verifique a campanha.', tone: 'warn' };
  }
  if (ev.startsWith('scheduled:')) {
    return { title: 'Agendamento', sub: msg || 'Campanha agendada atualizada.', tone: 'warn' };
  }
  if (ev.includes('campaign') || p.campaignId) {
    if (msg.toLowerCase().includes('enviada') || msg.toLowerCase().includes('enviado')) {
      return { title: 'Mensagem enviada', sub: msg || 'Campanha em andamento.', tone: 'success' };
    }
    return { title: 'Campanha', sub: msg || 'Atualização da campanha.', tone: 'default' };
  }
  if (msg) return { title: 'Sistema', sub: msg, tone: 'default' };
  return { title: 'Sistema', sub: 'Atualização registrada.', tone: 'default' };
}

/** Atividade derivada das campanhas quando não há logs úteis. */
export function buildCampaignActivityHints(campaigns: Campaign[]): DashboardActivityItem[] {
  const out: DashboardActivityItem[] = [];
  const sorted = [...campaigns].sort((a, b) => {
    const ta = new Date(a.lastRunAt || a.createdAt || 0).getTime();
    const tb = new Date(b.lastRunAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  for (const c of sorted) {
    if (out.length >= 4) break;
    const when = formatCampaignWhen(c);
    const ts = c.lastRunAt || c.createdAt || new Date().toISOString();
    if (c.status === CampaignStatus.RUNNING) {
      out.push({
        id: `run-${c.id}`,
        title: 'Campanha em disparo',
        sub: `${c.name} · ${(c.successCount || 0).toLocaleString('pt-BR')} enviadas`,
        ts,
        tone: 'success'
      });
      continue;
    }
    if (c.status === CampaignStatus.COMPLETED && (c.successCount || 0) > 0) {
      out.push({
        id: `done-${c.id}`,
        title: 'Campanha concluída',
        sub: `${c.name} · ${(c.successCount || 0).toLocaleString('pt-BR')} mensagens${when ? ` · ${when}` : ''}`,
        ts,
        tone: 'default'
      });
      continue;
    }
    if (c.status === CampaignStatus.SCHEDULED && c.nextRunAt) {
      out.push({
        id: `sched-${c.id}`,
        title: 'Disparo agendado',
        sub: `${c.name} · ${new Date(c.nextRunAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        ts: c.nextRunAt,
        tone: 'warn'
      });
    }
  }
  return out;
}

export function buildDashboardActivityFeed(
  systemLogs: SystemLog[],
  campaigns: Campaign[],
  limit = 6
): DashboardActivityItem[] {
  const fromLogs: DashboardActivityItem[] = systemLogs
    .filter((log) => !isNoiseSystemLog(log))
    .map((log, i) => ({
      id: `log-${log.timestamp}-${i}`,
      ts: log.timestamp,
      ...formatDashboardActivity(log)
    }));

  const merged = [...fromLogs];
  if (merged.length < 3) {
    const hints = buildCampaignActivityHints(campaigns);
    for (const h of hints) {
      if (merged.some((m) => m.id === h.id)) continue;
      merged.push(h);
    }
  }

  return merged
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit);
}

export function qualityScoreLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Excelente', color: '#10b981' };
  if (score >= 70) return { label: 'Boa', color: '#3b82f6' };
  if (score >= 50) return { label: 'Regular', color: '#f59e0b' };
  return { label: 'Precisa melhorar', color: '#f43f5e' };
}
