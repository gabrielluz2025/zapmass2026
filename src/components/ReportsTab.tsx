import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  CheckCheck,
  ChevronDown,
  Clock,
  Download,
  Eye,
  FileText,
  Flame,
  MessageSquare,
  Reply,
  Search,
  Send,
  Smartphone,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import { useZapMassCore, useZapMassConversations } from '../context/ZapMassContext';
import { Badge, Button, PageShell } from './ui';
import { PerformanceFunnel } from './PerformanceFunnel';
import type { Campaign } from '../types';
import { getCampaignDeliverySuccessRatePct, getCampaignPlannedSendTotal } from '../utils/campaignMetrics';
import { ClientAttendanceFeedbackSection } from './reports/ClientAttendanceFeedbackSection';
import { CampaignFailuresPanel } from './tenant/CampaignFailuresPanel';
import { printReportsPdf } from '../utils/reportsPdfExport';

/* ─── tipos e constantes ─────────────────────────────────────── */
type PeriodFilter = '7d' | '30d' | '90d';
type ReportTab = 'overview' | 'campanhas' | 'canais' | 'heatmap';

const PERIOD_DAYS: Record<PeriodFilter, number> = { '7d': 7, '30d': 30, '90d': 90 };
const PERIOD_LABEL: Record<PeriodFilter, string> = { '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 3 meses' };
const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);

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
  if (previous === 0) return { label: 'novo', up: true };
  const diff = current - previous;
  const pctChange = Math.round((diff / previous) * 100);
  if (pctChange === 0) return null;
  return { label: `${pctChange > 0 ? '+' : ''}${pctChange}%`, up: pctChange > 0 };
}

