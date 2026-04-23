import React, { useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  CheckCheck,
  Clock,
  Copy,
  Cpu,
  Gauge,
  History,
  Layers,
  MessageSquareText,
  Play,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Campaign,
  CampaignStatus,
  ConnectionStatus,
  WhatsAppConnection
} from '../../types';
import { Badge, Button, Card, Input, Tabs } from '../ui';
import {
  clearAuditLog,
  deleteTemplate,
  loadAuditLog,
  loadTemplates,
  saveTemplate
} from '../../utils/campaignMissionStorage';
import { templateToWizardDraft } from '../../utils/campaignDraft';
import type {
  CampaignAuditEntry,
  CampaignWizardDraft,
  SavedCampaignTemplate
} from '../../types/campaignMission';
import { HeatmapCalendar, fmtInt } from './CampaignVisuals';

type MissionTab = 'heatmap' | 'chips' | 'templates' | 'audit';

interface CampaignMissionControlProps {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  onOpenDetails: (id: string) => void;
  onApplyDraft: (draft: CampaignWizardDraft) => void;
  onCreate: () => void;
}

const actionTone = (action: string): { bg: string; fg: string; icon: React.ReactNode } => {
  switch (action) {
    case 'campaign_create':
      return { bg: 'rgba(16,185,129,0.14)', fg: '#059669', icon: <Plus className="w-3 h-3" /> };
    case 'campaign_delete':
      return { bg: 'rgba(239,68,68,0.14)', fg: '#dc2626', icon: <Trash2 className="w-3 h-3" /> };
    case 'campaign_pause':
      return { bg: 'rgba(245,158,11,0.14)', fg: '#d97706', icon: <Clock className="w-3 h-3" /> };
    case 'campaign_resume':
      return { bg: 'rgba(59,130,246,0.14)', fg: '#2563eb', icon: <Play className="w-3 h-3" /> };
    case 'export_csv':
      return { bg: 'rgba(139,92,246,0.14)', fg: '#7c3aed', icon: <CheckCheck className="w-3 h-3" /> };
    default:
      return { bg: 'var(--surface-2)', fg: 'var(--text-3)', icon: <Activity className="w-3 h-3" /> };
  }
};

