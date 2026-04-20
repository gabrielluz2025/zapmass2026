import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  CheckCheck,
  Download,
  PieChart,
  Smartphone,
  TrendingUp
} from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';
import { Badge, Button, Card, EmptyState, SectionHeader, StatCard, Tabs } from './ui';

type PeriodFilter = '7d' | '30d' | 'month';

export const ReportsTab: React.FC = () => {
  const { campaigns, connections } = useZapMass();
  const [period, setPeriod] = useState<PeriodFilter>('7d');

  const filteredCampaigns = useMemo(() => {
    const now = new Date();
    return campaigns.filter((c) => {
      if (!c.createdAt) return true;
      const created = new Date(c.createdAt);
      if (period === '7d') {
        const cutoff = new Date(now);
        cutoff.setDate(now.getDate() - 7);
        return created >= cutoff;
      }
      if (period === '30d') {
        const cutoff = new Date(now);
        cutoff.setDate(now.getDate() - 30);
        return created >= cutoff;
      }
      if (period === 'month') {
        return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
      }
      return true;
    });
  }, [campaigns, period]);

  const totalSent = filteredCampaigns.reduce((acc, item) => acc + (item.totalContacts || 0), 0);
  const totalSuccess = filteredCampaigns.reduce((acc, item) => acc + (item.successCount || 0), 0);
  const totalFailed = filteredCampaigns.reduce((acc, item) => acc + (item.failedCount || 0), 0);
  const healthRate = totalSent > 0 ? Math.round((totalSuccess / totalSent) * 100) : 0;

  const groupedByDay = filteredCampaigns.reduce<Record<string, number>>((acc, camp) => {
    const day = camp.createdAt ? new Date(camp.createdAt).toLocaleDateString('pt-BR') : 'Hoje';
    acc[day] = (acc[day] || 0) + (camp.totalContacts || 0);
    return acc;
  }, {});

  const dailyStats = Object.entries(groupedByDay)
    .slice(0, 7)
    .map(([day, sent]) => ({
      day,
      sent,
      height: totalSent > 0 ? `${Math.max(10, Math.round((sent / totalSent) * 100))}%` : '10%'
    }));

  const bestDay = dailyStats.reduce(
    (best, item) => (item.sent > best.sent ? item : best),
    dailyStats[0] || { day: '-', sent: 0, height: '10%' }
  );
  const avgPerDay = dailyStats.length > 0 ? Math.round(totalSent / dailyStats.length) : 0;

  const channelStats = useMemo(() => {
    const byChannel = new Map<string, { name: string; sent: number; failed: number }>();

    filteredCampaigns.forEach((campaign) => {
      const selectedIds = campaign.selectedConnectionIds?.length
        ? campaign.selectedConnectionIds
        : ['unassigned'];
      const perChannelTotal = campaign.totalContacts > 0 ? campaign.totalContacts / selectedIds.length : 0;
      const perChannelFailed = campaign.failedCount > 0 ? campaign.failedCount / selectedIds.length : 0;

      selectedIds.forEach((connectionId) => {
        const existing = byChannel.get(connectionId);
        const connectionName =
          connections.find((conn) => conn.id === connectionId)?.name ||
          (connectionId === 'unassigned' ? 'Sem canal vinculado' : connectionId);
        byChannel.set(connectionId, {
          name: connectionName,
          sent: Math.round((existing?.sent || 0) + perChannelTotal),
          failed: Math.round((existing?.failed || 0) + perChannelFailed)
        });
      });
    });

    return Array.from(byChannel.entries()).map(([id, stats]) => ({
      id,
      ...stats,
      efficiency:
        stats.sent > 0 ? Math.max(0, Math.round(((stats.sent - stats.failed) / stats.sent) * 100)) : 0
    }));
  }, [connections, filteredCampaigns]);

  const handleDownloadCSV = () => {
    const rows = [
      ['Campanha', 'Data', 'Total', 'Sucesso', 'Falhas', 'Eficiencia (%)'],
      ...filteredCampaigns.map((c) => [
        c.name,
        c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '-',
        c.totalContacts,
        c.successCount,
        c.failedCount,
        c.totalContacts > 0 ? Math.round((c.successCount / c.totalContacts) * 100) : 0
      ])
    ];
    const csv = '\uFEFF' + rows.map((r) => r.join(',')).join('\n');
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
        eyebrow={
          <>
            <PieChart className="w-3 h-3" />
            Relatorios
          </>
        }
        title="Relatorios Analiticos"
        description="Analise o ROI e a performance da sua operacao."
        icon={<BarChart3 className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        actions={
          <>
            <Tabs
              value={period}
              onChange={(v) => setPeriod(v as PeriodFilter)}
              items={[
                { id: '7d', label: '7 dias' },
                { id: '30d', label: '30 dias' },
                { id: 'month', label: 'Este mes' }
              ]}
            />
            <Button variant="primary" leftIcon={<Download className="w-4 h-4" />} onClick={handleDownloadCSV}>
              Exportar CSV
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total no periodo"
          value={totalSent.toLocaleString()}
          icon={<BarChart3 className="w-4 h-4" />}
          helper={`Media diaria: ${avgPerDay}`}
        />
        <StatCard
          label="Entregues"
          value={totalSuccess.toLocaleString()}
          icon={<CheckCheck className="w-4 h-4" />}
          accent="success"
          helper={`${healthRate}% de taxa`}
        />
        <StatCard
          label="Melhor dia"
          value={bestDay.day}
          icon={<Calendar className="w-4 h-4" />}
          accent="info"
          helper={`${bestDay.sent.toLocaleString()} envios`}
        />
        <StatCard
          label="Saude geral"
          value={`${healthRate}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          accent={healthRate >= 85 ? 'success' : 'warning'}
          helper="Baseado em sucesso"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              <h3 className="ui-title text-[14px]">Volume de disparos</h3>
            </div>
            <button
              onClick={handleDownloadCSV}
              className="text-[12px] font-semibold flex items-center gap-1"
              style={{ color: 'var(--brand-600)' }}
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>

          {dailyStats.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
              title="Sem campanhas recentes"
              description="Crie uma campanha para comecar a coletar dados."
            />
          ) : (
            <div className="h-56 flex items-end justify-between gap-2 md:gap-3 px-2">
              {dailyStats.map((stat, index) => (
                <div key={index} className="flex flex-col items-center gap-2 flex-1 group">
                  <div
                    className="text-[11px] font-bold opacity-0 group-hover:opacity-100 transition-opacity mb-1 tabular-nums"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {stat.sent}
                  </div>
                  <div
                    className="w-full rounded-t-lg relative h-44 flex items-end overflow-hidden"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div
                      className="w-full rounded-t-lg transition-all duration-500 group-hover:opacity-80"
                      style={{
                        height: stat.height,
                        background: 'linear-gradient(180deg, var(--brand-500) 0%, var(--brand-600) 100%)'
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                    {stat.day}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card variant="premium" className="flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
              Total de mensagens
            </p>
            <div className="text-[36px] font-bold mb-5 tabular-nums" style={{ color: 'var(--text-1)' }}>
              {totalSent.toLocaleString()}
            </div>

            <div className="space-y-3.5">
              <div className="flex justify-between items-center">
                <span className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                  Campanhas no periodo
                </span>
                <span className="font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
                  {filteredCampaigns.length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[12.5px] font-semibold" style={{ color: 'var(--brand-600)' }}>
                  Entregues
                </span>
                <span className="font-mono text-lg font-bold tabular-nums" style={{ color: 'var(--brand-600)' }}>
                  {totalSuccess.toLocaleString()}
                </span>
              </div>
              <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
              <div className="flex justify-between items-center">
                <span className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                  Taxa de saude
                </span>
                <Badge variant={healthRate >= 85 ? 'success' : 'warning'}>{healthRate}%</Badge>
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            fullWidth
            leftIcon={<Download className="w-4 h-4" />}
            onClick={handleDownloadCSV}
            className="mt-5"
          >
            Baixar Relatorio
          </Button>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 className="ui-title text-[14px]">Eficiencia por canal</h3>
          <Badge variant="neutral">{channelStats.length} canais</Badge>
        </div>
        <table className="w-full text-sm text-left">
          <thead style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
            <tr>
              {['Canal', 'Envios', 'Falhas', 'Eficiencia'].map((h) => (
                <th
                  key={h}
                  className="px-5 py-3 font-bold text-[10.5px] uppercase tracking-widest"
                  style={{ color: 'var(--text-3)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channelStats.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                  Sem campanhas para calcular performance por canal.
                </td>
              </tr>
            )}
            {channelStats.map((channel) => (
              <tr
                key={channel.id}
                className="transition-colors hover:bg-[var(--surface-1)]"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
                    <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                      {channel.name}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3.5 tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {channel.sent.toLocaleString()}
                </td>
                <td className="px-5 py-3.5 tabular-nums font-semibold" style={{ color: 'var(--danger)' }}>
                  {channel.failed.toLocaleString()}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex-1 h-1.5 rounded-full overflow-hidden max-w-[120px]"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${channel.efficiency}%`,
                          background: channel.efficiency > 90 ? 'var(--brand-500)' : '#f59e0b'
                        }}
                      />
                    </div>
                    <span
                      className="text-[12px] font-bold tabular-nums w-10"
                      style={{ color: channel.efficiency > 90 ? 'var(--brand-600)' : '#f59e0b' }}
                    >
                      {channel.efficiency}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <h3 className="ui-title text-[14px] mb-4">Insights automaticos</h3>
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-3)' }}>Melhor dia do periodo</span>
              <span className="font-semibold" style={{ color: 'var(--brand-600)' }}>
                {bestDay.day}
              </span>
            </div>
            <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-3)' }}>Campanhas executadas</span>
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                {campaigns.length}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span style={{ color: 'var(--text-3)' }}>Falhas acumuladas</span>
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                {totalFailed}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="ui-title text-[14px] mb-4">Acoes recomendadas</h3>
          <ul className="space-y-3 text-[12.5px]" style={{ color: 'var(--text-2)' }}>
            <li className="flex items-center gap-2">
              <CheckCheck className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
              Ajustar campanhas para 2 canais simultaneos
            </li>
            <li className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" style={{ color: '#f59e0b' }} />
              Priorizar lista "Clientes VIP"
            </li>
            <li className="flex items-center gap-2">
              <Calendar className="w-4 h-4" style={{ color: '#3b82f6' }} />
              Agendar disparos para dias de pico
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
};
