import React from 'react';
import { CheckCircle2, ChevronRight, Plus, Rocket, Smartphone, Target, TrendingUp } from 'lucide-react';
import { Campaign, CampaignStatus, WhatsAppConnection } from '../../types';
import { Badge, Button, Card, EmptyState, StatCard } from '../ui';

interface CampaignsOverviewProps {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  onOpenDetails: (id: string) => void;
  onViewAll: () => void;
  onCreate: () => void;
}

export const CampaignsOverview: React.FC<CampaignsOverviewProps> = ({
  campaigns,
  connections,
  onOpenDetails,
  onViewAll,
  onCreate
}) => {
  const totalCampaigns = campaigns.length;
  const runningCampaigns = campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length;
  const completedCampaigns = campaigns.filter((c) => c.status === CampaignStatus.COMPLETED).length;
  const onlineCount = connections.filter((c) => c.status === 'CONNECTED').length;

  const totalSent = campaigns.reduce((a, c) => a + c.successCount, 0);
  const totalFailed = campaigns.reduce((a, c) => a + c.failedCount, 0);
  const totalProcessed = campaigns.reduce((a, c) => a + c.processedCount, 0);
  const avgRate = totalProcessed > 0 ? Math.round((totalSent / totalProcessed) * 100) : 0;

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={<Rocket className="w-6 h-6" style={{ color: 'var(--brand-600)' }} />}
        title="Nenhuma campanha ainda"
        description="Crie sua primeira campanha e dispare mensagens para toda sua base de contatos com seguranca."
        action={
          <Button variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={onCreate}>
            Criar Campanha
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Campanhas"
          value={totalCampaigns}
          icon={<Target className="w-4 h-4" />}
          helper={`${runningCampaigns} ativa${runningCampaigns !== 1 ? 's' : ''}`}
          accent="info"
        />
        <StatCard
          label="Enviadas"
          value={totalSent.toLocaleString()}
          icon={<CheckCircle2 className="w-4 h-4" />}
          helper={`${totalFailed} falha${totalFailed !== 1 ? 's' : ''}`}
          accent="success"
        />
        <StatCard
          label="Taxa de sucesso"
          value={`${avgRate}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          helper={`${totalProcessed.toLocaleString()} processados`}
          accent={avgRate >= 85 ? 'success' : 'warning'}
        />
        <StatCard
          label="Chips Online"
          value={onlineCount}
          icon={<Smartphone className="w-4 h-4" />}
          helper={`de ${connections.length} total`}
        />
      </div>

      {runningCampaigns > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <h3 className="ui-title text-[14px]">Campanhas Ativas</h3>
            </div>
            <button
              onClick={onViewAll}
              className="text-[11.5px] font-semibold flex items-center gap-1 transition-colors"
              style={{ color: 'var(--brand-600)' }}
            >
              Ver todas <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            {campaigns
              .filter((c) => c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.PAUSED)
              .slice(0, 3)
              .map((camp) => {
                const progress =
                  camp.totalContacts > 0 ? Math.round((camp.processedCount / camp.totalContacts) * 100) : 0;
                const isRunning = camp.status === CampaignStatus.RUNNING;
                return (
                  <button
                    key={camp.id}
                    className="w-full text-left rounded-lg p-3 transition-all hover:bg-[var(--surface-2)]"
                    style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
                    onClick={() => onOpenDetails(camp.id)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {camp.name}
                        </p>
                        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {camp.processedCount.toLocaleString()} de {camp.totalContacts.toLocaleString()} processados
                        </p>
                      </div>
                      <Badge variant={isRunning ? 'success' : 'warning'} dot>
                        {isRunning ? 'Ativa' : 'Pausada'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${progress}%`,
                            background: isRunning ? 'var(--brand-500)' : '#f59e0b'
                          }}
                        />
                      </div>
                      <span
                        className="text-[11.5px] font-bold tabular-nums w-10 text-right"
                        style={{ color: isRunning ? 'var(--brand-600)' : '#f59e0b' }}
                      >
                        {progress}%
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>
        </Card>
      )}

      {completedCampaigns > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="ui-title text-[14px]">Ultimas concluidas</h3>
            <Badge variant="neutral">{completedCampaigns}</Badge>
          </div>
          <div className="space-y-2">
            {campaigns
              .filter((c) => c.status === CampaignStatus.COMPLETED)
              .slice(0, 5)
              .map((camp) => {
                const rate =
                  camp.processedCount > 0 ? Math.round((camp.successCount / camp.processedCount) * 100) : 0;
                const rateVariant: 'success' | 'warning' | 'danger' =
                  rate >= 85 ? 'success' : rate >= 60 ? 'warning' : 'danger';
                return (
                  <button
                    key={camp.id}
                    className="w-full text-left rounded-lg px-3 py-2.5 transition-all hover:bg-[var(--surface-2)]"
                    style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
                    onClick={() => onOpenDetails(camp.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {camp.name}
                        </p>
                        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {camp.totalContacts.toLocaleString()} contatos
                        </p>
                      </div>
                      <Badge variant={rateVariant}>{rate}% sucesso</Badge>
                    </div>
                  </button>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
};
