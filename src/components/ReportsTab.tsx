import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCheck,
  Clock,
  Download,
  Eye,
  Flame,
  MessageSquare,
  PieChart,
  Reply,
  Send,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Trophy
} from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';
import { Badge, Button, Card, EmptyState, SectionHeader, Tabs } from './ui';
import type { Campaign } from '../types';

type PeriodFilter = '7d' | '30d' | '90d';

const PERIOD_DAYS: Record<PeriodFilter, number> = { '7d': 7, '30d': 30, '90d': 90 };
const PERIOD_LABEL: Record<PeriodFilter, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '3 meses' };

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Formata um número compacto (1234 → "1,2k")
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'k';
  return n.toLocaleString('pt-BR');
}

function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 100);
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function deltaBadge(current: number, previous: number) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { label: 'novo', variant: 'success' as const, up: true };
  const diff = current - previous;
  const pctChange = Math.round((diff / previous) * 100);
  if (pctChange === 0) return null;
  return {
    label: `${pctChange > 0 ? '+' : ''}${pctChange}%`,
    variant: pctChange > 0 ? ('success' as const) : ('danger' as const),
    up: pctChange > 0
  };
}

export const ReportsTab: React.FC = () => {
  const { campaigns, connections, conversations, funnelStats } = useZapMass();
  const [period, setPeriod] = useState<PeriodFilter>('30d');

  const { current, previous, rangeDays } = useMemo(() => {
    const days = PERIOD_DAYS[period];
    const now = Date.now();
    const startCurrent = now - days * 86_400_000;
    const startPrevious = startCurrent - days * 86_400_000;

    const inRange = (c: Campaign, start: number, end: number) => {
      if (!c.createdAt) return false;
      const t = new Date(c.createdAt).getTime();
      return t >= start && t < end;
    };

    return {
      current: campaigns.filter((c) => inRange(c, startCurrent, now)),
      previous: campaigns.filter((c) => inRange(c, startPrevious, startCurrent)),
      rangeDays: days
    };
  }, [campaigns, period]);

  // Totais agregados por período
  const sumField = (list: Campaign[], key: 'totalContacts' | 'successCount' | 'failedCount') =>
    list.reduce((acc, c) => acc + (c[key] || 0), 0);

  const totalSent = sumField(current, 'totalContacts');
  const totalSuccess = sumField(current, 'successCount');
  const totalFailed = sumField(current, 'failedCount');

  const prevSent = sumField(previous, 'totalContacts');
  const prevSuccess = sumField(previous, 'successCount');

  const healthRate = pct(totalSuccess, totalSent);
  const prevHealthRate = pct(prevSuccess, prevSent);

  // Funil real vem do servidor (funnelStats é cumulativo, então mostramos proporção)
  const funnel = {
    sent: funnelStats.totalSent || totalSuccess,
    delivered: funnelStats.totalDelivered || 0,
    read: funnelStats.totalRead || 0,
    replied: funnelStats.totalReplied || 0
  };
  const readRate = pct(funnel.read, funnel.delivered || funnel.sent);
  const replyRate = pct(funnel.replied, funnel.read || funnel.delivered || funnel.sent);

  // Volume diário ordenado corretamente
  const dailySeries = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, 0);
    }
    current.forEach((c) => {
      if (!c.createdAt) return;
      const d = new Date(c.createdAt);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      if (map.has(key)) map.set(key, (map.get(key) || 0) + (c.totalContacts || 0));
    });
    return Array.from(map.entries()).map(([day, sent]) => ({ day, sent }));
  }, [current, rangeDays]);

  const maxDaily = Math.max(1, ...dailySeries.map((d) => d.sent));
  const avgDaily = dailySeries.length
    ? Math.round(dailySeries.reduce((a, b) => a + b.sent, 0) / dailySeries.length)
    : 0;
  const bestDay = dailySeries.reduce((best, d) => (d.sent > best.sent ? d : best), dailySeries[0] || { day: '—', sent: 0 });

  // Heatmap hora × dia-da-semana a partir das conversas (mensagens enviadas por campanha)
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const cutoff = Date.now() - rangeDays * 86_400_000;
    let total = 0;
    conversations.forEach((conv) => {
      conv.messages?.forEach((msg) => {
        const ts = msg.timestampMs || (msg.timestamp ? new Date(msg.timestamp).getTime() : 0);
        if (!ts || ts < cutoff) return;
        if (msg.sender !== 'me') return; // só envios nossos
        const d = new Date(ts);
        grid[d.getDay()][d.getHours()] += 1;
        total += 1;
      });
    });
    const max = Math.max(1, ...grid.flat());
    return { grid, max, total };
  }, [conversations, rangeDays]);

  // Best hour insight
  const bestHourInsight = useMemo(() => {
    const byHour = Array(24).fill(0);
    heatmap.grid.forEach((row) => row.forEach((v, h) => (byHour[h] += v)));
    const max = Math.max(...byHour);
    if (max === 0) return null;
    const hour = byHour.indexOf(max);
    return { hour, count: max };
  }, [heatmap]);

  // Top canais — correção: pega successCount/failedCount direto, não dividido
  const channelStats = useMemo(() => {
    const byChannel = new Map<string, { name: string; sent: number; success: number; failed: number; campaigns: number }>();
    current.forEach((campaign) => {
      const ids = campaign.selectedConnectionIds?.length ? campaign.selectedConnectionIds : ['unassigned'];
      const shareTotal = campaign.totalContacts ? campaign.totalContacts / ids.length : 0;
      const shareSuccess = campaign.successCount ? campaign.successCount / ids.length : 0;
      const shareFailed = campaign.failedCount ? campaign.failedCount / ids.length : 0;
      ids.forEach((connId) => {
        const ref = byChannel.get(connId) || { name: '', sent: 0, success: 0, failed: 0, campaigns: 0 };
        ref.name = connections.find((c) => c.id === connId)?.name || (connId === 'unassigned' ? 'Sem canal vinculado' : connId);
        ref.sent += shareTotal;
        ref.success += shareSuccess;
        ref.failed += shareFailed;
        ref.campaigns += 1;
        byChannel.set(connId, ref);
      });
    });
    return Array.from(byChannel.entries())
      .map(([id, s]) => ({
        id,
        name: s.name,
        sent: Math.round(s.sent),
        success: Math.round(s.success),
        failed: Math.round(s.failed),
        campaigns: s.campaigns,
        efficiency: pct(Math.round(s.success), Math.round(s.sent))
      }))
      .sort((a, b) => b.sent - a.sent);
  }, [current, connections]);

  // Top campanhas no período (top 5 por volume)
  const topCampaigns = useMemo(() => {
    return [...current]
      .sort((a, b) => (b.totalContacts || 0) - (a.totalContacts || 0))
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        name: c.name,
        total: c.totalContacts || 0,
        success: c.successCount || 0,
        failed: c.failedCount || 0,
        rate: pct(c.successCount || 0, c.totalContacts || 0),
        createdAt: c.createdAt
      }));
  }, [current]);

  const deltaVol = deltaBadge(totalSent, prevSent);
  const deltaHealth = deltaBadge(healthRate, prevHealthRate);

  const handleDownloadCSV = () => {
    const rows: Array<Array<string | number>> = [
      ['Campanha', 'Data', 'Total', 'Sucesso', 'Falhas', 'Taxa (%)'],
      ...current.map((c) => [
        c.name,
        c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '',
        c.totalContacts,
        c.successCount,
        c.failedCount,
        pct(c.successCount || 0, c.totalContacts || 0)
      ])
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_zapmass_${period}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 pb-10">
      <SectionHeader
        eyebrow={<><PieChart className="w-3 h-3" />Relatórios</>}
        title="Relatórios analíticos"
        description={`Últimos ${PERIOD_LABEL[period]} · comparado ao período anterior.`}
        icon={<BarChart3 className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        actions={
          <>
            <Tabs
              value={period}
              onChange={(v) => setPeriod(v as PeriodFilter)}
              items={[
                { id: '7d', label: '7 dias' },
                { id: '30d', label: '30 dias' },
                { id: '90d', label: '3 meses' }
              ]}
            />
            <Button variant="primary" leftIcon={<Download className="w-4 h-4" />} onClick={handleDownloadCSV}>
              Exportar CSV
            </Button>
          </>
        }
      />

      {/* KPI row com comparativo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Mensagens enviadas"
          value={fmt(totalSent)}
          icon={<Send className="w-4 h-4" />}
          accent="brand"
          delta={deltaVol}
          helper={`Média de ${avgDaily}/dia`}
        />
        <KpiCard
          label="Taxa de sucesso"
          value={`${healthRate}%`}
          icon={<CheckCheck className="w-4 h-4" />}
          accent={healthRate >= 85 ? 'success' : healthRate >= 60 ? 'warning' : 'danger'}
          delta={deltaHealth}
          helper={`${fmt(totalSuccess)} entregues`}
        />
        <KpiCard
          label="Taxa de leitura"
          value={`${readRate}%`}
          icon={<Eye className="w-4 h-4" />}
          accent="info"
          helper={`${fmt(funnel.read)} lidas`}
        />
        <KpiCard
          label="Taxa de resposta"
          value={`${replyRate}%`}
          icon={<Reply className="w-4 h-4" />}
          accent={replyRate >= 10 ? 'success' : 'warning'}
          helper={`${fmt(funnel.replied)} respostas`}
        />
      </div>

      {/* Funil + Insights lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
              <h3 className="ui-title text-[14px]">Funil de desempenho</h3>
            </div>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Acumulado (desde o início)</span>
          </div>
          <FunnelBars
            steps={[
              { label: 'Enviadas', value: funnel.sent, icon: <Send className="w-3.5 h-3.5" />, color: 'var(--brand-600)' },
              { label: 'Entregues', value: funnel.delivered, icon: <CheckCheck className="w-3.5 h-3.5" />, color: '#3b82f6' },
              { label: 'Lidas', value: funnel.read, icon: <Eye className="w-3.5 h-3.5" />, color: '#8b5cf6' },
              { label: 'Respostas', value: funnel.replied, icon: <Reply className="w-3.5 h-3.5" />, color: '#f59e0b' }
            ]}
          />
        </Card>

        <Card className="p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
            <h3 className="ui-title text-[14px]">Insights automáticos</h3>
          </div>
          <InsightRow
            icon={<Trophy className="w-4 h-4" style={{ color: '#f59e0b' }} />}
            label="Melhor dia"
            value={bestDay?.sent ? new Date(bestDay.day).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'}
            helper={bestDay?.sent ? `${fmt(bestDay.sent)} envios` : 'Sem dados'}
          />
          <InsightRow
            icon={<Clock className="w-4 h-4" style={{ color: '#3b82f6' }} />}
            label="Melhor horário"
            value={bestHourInsight ? `${String(bestHourInsight.hour).padStart(2, '0')}:00` : '—'}
            helper={bestHourInsight ? `${fmt(bestHourInsight.count)} mensagens` : 'Sem histórico'}
          />
          <InsightRow
            icon={<Flame className="w-4 h-4" style={{ color: '#ef4444' }} />}
            label="Campanha TOP"
            value={topCampaigns[0]?.name || '—'}
            helper={topCampaigns[0] ? `${fmt(topCampaigns[0].total)} contatos · ${topCampaigns[0].rate}%` : 'Nenhuma ainda'}
            truncate
          />
          <InsightRow
            icon={<Smartphone className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />}
            label="Canal mais ativo"
            value={channelStats[0]?.name || '—'}
            helper={channelStats[0] ? `${fmt(channelStats[0].sent)} envios · ${channelStats[0].efficiency}%` : 'Sem dados'}
            truncate
          />
          <InsightRow
            icon={<MessageSquare className="w-4 h-4" style={{ color: '#8b5cf6' }} />}
            label="Falhas no período"
            value={fmt(totalFailed)}
            helper={totalSent ? `${pct(totalFailed, totalSent)}% do total` : 'Zero envios'}
          />
        </Card>
      </div>

      {/* Volume diário */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
            <h3 className="ui-title text-[14px]">Volume diário de disparos</h3>
          </div>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
            <span>Pico: <strong style={{ color: 'var(--text-1)' }}>{fmt(maxDaily)}</strong></span>
            <span>·</span>
            <span>Média: <strong style={{ color: 'var(--text-1)' }}>{fmt(avgDaily)}</strong></span>
          </div>
        </div>
        {dailySeries.every((d) => d.sent === 0) ? (
          <EmptyState
            icon={<BarChart3 className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
            title="Sem disparos no período"
            description="Os gráficos aparecem assim que você criar uma campanha."
          />
        ) : (
          <DailyBars data={dailySeries} max={maxDaily} />
        )}
      </Card>

      {/* Heatmap hora × dia */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
            <h3 className="ui-title text-[14px]">Atividade por hora da semana</h3>
          </div>
          <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            Mostra quando as suas mensagens saem — útil pra encontrar a melhor janela.
          </p>
        </div>
        {heatmap.total === 0 ? (
          <EmptyState
            icon={<Clock className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
            title="Sem envios recentes"
            description="Dispare algumas mensagens pra desbloquear o mapa de calor."
          />
        ) : (
          <Heatmap grid={heatmap.grid} max={heatmap.max} />
        )}
      </Card>

      {/* Top canais */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
            <h3 className="ui-title text-[14px]">Desempenho por canal</h3>
          </div>
          <Badge variant="neutral">{channelStats.length} canais</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left min-w-[640px]">
            <thead style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
              <tr>
                {['Canal', 'Campanhas', 'Envios', 'Falhas', 'Eficiência'].map((h) => (
                  <th key={h} className="px-5 py-3 font-bold text-[10.5px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channelStats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                    Sem campanhas para calcular desempenho por canal.
                  </td>
                </tr>
              )}
              {channelStats.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-[var(--surface-1)]"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Smartphone className="w-4 h-4 shrink-0" style={{ color: 'var(--text-3)' }} />
                      <span className="font-semibold truncate" style={{ color: 'var(--text-1)' }}>{c.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 tabular-nums" style={{ color: 'var(--text-2)' }}>{c.campaigns}</td>
                  <td className="px-5 py-3.5 tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>{fmt(c.sent)}</td>
                  <td className="px-5 py-3.5 tabular-nums font-semibold" style={{ color: '#ef4444' }}>{fmt(c.failed)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden max-w-[140px]" style={{ background: 'var(--surface-2)' }}>
                        <div className="h-full rounded-full transition-all"
                          style={{
                            width: `${c.efficiency}%`,
                            background: c.efficiency > 85 ? 'var(--brand-500)' : c.efficiency > 60 ? '#f59e0b' : '#ef4444'
                          }} />
                      </div>
                      <span className="text-[12px] font-bold tabular-nums w-10"
                        style={{ color: c.efficiency > 85 ? 'var(--brand-600)' : c.efficiency > 60 ? '#f59e0b' : '#ef4444' }}>
                        {c.efficiency}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Top campanhas */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4" style={{ color: '#f59e0b' }} />
            <h3 className="ui-title text-[14px]">Top campanhas do período</h3>
          </div>
          <Badge variant="neutral">{current.length} no total</Badge>
        </div>
        {topCampaigns.length === 0 ? (
          <EmptyState
            icon={<Trophy className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
            title="Nenhuma campanha no período"
            description="Crie uma nova campanha para aparecer aqui."
          />
        ) : (
          <div className="space-y-2.5">
            {topCampaigns.map((c, idx) => (
              <div key={c.id}
                className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-[var(--surface-1)]"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[13px] shrink-0"
                  style={{
                    background: idx === 0 ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'var(--surface-2)',
                    color: idx === 0 ? '#fff' : 'var(--text-2)'
                  }}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>{c.name}</p>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'} · {fmt(c.total)} contatos
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-[14px] tabular-nums"
                    style={{ color: c.rate >= 85 ? 'var(--brand-600)' : c.rate >= 60 ? '#f59e0b' : '#ef4444' }}>
                    {c.rate}%
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>taxa de sucesso</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

// --- SUBCOMPONENTES ---

interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: 'brand' | 'success' | 'warning' | 'danger' | 'info';
  helper?: string;
  delta?: { label: string; variant: 'success' | 'danger'; up: boolean } | null;
}

const ACCENT_BG: Record<KpiCardProps['accent'], string> = {
  brand: 'var(--brand-50)',
  success: 'rgba(16,185,129,0.12)',
  warning: 'rgba(245,158,11,0.12)',
  danger: 'rgba(239,68,68,0.12)',
  info: 'rgba(59,130,246,0.12)'
};
const ACCENT_FG: Record<KpiCardProps['accent'], string> = {
  brand: 'var(--brand-600)',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6'
};

const KpiCard: React.FC<KpiCardProps> = ({ label, value, icon, accent, helper, delta }) => (
  <div className="rounded-2xl p-4 flex flex-col gap-2"
    style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}>
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</span>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center"
        style={{ background: ACCENT_BG[accent], color: ACCENT_FG[accent] }}>
        {icon}
      </div>
    </div>
    <div className="flex items-baseline gap-2">
      <span className="text-[26px] font-extrabold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>{value}</span>
      {delta && (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md ${delta.variant === 'success' ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' : 'text-red-600 bg-red-50 dark:bg-red-500/10'}`}>
          {delta.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {delta.label}
        </span>
      )}
    </div>
    {helper && (
      <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{helper}</span>
    )}
  </div>
);

interface FunnelStep { label: string; value: number; icon: React.ReactNode; color: string; }
const FunnelBars: React.FC<{ steps: FunnelStep[] }> = ({ steps }) => {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-3">
      {steps.map((step, idx) => {
        const width = Math.max(6, Math.round((step.value / max) * 100));
        const prevValue = idx > 0 ? steps[idx - 1].value : step.value;
        const dropPct = idx > 0 && prevValue > 0 ? Math.round(((prevValue - step.value) / prevValue) * 100) : 0;
        return (
          <div key={step.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                <span style={{ color: step.color }}>{step.icon}</span>
                {step.label}
              </span>
              <span className="flex items-center gap-2 text-[12px]">
                <span className="font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(step.value)}</span>
                {idx > 0 && dropPct > 0 && (
                  <span className="text-[10.5px] font-semibold" style={{ color: 'var(--text-3)' }}>
                    −{dropPct}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${width}%`, background: `linear-gradient(90deg, ${step.color}, color-mix(in srgb, ${step.color} 70%, #ffffff))` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const InsightRow: React.FC<{ icon: React.ReactNode; label: string; value: string; helper: string; truncate?: boolean }> = ({ icon, label, value, helper, truncate }) => (
  <div className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--surface-1)' }}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[11px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className={`text-[13px] font-bold ${truncate ? 'truncate' : ''}`} style={{ color: 'var(--text-1)' }}>{value}</p>
    </div>
    <p className="text-[11px] text-right" style={{ color: 'var(--text-3)' }}>{helper}</p>
  </div>
);

const DailyBars: React.FC<{ data: Array<{ day: string; sent: number }>; max: number }> = ({ data, max }) => {
  // Mostra até 30 dias de forma compacta; se mais, agrupa em janelas de 2-3 dias visualmente
  const compact = data.length > 30;
  const items = compact ? data.filter((_, i) => i % Math.ceil(data.length / 30) === 0) : data;
  return (
    <div className="relative">
      <div className="h-48 flex items-end gap-1">
        {items.map((d, i) => {
          const h = Math.max(4, Math.round((d.sent / max) * 100));
          const label = new Date(d.day).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div className="w-full rounded-t-md transition-all duration-300 group-hover:opacity-80"
                style={{
                  height: `${h}%`,
                  minHeight: 4,
                  background: d.sent > 0
                    ? 'linear-gradient(180deg, var(--brand-500), var(--brand-700))'
                    : 'var(--surface-2)'
                }} />
              <div className="absolute bottom-full mb-1 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap px-2 py-1 rounded-md text-[10.5px] font-semibold"
                style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-1)' }}>
                {label} · <strong>{fmt(d.sent)}</strong>
              </div>
              {(i === 0 || i === items.length - 1 || i % Math.ceil(items.length / 6) === 0) && (
                <span className="text-[9.5px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {new Date(d.day).getDate()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Heatmap: React.FC<{ grid: number[][]; max: number }> = ({ grid, max }) => {
  const cellColor = (v: number) => {
    if (v === 0) return 'var(--surface-2)';
    const ratio = v / max;
    // Gradiente: bem claro → brand forte
    const alpha = 0.15 + ratio * 0.85;
    return `color-mix(in srgb, var(--brand-500) ${Math.round(alpha * 100)}%, transparent)`;
  };
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Header com horas (0-23) */}
        <div className="flex items-center gap-1 mb-1 pl-10">
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="flex-1 text-center text-[9px] tabular-nums" style={{ color: 'var(--text-3)' }}>
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {grid.map((row, d) => (
          <div key={d} className="flex items-center gap-1 mb-1">
            <div className="w-8 text-[10.5px] font-semibold text-right pr-2" style={{ color: 'var(--text-3)' }}>
              {DAY_LABELS[d]}
            </div>
            {row.map((v, h) => (
              <div
                key={h}
                title={`${DAY_LABELS[d]} ${String(h).padStart(2, '0')}:00 · ${v} mensagens`}
                className="flex-1 aspect-square rounded-sm cursor-help transition-transform hover:scale-110"
                style={{ background: cellColor(v), minHeight: 18 }}
              />
            ))}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-3 pl-10">
          <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>Menos</span>
          {[0.1, 0.3, 0.5, 0.7, 1].map((r) => (
            <div key={r} className="w-5 h-3 rounded-sm"
              style={{ background: r === 0.1 ? 'var(--surface-2)' : `color-mix(in srgb, var(--brand-500) ${Math.round(r * 100)}%, transparent)` }} />
          ))}
          <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>Mais</span>
          <span className="ml-auto flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
            <TrendingUp className="w-3 h-3" />
            Pico: <strong style={{ color: 'var(--text-1)' }}>{max}</strong> por hora
          </span>
        </div>
      </div>
    </div>
  );
};