export const CampaignMissionControl: React.FC<CampaignMissionControlProps> = ({
  campaigns,
  connections,
  onOpenDetails,
  onApplyDraft,
  onCreate
}) => {
  const [missionTab, setMissionTab] = useState<MissionTab>('heatmap');
  const [templates, setTemplates] = useState<SavedCampaignTemplate[]>(() => loadTemplates());
  const [audit, setAudit] = useState<CampaignAuditEntry[]>(() => loadAuditLog());
  const [tplName, setTplName] = useState('');

  const refreshTemplates = () => setTemplates(loadTemplates());
  const refreshAudit = () => setAudit(loadAuditLog());

  // Heatmap de campanhas criadas por dia (últimos 90 dias)
  const heatmapData = useMemo(() => {
    const map: Record<string, number> = {};
    campaigns.forEach((c) => {
      if (!c.createdAt) return;
      const key = c.createdAt.slice(0, 10);
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [campaigns]);

  const heatmapStats = useMemo(() => {
    const total = Object.values(heatmapData).reduce((a, v) => a + v, 0);
    const activeDays = Object.keys(heatmapData).length;
    const max = Math.max(0, ...Object.values(heatmapData));
    const bestDayEntry = Object.entries(heatmapData).sort((a, b) => b[1] - a[1])[0];
    const bestDay = bestDayEntry
      ? { date: bestDayEntry[0], count: bestDayEntry[1] }
      : null;
    // Streak atual (dias consecutivos com ≥1)
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (heatmapData[k]) streak++;
      else if (i > 0) break;
    }
    return { total, activeDays, max, bestDay, streak };
  }, [heatmapData]);

  // Score por chip (0-100)
  const chipScores = useMemo(() => {
    const rows = connections.map((conn) => {
      const relevant = campaigns.filter(
        (c) => Array.isArray(c.selectedConnectionIds) && c.selectedConnectionIds.includes(conn.id)
      );
      const sent = relevant.reduce((a, c) => a + (c.successCount || 0), 0);
      const failed = relevant.reduce((a, c) => a + (c.failedCount || 0), 0);
      const active = relevant.filter(
        (c) => c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.PAUSED
      ).length;
      const total = sent + failed;
      const successRate = total > 0 ? sent / total : 0;
      // Score = 50% success rate + 30% online bonus + 20% volume norm
      const online = conn.status === ConnectionStatus.CONNECTED ? 1 : 0;
      const volumeNorm = Math.min(1, sent / 2000);
      const score = Math.round((successRate * 0.5 + online * 0.3 + volumeNorm * 0.2) * 100);
      return { conn, sent, failed, active, campaigns: relevant.length, score, successRate, online };
    });
    const maxScore = Math.max(1, ...rows.map((r) => r.score));
    return rows
      .sort((a, b) => b.score - a.score)
      .map((r) => ({ ...r, normalizedBarPct: Math.round((r.score / maxScore) * 100) }));
  }, [campaigns, connections]);

  const saveQuickTemplate = () => {
    const name = tplName.trim();
    if (name.length < 2) {
      toast.error('Dê um nome ao modelo (mín. 2 caracteres).');
      return;
    }
    try {
      const raw = localStorage.getItem('zapmass:last_wizard_template_payload');
      if (!raw) {
        toast.error('Nada para salvar. Abra o assistente, preencha mensagem e use "Guardar rascunho no assistente" primeiro.');
        return;
      }
      const parsed = JSON.parse(raw) as {
        delaySeconds: number;
        campaignFlowMode: 'sequential' | 'reply';
        stages: SavedCampaignTemplate['stages'];
      };
      saveTemplate({
        name,
        delaySeconds: parsed.delaySeconds,
        campaignFlowMode: parsed.campaignFlowMode,
        stages: parsed.stages
      });
      setTplName('');
      refreshTemplates();
      toast.success('Modelo salvo.');
    } catch {
      toast.error('Não foi possível ler o rascunho. Abra Nova campanha e tente de novo.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho de contexto */}
      <div
        className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(59,130,246,0.06))',
          border: '1px solid rgba(16,185,129,0.25)'
        }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
            color: '#fff',
            boxShadow: '0 10px 24px -10px rgba(16,185,129,0.7)'
          }}
        >
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--brand-600)' }}>
            Centro de missões
          </p>
          <h2 className="ui-title text-[17px]">Planejamento, frota e histórico</h2>
          <p className="ui-subtitle text-[12.5px] mt-0.5">
            Calendário de atividade, saúde dos chips, biblioteca de modelos e auditoria local.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={onCreate} leftIcon={<Plus className="w-4 h-4" />}>
          Nova campanha
        </Button>
      </div>

      <Tabs
        value={missionTab}
        onChange={(v) => setMissionTab(v as MissionTab)}
        items={[
          { id: 'heatmap', label: 'Calendário', icon: <CalendarDays className="w-3.5 h-3.5" /> },
          { id: 'chips', label: 'Saúde dos chips', icon: <Cpu className="w-3.5 h-3.5" /> },
          { id: 'templates', label: `Modelos (${templates.length})`, icon: <Layers className="w-3.5 h-3.5" /> },
          { id: 'audit', label: 'Auditoria', icon: <History className="w-3.5 h-3.5" /> }
        ]}
      />

      {/* ──────────────────────── CALENDÁRIO ──────────────────────── */}
      {missionTab === 'heatmap' && (
        <div className="space-y-3">
          <Card>
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: 'rgba(16,185,129,0.14)',
                    border: '1px solid rgba(16,185,129,0.28)'
                  }}
                >
                  <CalendarDays className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                </div>
                <div>
                  <h3 className="ui-title text-[14.5px]">Atividade nos últimos 90 dias</h3>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    Cada quadrado = 1 dia. Mais intenso = mais campanhas criadas.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-bold flex-wrap" style={{ color: 'var(--text-3)' }}>
                <span>
                  <strong className="tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {fmtInt(heatmapStats.total)}
                  </strong>{' '}
                  campanhas
                </span>
                <span>
                  <strong className="tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {heatmapStats.activeDays}
                  </strong>{' '}
                  dias ativos
                </span>
                {heatmapStats.streak > 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
                    style={{
                      background: 'rgba(245,158,11,0.14)',
                      color: '#d97706',
                      border: '1px solid rgba(245,158,11,0.3)'
                    }}
                  >
                    🔥 <span className="tabular-nums">{heatmapStats.streak}</span> dia{heatmapStats.streak === 1 ? '' : 's'} em sequência
                  </span>
                )}
              </div>
            </div>
            <HeatmapCalendar data={heatmapData} days={90} color="#10b981" />
          </Card>

          {heatmapStats.bestDay && (
            <Card>
              <div className="flex items-center gap-3 flex-wrap">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                    color: '#fff',
                    boxShadow: '0 6px 14px -4px rgba(245,158,11,0.5)'
                  }}
                >
                  <TrendingUp className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>
                    Dia mais produtivo do período
                  </p>
                  <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                    {new Date(heatmapStats.bestDay.date + 'T12:00:00').toLocaleDateString('pt-BR', {
                      weekday: 'long',
                      day: '2-digit',
                      month: 'long'
                    })}
                  </p>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {heatmapStats.bestDay.count} campanhas criadas nesse dia
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ──────────────────────── SAÚDE DOS CHIPS ──────────────────────── */}
      {missionTab === 'chips' && (
        <Card>
          <div className="flex items-center gap-2.5 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: 'rgba(59,130,246,0.14)',
                border: '1px solid rgba(59,130,246,0.28)'
              }}
            >
              <Gauge className="w-4 h-4" style={{ color: '#2563eb' }} />
            </div>
            <div>
              <h3 className="ui-title text-[14.5px]">Score de saúde da frota</h3>
              <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                Combina taxa de sucesso (50%) + estar online (30%) + volume histórico (20%).
              </p>
            </div>
          </div>

          {connections.length === 0 ? (
            <div
              className="text-center py-10 px-4 rounded-xl"
              style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)' }}
            >
              <Cpu className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--text-3)' }} />
              <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                Nenhum chip cadastrado ainda.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {chipScores.map((row, idx) => (
                <ChipScoreCard key={row.conn.id} row={row} rank={idx + 1} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ──────────────────────── MODELOS ──────────────────────── */}
      {missionTab === 'templates' && (
        <div className="space-y-3">
          <Card>
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'rgba(139,92,246,0.14)',
                  border: '1px solid rgba(139,92,246,0.28)'
                }}
              >
                <Layers className="w-4 h-4" style={{ color: '#7c3aed' }} />
              </div>
              <div className="flex-1">
                <h3 className="ui-title text-[14.5px]">Biblioteca de modelos</h3>
                <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                  Salve sua mensagem favorita e aplique num clique.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Nome rápido (salva último rascunho do assistente)"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
              />
              <Button variant="secondary" type="button" onClick={saveQuickTemplate}>
                Salvar modelo
              </Button>
            </div>
          </Card>

          {templates.length === 0 ? (
            <Card>
              <div
                className="text-center py-8 px-4 rounded-xl"
                style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)' }}
              >
                <MessageSquareText className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--text-3)' }} />
                <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                  Você ainda não salvou nenhum modelo.
                </p>
                <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
                  Abra o assistente, escreva a mensagem e use "Guardar rascunho".
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onApply={() => {
                    onApplyDraft(templateToWizardDraft(t));
                    toast.success('Modelo carregado no assistente. Escolha o público e os chips.');
                  }}
                  onDelete={() => {
                    deleteTemplate(t.id);
                    refreshTemplates();
                    toast.success('Modelo removido.');
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────── AUDITORIA ──────────────────────── */}
      {missionTab === 'audit' && (
        <Card>
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'rgba(100,116,139,0.14)',
                  border: '1px solid rgba(100,116,139,0.28)'
                }}
              >
                <History className="w-4 h-4" style={{ color: '#475569' }} />
              </div>
              <div>
                <h3 className="ui-title text-[14.5px]">Linha do tempo de ações</h3>
                <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                  Registros deste navegador. Não substitui os logs do servidor.
                </p>
              </div>
            </div>
            {audit.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  clearAuditLog();
                  refreshAudit();
                  toast.success('Log limpo neste navegador.');
                }}
              >
                Limpar
              </Button>
            )}
          </div>

          {audit.length === 0 ? (
            <div
              className="text-center py-8 px-4 rounded-xl"
              style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)' }}
            >
              <History className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--text-3)' }} />
              <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                Sem eventos ainda. Suas ações aparecerão aqui.
              </p>
            </div>
          ) : (
            <div className="relative">
              <div
                className="absolute left-[15px] top-2 bottom-2 w-px"
                style={{ background: 'var(--border-subtle)' }}
                aria-hidden
              />
              <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {audit.slice(0, 60).map((e) => {
                  const tone = actionTone(e.action);
                  return (
                    <li
                      key={e.id}
                      className="relative pl-10 pr-3 py-2 rounded-lg transition-colors hover:bg-[var(--surface-1)]"
                    >
                      <div
                        className="absolute left-[7px] top-2.5 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{
                          background: tone.bg,
                          color: tone.fg,
                          border: `1px solid ${tone.fg}33`
                        }}
                      >
                        {tone.icon}
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className="text-[9.5px] font-mono uppercase font-bold tracking-wider"
                          style={{ color: tone.fg }}
                        >
                          {e.action.replace(/_/g, ' ')}
                        </span>
                        <span
                          className="text-[10.5px] font-mono tabular-nums"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {new Date(e.at).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-1)' }}>
                        {e.label}
                      </p>
                      {e.campaignId && (
                        <button
                          type="button"
                          onClick={() => onOpenDetails(e.campaignId!)}
                          className="text-[10.5px] font-bold mt-0.5 transition-colors hover:underline"
                          style={{ color: 'var(--brand-600)' }}
                        >
                          Abrir campanha →
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ─── Chip Score Card ───
const ChipScoreCard: React.FC<{
  row: {
    conn: WhatsAppConnection;
    sent: number;
    failed: number;
    active: number;
    campaigns: number;
    score: number;
    normalizedBarPct: number;
    online: number;
  };
  rank: number;
}> = ({ row, rank }) => {
  const { conn, sent, failed, active, campaigns: cc, score, normalizedBarPct } = row;
  const tone =
    score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
  const scoreLabel =
    score >= 80 ? 'Excelente' : score >= 60 ? 'Saudável' : score >= 40 ? 'Atenção' : 'Crítico';

  return (
    <div
      className="rounded-xl p-3 relative overflow-hidden"
      style={{
        background: 'var(--surface-0)',
        border: `1px solid ${tone}33`
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{ background: `radial-gradient(180px 80px at 100% 0%, ${tone}22, transparent 70%)` }}
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white font-black text-[13px] tabular-nums"
              style={{
                background: `linear-gradient(135deg, ${tone}, ${tone}cc)`,
                boxShadow: `0 4px 10px -3px ${tone}80`
              }}
            >
              #{rank}
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                {conn.name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge
                  variant={conn.status === ConnectionStatus.CONNECTED ? 'success' : 'warning'}
                  dot={conn.status === ConnectionStatus.CONNECTED}
                >
                  {conn.status === ConnectionStatus.CONNECTED ? 'Online' : 'Offline'}
                </Badge>
                <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  {scoreLabel}
                </span>
              </div>
            </div>
          </div>
          <div
            className="text-[22px] font-black tabular-nums leading-none shrink-0"
            style={{ color: tone }}
          >
            {score}
            <span className="text-[11px] opacity-60">/100</span>
          </div>
        </div>

        {/* Barra de score */}
        <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${normalizedBarPct}%`,
              background: `linear-gradient(90deg, ${tone}, ${tone}cc)`
            }}
          />
        </div>

        {/* Mini estatísticas */}
        <div className="grid grid-cols-4 gap-1.5 text-center">
          <MiniStat label="Envios" value={fmtInt(sent)} tone="#059669" />
          <MiniStat label="Falhas" value={fmtInt(failed)} tone="#dc2626" />
          <MiniStat label="Camp." value={String(cc)} tone="#2563eb" />
          <MiniStat label="Ativas" value={String(active)} tone="#d97706" />
        </div>
      </div>
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: string; tone: string }> = ({
  label,
  value,
  tone
}) => (
  <div
    className="rounded-md py-1"
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <p className="text-[13px] font-black tabular-nums leading-none" style={{ color: tone }}>
      {value}
    </p>
    <p
      className="text-[9px] font-bold uppercase tracking-wider leading-none mt-0.5"
      style={{ color: 'var(--text-3)' }}
    >
      {label}
    </p>
  </div>
);

// ─── Template Card ───
const TemplateCard: React.FC<{
  template: SavedCampaignTemplate;
  onApply: () => void;
  onDelete: () => void;
}> = ({ template, onApply, onDelete }) => {
  const preview = template.stages?.[0]?.body || 'Sem conteúdo';
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2.5 transition-all hover:shadow-md"
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'rgba(139,92,246,0.14)',
              color: '#7c3aed',
              border: '1px solid rgba(139,92,246,0.25)'
            }}
          >
            <MessageSquareText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
              {template.name}
            </p>
            <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
              {template.stages.length} etapa{template.stages.length === 1 ? '' : 's'} · {template.campaignFlowMode === 'reply' ? 'Reply flow' : 'Sequencial'} ·{' '}
              intervalo {template.delaySeconds}s
            </p>
          </div>
        </div>
      </div>
      <div
        className="text-[11.5px] leading-snug p-2 rounded-lg line-clamp-3"
        style={{
          background: 'var(--surface-1)',
          color: 'var(--text-2)',
          border: '1px solid var(--border-subtle)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
      >
        {preview}
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--text-3)' }}>
        <span>Atualizado {new Date(template.updatedAt).toLocaleDateString('pt-BR')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onApply}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors"
            style={{
              background: 'var(--brand-500)',
              color: '#fff'
            }}
            title="Usar no assistente"
          >
            <Copy className="w-3 h-3" />
            Usar
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: 'var(--danger)' }}
            title="Remover"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