/* ─── componente principal ───────────────────────────────────── */
export const ReportsTab: React.FC = () => {
  const conversations = useZapMassConversations();
  const deferredConversations = useDeferredValue(conversations);
  const { campaigns, connections, funnelStats } = useZapMassCore();
  const [period, setPeriod] = useState<PeriodFilter>('30d');
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignSort, setCampaignSort] = useState<'date' | 'total' | 'rate'>('date');

  /* ── dados filtrados por período ── */
  const { current, previous, rangeDays } = useMemo(() => {
    const days = PERIOD_DAYS[period];
    const now = Date.now();
    const startCurrent = now - days * 86_400_000;
    const startPrevious = startCurrent - days * 86_400_000;
    const inRange = (c: Campaign, s: number, e: number) => {
      if (!c.createdAt) return false;
      const t = new Date(c.createdAt).getTime();
      return t >= s && t < e;
    };
    return {
      current: campaigns.filter((c) => inRange(c, startCurrent, now)),
      previous: campaigns.filter((c) => inRange(c, startPrevious, startCurrent)),
      rangeDays: days,
    };
  }, [campaigns, period]);

  const sumF = (list: Campaign[], key: 'totalContacts' | 'successCount' | 'failedCount') =>
    list.reduce((a, c) => a + (c[key] || 0), 0);

  const totalTargeted = sumF(current, 'totalContacts');
  const totalSuccess  = sumF(current, 'successCount');
  const totalFailed   = sumF(current, 'failedCount');
  const prevSuccess   = sumF(previous, 'successCount');

  const plannedCur  = current.reduce((a, c) => a + getCampaignPlannedSendTotal(c), 0);
  const plannedPrev = previous.reduce((a, c) => a + getCampaignPlannedSendTotal(c), 0);
  const healthRate  = plannedCur  > 0 ? Math.min(100, Math.round((totalSuccess / plannedCur)  * 100)) : 0;
  const prevHealth  = plannedPrev > 0 ? Math.min(100, Math.round((prevSuccess  / plannedPrev) * 100)) : 0;

  const funnel = (() => {
    const sent     = Math.max(0, funnelStats.totalSent || totalSuccess || 0);
    const replied  = Math.max(0, funnelStats.totalReplied || 0);
    const read     = Math.max(funnelStats.totalRead || 0, replied);
    const delivered = Math.max(funnelStats.totalDelivered || 0, read);
    const cap = (n: number) => sent > 0 ? Math.min(sent, n) : n;
    return { sent, delivered: cap(delivered), read: cap(read), replied: cap(replied) };
  })();
  const readRate  = pct(funnel.read, funnel.delivered || funnel.sent);
  const replyRate = pct(funnel.replied, funnel.read || funnel.delivered || funnel.sent);

  /* ── série diária ── */
  const dailySeries = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
      map.set(d.toISOString().slice(0, 10), 0);
    }
    current.forEach((c) => {
      if (!c.createdAt) return;
      const d = new Date(c.createdAt); d.setHours(0,0,0,0);
      const k = d.toISOString().slice(0, 10);
      if (map.has(k)) map.set(k, (map.get(k) || 0) + (c.successCount || 0));
    });
    return Array.from(map.entries()).map(([day, sent]) => ({ day, sent }));
  }, [current, rangeDays]);

  const maxDaily = Math.max(1, ...dailySeries.map((d) => d.sent));
  const avgDaily = dailySeries.length ? Math.round(dailySeries.reduce((a, b) => a + b.sent, 0) / dailySeries.length) : 0;
  const bestDay  = dailySeries.reduce((b, d) => (d.sent > b.sent ? d : b), dailySeries[0] || { day: '—', sent: 0 });

  /* ── heatmap ── */
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const cutoff = Date.now() - rangeDays * 86_400_000;
    let total = 0;
    deferredConversations.forEach((conv) => {
      conv.messages?.forEach((msg) => {
        const ts = msg.timestampMs || (msg.timestamp ? new Date(msg.timestamp).getTime() : 0);
        if (!ts || ts < cutoff || msg.sender !== 'me') return;
        const d = new Date(ts);
        grid[d.getDay()][d.getHours()] += 1;
        total += 1;
      });
    });
    const max = Math.max(1, ...grid.flat());
    return { grid, max, total };
  }, [deferredConversations, rangeDays]);

  const bestHour = useMemo(() => {
    const byHour = Array(24).fill(0);
    heatmap.grid.forEach((row) => row.forEach((v, h) => { byHour[h] += v; }));
    const max = Math.max(...byHour);
    if (!max) return null;
    return { hour: byHour.indexOf(max), count: max };
  }, [heatmap]);

  /* ── canais ── */
  const channelStats = useMemo(() => {
    const map = new Map<string, { name: string; sent: number; success: number; failed: number; campaigns: number }>();
    current.forEach((c) => {
      const ids = c.selectedConnectionIds?.length ? c.selectedConnectionIds : ['unassigned'];
      const planShare = getCampaignPlannedSendTotal(c) / ids.length;
      const sucShare  = (c.successCount || 0) / ids.length;
      const failShare = (c.failedCount  || 0) / ids.length;
      ids.forEach((id) => {
        const r = map.get(id) || { name: '', sent: 0, success: 0, failed: 0, campaigns: 0 };
        r.name = connections.find((x) => x.id === id)?.name || (id === 'unassigned' ? 'Sem canal' : id);
        r.sent += planShare; r.success += sucShare; r.failed += failShare; r.campaigns += 1;
        map.set(id, r);
      });
    });
    return Array.from(map.values())
      .map((r) => ({ ...r, sent: Math.round(r.sent), success: Math.round(r.success), failed: Math.round(r.failed), efficiency: Math.min(100, pct(Math.round(r.success), Math.round(r.sent))) }))
      .sort((a, b) => b.sent - a.sent);
  }, [current, connections]);

  /* ── top campanhas ── */
  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.toLowerCase();
    return [...current]
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (campaignSort === 'rate')  return getCampaignDeliverySuccessRatePct(b) - getCampaignDeliverySuccessRatePct(a);
        if (campaignSort === 'total') return (b.totalContacts || 0) - (a.totalContacts || 0);
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
  }, [current, campaignSearch, campaignSort]);

  /* ── score de saúde (0-100) ── */
  const healthScore = Math.round((healthRate * 0.5) + (readRate * 0.3) + (Math.min(replyRate * 2, 100) * 0.2));
  const scoreColor  = healthScore >= 80 ? '#10b981' : healthScore >= 55 ? '#f59e0b' : '#ef4444';
  const scoreLabel  = healthScore >= 80 ? 'Excelente' : healthScore >= 55 ? 'Regular' : 'Atenção';

  /* ── exports ── */
  const handleCSV = () => {
    const rows = [
      ['Campanha','Data','Total','Sucesso','Falhas','Taxa (%)'],
      ...current.map((c) => [c.name, c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '', c.totalContacts, c.successCount, c.failedCount, getCampaignDeliverySuccessRatePct(c)])
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })), download: `relatorio_${period}.csv` });
    a.click();
  };
  const handlePDF = () => printReportsPdf({ title: 'Relatório ZapMass', periodLabel: PERIOD_LABEL[period], kpis: [{ label: 'Enviadas', value: fmt(totalSuccess) }, { label: 'Sucesso', value: `${healthRate}%` }, { label: 'Leitura', value: `${readRate}%` }, { label: 'Resposta', value: `${replyRate}%` }], campaigns: current.map((c) => ({ name: c.name, date: c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '', total: c.totalContacts, success: c.successCount, failed: c.failedCount, rate: getCampaignDeliverySuccessRatePct(c) })) });

  const deltaVol = deltaBadge(totalSuccess, prevSuccess);
  const deltaHealth = deltaBadge(healthRate, prevHealth);

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <PageShell
      statusStrip={
        <>
          <Badge variant="neutral">{PERIOD_LABEL[period]}</Badge>
          <span className="ui-caption tabular-nums">{fmt(totalSuccess)} enviados</span>
          <span className="ui-caption tabular-nums">Sucesso {healthRate}%</span>
          <span className="ui-caption tabular-nums">{current.length} campanhas</span>
        </>
      }
      actions={
        <div className="flex items-center gap-2">
          {/* Seletor de período */}
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
            {(['7d','30d','90d'] as PeriodFilter[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className="px-3 py-1.5 text-[12px] font-semibold transition-all"
                style={{ background: period === p ? 'var(--brand-600)' : 'transparent', color: period === p ? '#fff' : 'var(--text-2)' }}>
                {p === '7d' ? '7d' : p === '30d' ? '30d' : '3m'}
              </button>
            ))}
          </div>
          <Button variant="primary" size="sm" leftIcon={<Download className="w-3.5 h-3.5" />} onClick={handleCSV}>CSV</Button>
          <Button variant="secondary" size="sm" leftIcon={<FileText className="w-3.5 h-3.5" />} onClick={handlePDF}>PDF</Button>
        </div>
      }
    >
    <div className="pb-12 space-y-0">

      {/* ══════════════════════════════════════════
          HERO: Score + KPIs
          ══════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-4">
        {/* Score de saúde */}
        <div className="lg:col-span-1 rounded-2xl p-5 flex flex-col items-center justify-center gap-2 text-center relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${scoreColor}18, ${scoreColor}08)`, border: `1px solid ${scoreColor}30` }}>
          <div className="absolute inset-0 opacity-5" style={{ background: `radial-gradient(circle at 50% 50%, ${scoreColor}, transparent 70%)` }} />
          <div className="relative">
            <svg viewBox="0 0 80 80" width={80} height={80}>
              <circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface-2)" strokeWidth="6" />
              <circle cx="40" cy="40" r="34" fill="none" stroke={scoreColor} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 34}`}
                strokeDashoffset={`${2 * Math.PI * 34 * (1 - healthScore / 100)}`}
                transform="rotate(-90 40 40)" style={{ transition: 'stroke-dashoffset 1s ease' }} />
              <text x="40" y="45" textAnchor="middle" fontSize="18" fontWeight="bold" fill={scoreColor}>{healthScore}</text>
            </svg>
          </div>
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: scoreColor }}>{scoreLabel}</p>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Score de saúde</p>
        </div>

        {/* 4 KPIs */}
        <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Enviadas" value={fmt(totalSuccess)} icon={<Send className="w-4 h-4" />} color="#10b981" delta={deltaVol} sub={`Média ${avgDaily}/dia`} />
          <KpiTile label="Taxa sucesso" value={`${healthRate}%`} icon={<CheckCheck className="w-4 h-4" />} color={healthRate>=85?'#10b981':healthRate>=60?'#f59e0b':'#ef4444'} delta={deltaHealth} sub={`${fmt(totalTargeted)} alvejados`} />
          <KpiTile label="Taxa de leitura" value={`${readRate}%`} icon={<Eye className="w-4 h-4" />} color="#3b82f6" sub={`${fmt(funnel.read)} lidas`} />
          <KpiTile label="Taxa de resposta" value={`${replyRate}%`} icon={<Reply className="w-4 h-4" />} color="#a855f7" sub={`${fmt(funnel.replied)} respostas`} />
        </div>
      </div>

      {/* ══════════════════════════════════════════
          TABS internas
          ══════════════════════════════════════════ */}
      <div className="flex gap-0 mb-4 rounded-xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {([
          { id: 'overview',  label: 'Visão geral',  icon: <Activity className="w-3.5 h-3.5" /> },
          { id: 'campanhas', label: 'Campanhas',     icon: <Trophy className="w-3.5 h-3.5" /> },
          { id: 'canais',    label: 'Canais',        icon: <Smartphone className="w-3.5 h-3.5" /> },
          { id: 'heatmap',   label: 'Horários',      icon: <Clock className="w-3.5 h-3.5" /> },
        ] as { id: ReportTab; label: string; icon: React.ReactNode }[]).map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-semibold transition-all"
            style={{
              background: activeTab === t.id ? 'var(--brand-600)' : 'transparent',
              color: activeTab === t.id ? '#fff' : 'var(--text-2)',
            }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════
          TAB: VISÃO GERAL
          ══════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Gráfico de área — volume diário */}
          <SectionCard icon={<BarChart2 className="w-4 h-4" />} title="Volume diário de envios"
            badge={<><span className="ui-caption">Pico <strong style={{ color: 'var(--text-1)' }}>{fmt(maxDaily)}</strong></span><span className="ui-caption ml-3">Média <strong style={{ color: 'var(--text-1)' }}>{fmt(avgDaily)}</strong>/dia</span></>}>
            {dailySeries.every((d) => d.sent === 0)
              ? <EmptyChart label="Nenhum disparo no período" />
              : <AreaChart data={dailySeries} max={maxDaily} />}
          </SectionCard>

          {/* Funil + Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <SectionCard icon={<Zap className="w-4 h-4" />} title="Funil de desempenho" badge={<span className="ui-caption">Acumulado desde o início</span>}>
                <PerformanceFunnel sent={funnel.sent} delivered={funnel.delivered} read={funnel.read} replied={funnel.replied} height={260} showSidePanel={false} />
              </SectionCard>
            </div>
            <div>
              <SectionCard icon={<TrendingUp className="w-4 h-4" />} title="Destaques automáticos">
                <div className="space-y-0">
                  <InsightRow icon={<Trophy className="w-4 h-4" style={{ color: '#f59e0b' }} />} label="Melhor dia"
                    value={bestDay?.sent ? new Date(bestDay.day).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'}
                    sub={bestDay?.sent ? `${fmt(bestDay.sent)} envios` : 'Sem dados'} />
                  <InsightRow icon={<Clock className="w-4 h-4" style={{ color: '#3b82f6' }} />} label="Melhor horário"
                    value={bestHour ? `${String(bestHour.hour).padStart(2,'0')}:00` : '—'}
                    sub={bestHour ? `${fmt(bestHour.count)} msgs` : 'Sem histórico'} />
                  <InsightRow icon={<Flame className="w-4 h-4" style={{ color: '#ef4444' }} />} label="Top campanha"
                    value={filteredCampaigns[0]?.name || '—'} truncate
                    sub={filteredCampaigns[0] ? `${fmt(filteredCampaigns[0].totalContacts||0)} · ${getCampaignDeliverySuccessRatePct(filteredCampaigns[0])}%` : '—'} />
                  <InsightRow icon={<Smartphone className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />} label="Canal mais ativo"
                    value={channelStats[0]?.name || '—'} truncate
                    sub={channelStats[0] ? `${fmt(channelStats[0].sent)} envios` : 'Sem dados'} />
                  <InsightRow icon={<MessageSquare className="w-4 h-4" style={{ color: '#8b5cf6' }} />} label="Falhas"
                    value={fmt(totalFailed)}
                    sub={totalTargeted ? `${pct(totalFailed, totalTargeted)}% do total` : '—'} />
                  <InsightRow icon={<Send className="w-4 h-4" style={{ color: '#10b981' }} />} label="Campanhas ativas"
                    value={String(current.length)}
                    sub={`${previous.length} no período anterior`} />
                </div>
              </SectionCard>
            </div>
          </div>

          <ClientAttendanceFeedbackSection />

          {/* Falhas DLQ */}
          <details className="group">
            <summary className="flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer select-none"
              style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Falhas de campanha (DLQ)</span>
              </div>
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" style={{ color: 'var(--text-3)' }} />
            </summary>
            <div className="mt-2"><CampaignFailuresPanel /></div>
          </details>
        </div>
      )}

      {/* ══════════════════════════════════════════
          TAB: CAMPANHAS
          ══════════════════════════════════════════ */}
      {activeTab === 'campanhas' && (
        <div className="space-y-4">
          {/* Controles */}
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
              <input value={campaignSearch} onChange={(e) => setCampaignSearch(e.target.value)}
                placeholder="Buscar campanha..."
                className="pl-8 pr-3 py-2 rounded-xl text-[13px] w-64"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-1)', outline: 'none' }} />
            </div>
            <div className="flex gap-1 rounded-xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
              {([['date','Mais recente'],['total','Maior volume'],['rate','Melhor taxa']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setCampaignSort(k as typeof campaignSort)}
                  className="px-3 py-1.5 text-[11.5px] font-semibold transition-all"
                  style={{ background: campaignSort === k ? 'var(--brand-600)' : 'transparent', color: campaignSort === k ? '#fff' : 'var(--text-2)' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Tabela de campanhas */}
          <SectionCard icon={<Trophy className="w-4 h-4" />} title={`Campanhas do período`} badge={<Badge variant="neutral">{filteredCampaigns.length} encontradas</Badge>}>
            {filteredCampaigns.length === 0
              ? <EmptyChart label="Nenhuma campanha encontrada" />
              : (
                <div className="overflow-x-auto -mx-4 -mb-4">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
                        {['#','Campanha','Data','Contatos','Sucesso','Falhas','Taxa'].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCampaigns.map((c, i) => {
                        const rate = getCampaignDeliverySuccessRatePct(c);
                        return (
                          <tr key={c.id} className="transition-colors hover:bg-[var(--surface-1)]" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td className="px-4 py-3">
                              <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold"
                                style={{ background: i < 3 ? `linear-gradient(135deg,#f59e0b,#d97706)` : 'var(--surface-2)', color: i < 3 ? '#fff' : 'var(--text-3)' }}>
                                {i + 1}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-[220px]">
                              <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>{c.name}</p>
                            </td>
                            <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                              {c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'}
                            </td>
                            <td className="px-4 py-3 text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>{fmt(c.totalContacts || 0)}</td>
                            <td className="px-4 py-3 text-[13px] font-semibold tabular-nums" style={{ color: '#10b981' }}>{fmt(c.successCount || 0)}</td>
                            <td className="px-4 py-3 text-[13px] font-semibold tabular-nums" style={{ color: '#ef4444' }}>{fmt(c.failedCount || 0)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${rate}%`, background: rate>=85?'#10b981':rate>=60?'#f59e0b':'#ef4444', transition: 'width 0.5s' }} />
                                </div>
                                <span className="text-[12px] font-bold tabular-nums w-10" style={{ color: rate>=85?'#10b981':rate>=60?'#f59e0b':'#ef4444' }}>{rate}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </SectionCard>
        </div>
      )}

      {/* ══════════════════════════════════════════
          TAB: CANAIS
          ══════════════════════════════════════════ */}
      {activeTab === 'canais' && (
        <div className="space-y-4">
          {/* Cards de canais */}
          {channelStats.length === 0
            ? <EmptyChart label="Nenhum dado de canal no período" />
            : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {channelStats.map((ch, i) => (
                  <ChannelCard key={ch.name} channel={ch} rank={i + 1} max={channelStats[0].sent} />
                ))}
              </div>
            )}

          {/* Tabela detalhada */}
          {channelStats.length > 0 && (
            <SectionCard icon={<Smartphone className="w-4 h-4" />} title="Desempenho detalhado por canal" badge={<Badge variant="neutral">{channelStats.length} canais</Badge>}>
              <div className="overflow-x-auto -mx-4 -mb-4">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
                      {['Canal','Campanhas','Envios','Falhas','Eficiência'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {channelStats.map((c, i) => (
                      <tr key={c.name} className="transition-colors hover:bg-[var(--surface-1)]" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={{ background: i === 0 ? 'rgba(16,185,129,0.15)' : 'var(--surface-2)', color: i === 0 ? '#10b981' : 'var(--text-3)' }}>
                              #{i+1}
                            </div>
                            <span className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>{c.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[12px]" style={{ color: 'var(--text-2)' }}>{c.campaigns}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-[13px]" style={{ color: 'var(--text-1)' }}>{fmt(c.sent)}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-[13px]" style={{ color: '#ef4444' }}>{fmt(c.failed)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                              <div className="h-full rounded-full" style={{ width: `${c.efficiency}%`, background: c.efficiency>85?'#10b981':c.efficiency>60?'#f59e0b':'#ef4444' }} />
                            </div>
                            <span className="text-[12px] font-bold tabular-nums w-10" style={{ color: c.efficiency>85?'#10b981':c.efficiency>60?'#f59e0b':'#ef4444' }}>{c.efficiency}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          TAB: HEATMAP
          ══════════════════════════════════════════ */}
      {activeTab === 'heatmap' && (
        <div className="space-y-4">
          {/* Destaque do melhor horário */}
          {bestHour && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <Clock className="w-6 h-6 mx-auto mb-2" style={{ color: '#3b82f6' }} />
                <p className="text-[24px] font-black tabular-nums" style={{ color: '#3b82f6' }}>{String(bestHour.hour).padStart(2,'0')}:00</p>
                <p className="text-[11px] font-semibold uppercase tracking-widest mt-1" style={{ color: 'var(--text-3)' }}>Melhor horário</p>
              </div>
              <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <TrendingUp className="w-6 h-6 mx-auto mb-2" style={{ color: '#10b981' }} />
                <p className="text-[24px] font-black tabular-nums" style={{ color: '#10b981' }}>{fmt(bestHour.count)}</p>
                <p className="text-[11px] font-semibold uppercase tracking-widest mt-1" style={{ color: 'var(--text-3)' }}>Mensagens no pico</p>
              </div>
              <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <Send className="w-6 h-6 mx-auto mb-2" style={{ color: '#f59e0b' }} />
                <p className="text-[24px] font-black tabular-nums" style={{ color: '#f59e0b' }}>{fmt(heatmap.total)}</p>
                <p className="text-[11px] font-semibold uppercase tracking-widest mt-1" style={{ color: 'var(--text-3)' }}>Total no período</p>
              </div>
            </div>
          )}

          <SectionCard icon={<Clock className="w-4 h-4" />} title="Mapa de calor — Atividade por hora da semana"
            badge={<span className="ui-caption">Horários em que suas mensagens foram enviadas</span>}>
            {heatmap.total === 0
              ? <EmptyChart label="Dispare algumas mensagens para desbloquear o mapa de calor" />
              : <Heatmap grid={heatmap.grid} max={heatmap.max} />}
          </SectionCard>

          {/* Ranking por hora */}
          {heatmap.total > 0 && (
            <SectionCard icon={<BarChart2 className="w-4 h-4" />} title="Ranking de horários">
              <HourRanking grid={heatmap.grid} />
            </SectionCard>
          )}
        </div>
      )}

    </div>
    </PageShell>
  );
};

/* ─── SUB-COMPONENTES ───────────────────────────────────────── */

/* KpiTile */
const KpiTile: React.FC<{ label: string; value: string; icon: React.ReactNode; color: string; delta?: { label: string; up: boolean } | null; sub?: string }> = ({ label, value, icon, color, delta, sub }) => (
  <div className="rounded-2xl p-4 flex flex-col gap-2 relative overflow-hidden"
    style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}>
    <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-5" style={{ background: color, transform: 'translate(30%, -30%)' }} />
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</p>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${color}18`, color }}>{icon}</div>
    </div>
    <div className="flex items-baseline gap-2">
      <span className="text-[28px] font-extrabold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>{value}</span>
      {delta && (
        <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md"
          style={{ background: delta.up ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: delta.up ? '#10b981' : '#ef4444' }}>
          {delta.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{delta.label}
        </span>
      )}
    </div>
    {sub && <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{sub}</p>}
  </div>
);

/* SectionCard */
const SectionCard: React.FC<{ icon: React.ReactNode; title: string; badge?: React.ReactNode; children: React.ReactNode }> = ({ icon, title, badge, children }) => (
  <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}>
    <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}>{icon}</div>
        <h3 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>{title}</h3>
      </div>
      {badge && <div className="flex items-center gap-2">{badge}</div>}
    </div>
    <div className="p-4 sm:p-5">{children}</div>
  </div>
);

/* InsightRow */
const InsightRow: React.FC<{ icon: React.ReactNode; label: string; value: string; sub: string; truncate?: boolean }> = ({ icon, label, value, sub, truncate }) => (
  <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--surface-1)' }}>{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className={`text-[13px] font-bold ${truncate ? 'truncate' : ''}`} style={{ color: 'var(--text-1)' }}>{value}</p>
    </div>
    <p className="text-[11px] text-right shrink-0 max-w-[100px]" style={{ color: 'var(--text-3)' }}>{sub}</p>
  </div>
);

/* ChannelCard */
const ChannelCard: React.FC<{ channel: { name: string; sent: number; success: number; failed: number; campaigns: number; efficiency: number }; rank: number; max: number }> = ({ channel: c, rank, max }) => (
  <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-0)', border: `1px solid ${rank===1?'rgba(16,185,129,0.3)':'var(--border-subtle)'}` }}>
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[12px]"
        style={{ background: rank===1?'rgba(16,185,129,0.15)':'var(--surface-1)', color: rank===1?'#10b981':'var(--text-3)' }}>#{rank}</div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>{c.name}</p>
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{c.campaigns} campanha{c.campaigns!==1?'s':''}</p>
      </div>
      <span className="text-[13px] font-black tabular-nums" style={{ color: c.efficiency>=85?'#10b981':c.efficiency>=60?'#f59e0b':'#ef4444' }}>{c.efficiency}%</span>
    </div>
    {/* Barra proporcional ao maior */}
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.round((c.sent/max)*100)}%`, background: 'var(--brand-500)' }} />
    </div>
    <div className="grid grid-cols-3 gap-2 text-center">
      <div><p className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{fmt(c.sent)}</p><p className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Envios</p></div>
      <div><p className="text-[13px] font-bold tabular-nums" style={{ color: '#10b981' }}>{fmt(c.success)}</p><p className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Sucesso</p></div>
      <div><p className="text-[13px] font-bold tabular-nums" style={{ color: '#ef4444' }}>{fmt(c.failed)}</p><p className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Falhas</p></div>
    </div>
  </div>
);

/* EmptyChart */
const EmptyChart: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center py-14 gap-3" style={{ color: 'var(--text-3)' }}>
    <BarChart2 className="w-10 h-10 opacity-30" />
    <p className="text-[13px] text-center max-w-xs">{label}</p>
  </div>
);

/* AreaChart */
const AreaChart: React.FC<{ data: Array<{ day: string; sent: number }>; max: number }> = ({ data, max }) => {
  const compact = data.length > 30;
  const items = compact ? data.filter((_, i) => i % Math.ceil(data.length / 30) === 0) : data;
  const W = 100, H = 120;
  const pts = items.map((d, i) => ({ x: (i / Math.max(items.length - 1, 1)) * W, y: H - Math.max(2, (d.sent / max) * H), sent: d.sent, day: d.day }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `M${pts[0]?.x},${H} ` + pts.map((p) => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length-1]?.x},${H} Z`;
  return (
    <div className="space-y-3">
      <div className="relative h-36 w-full">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#areaGrad)" />
          <polyline points={polyline} fill="none" stroke="var(--brand-500)" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => p.sent > 0 && (
            <circle key={i} cx={p.x} cy={p.y} r="0.8" fill="var(--brand-500)" />
          ))}
        </svg>
      </div>
      {/* Barras interativas */}
      <div className="flex items-end gap-0.5 h-10 w-full">
        {items.map((d, i) => {
          const h = Math.max(4, Math.round((d.sent / max) * 40));
          const label = new Date(d.day).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
          return (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-0 group relative">
              <div className="w-full rounded-t transition-all duration-200 group-hover:opacity-80 cursor-pointer"
                style={{ height: h, background: d.sent > 0 ? 'var(--brand-500)' : 'var(--surface-2)', opacity: d.sent > 0 ? 0.8 : 0.3 }} />
              <div className="absolute bottom-full mb-1 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap px-2 py-1 rounded-lg text-[10px] font-semibold z-10"
                style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-1)' }}>
                {label} · {fmt(d.sent)}
              </div>
              {(i === 0 || i === items.length - 1 || i % Math.ceil(items.length / 5) === 0) && (
                <span className="text-[8.5px] tabular-nums mt-0.5" style={{ color: 'var(--text-3)' }}>{new Date(d.day).getDate()}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* Heatmap */
const Heatmap: React.FC<{ grid: number[][]; max: number }> = ({ grid, max }) => {
  const cellColor = (v: number) => {
    if (!v) return 'var(--surface-2)';
    const ratio = v / max;
    return `color-mix(in srgb, var(--brand-500) ${Math.round((0.15 + ratio * 0.85) * 100)}%, transparent)`;
  };
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="flex gap-1 mb-1 pl-12">
          {HOUR_LABELS.map((h, i) => (
            <div key={h} className="flex-1 text-center text-[8.5px] tabular-nums" style={{ color: 'var(--text-3)' }}>{i % 3 === 0 ? h : ''}</div>
          ))}
        </div>
        {grid.map((row, d) => (
          <div key={d} className="flex items-center gap-1 mb-1">
            <div className="w-10 text-[10px] font-semibold text-right pr-2 shrink-0" style={{ color: 'var(--text-3)' }}>{DAY_LABELS[d]}</div>
            {row.map((v, h) => (
              <div key={h} title={`${DAY_LABELS[d]} ${String(h).padStart(2,'0')}:00 · ${v} msgs`}
                className="flex-1 rounded cursor-help transition-transform hover:scale-110 hover:z-10 relative"
                style={{ background: cellColor(v), minHeight: 20, aspectRatio: '1' }} />
            ))}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-3 pl-12">
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Menos</span>
          {[0.1,0.3,0.5,0.7,1].map((r) => (
            <div key={r} className="w-5 h-3 rounded" style={{ background: r===0.1?'var(--surface-2)':`color-mix(in srgb, var(--brand-500) ${Math.round(r*100)}%, transparent)` }} />
          ))}
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Mais</span>
          <span className="ml-auto text-[11px]" style={{ color: 'var(--text-3)' }}>Pico: <strong style={{ color: 'var(--text-1)' }}>{max}</strong> msgs/h</span>
        </div>
      </div>
    </div>
  );
};

/* HourRanking — top 5 horários */
const HourRanking: React.FC<{ grid: number[][] }> = ({ grid }) => {
  const byHour = HOUR_LABELS.map((label, h) => ({ label, total: grid.reduce((s, row) => s + row[h], 0) }));
  const sorted = [...byHour].sort((a, b) => b.total - a.total).slice(0, 8);
  const maxH = sorted[0]?.total || 1;
  return (
    <div className="space-y-2">
      {sorted.map((h, i) => (
        <div key={h.label} className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ background: i === 0 ? 'rgba(59,130,246,0.15)' : 'var(--surface-1)', color: i === 0 ? '#3b82f6' : 'var(--text-3)' }}>
            {i + 1}
          </div>
          <span className="w-10 text-[12px] font-bold tabular-nums shrink-0" style={{ color: 'var(--text-2)' }}>{h.label}</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.round((h.total/maxH)*100)}%`, background: '#3b82f6' }} />
          </div>
          <span className="w-14 text-right text-[11px] font-semibold tabular-nums shrink-0" style={{ color: 'var(--text-3)' }}>{fmt(h.total)} msgs</span>
        </div>
      ))}
    </div>
  );
};
