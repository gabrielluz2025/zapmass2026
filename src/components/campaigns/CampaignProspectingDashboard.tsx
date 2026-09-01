import React, { useEffect, useState } from 'react';
import { Calendar, MessageSquare, Reply, Users } from 'lucide-react';
import type { Campaign, CampaignProspecting } from '../../types';
import { fetchCampaignProspectingStats } from '../../services/campaignsApi';
import { Card } from '../ui';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Props = {
  campaign: Campaign;
};

export const CampaignProspectingDashboard: React.FC<Props> = ({ campaign }) => {
  const [stats, setStats] = useState<{
    total: number;
    replied: number;
    silent: number;
    maxSilentWave: number;
    pendingInitial: number;
  } | null>(null);
  const [prospecting, setProspecting] = useState<CampaignProspecting | null>(
    campaign.prospecting ?? null
  );

  useEffect(() => {
    let cancelled = false;
    void fetchCampaignProspectingStats(campaign.id)
      .then((res) => {
        if (cancelled) return;
        setStats(res.stats);
        if (res.prospecting) setProspecting(res.prospecting);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [campaign.id, campaign.processedCount, campaign.successCount]);

  if (!campaign.prospecting?.enabled && !prospecting?.enabled) return null;

  const p = prospecting || campaign.prospecting;
  const sent = Math.max(campaign.successCount || 0, stats?.total ?? 0);
  const replied = stats?.replied ?? campaign.reportSnapshot?.totals?.replied ?? 0;
  const silent = stats?.silent ?? Math.max(0, sent - replied);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
        <h4 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
          Prospecção da base
        </h4>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Enviados (onda 0)', value: sent, icon: MessageSquare },
          { label: 'Responderam', value: replied, icon: Reply },
          { label: 'Silenciosos', value: silent, icon: Users },
          { label: 'Onda silenciosa', value: p?.silentWaveIndex ?? 0, icon: Calendar }
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg p-3"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
          >
            <item.icon className="w-3.5 h-3.5 mb-1" style={{ color: 'var(--text-3)' }} />
            <p className="text-[18px] font-bold leading-none" style={{ color: 'var(--text-1)' }}>
              {item.value}
            </p>
            <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-3)' }}>
              {item.label}
            </p>
          </div>
        ))}
      </div>
      <div className="text-[11.5px] space-y-1" style={{ color: 'var(--text-3)' }}>
        {p?.nextBumpAt && p.active !== false ? (
          <p>
            Próximo lembrete para silenciosos:{' '}
            <strong style={{ color: 'var(--text-2)' }}>
              {new Date(p.nextBumpAt).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short'
              })}
            </strong>{' '}
            ({WEEKDAYS[p.bumpWeekday] ?? '?'} {p.bumpTime})
          </p>
        ) : (
          <p>Lembretes semanais {p?.active === false ? 'encerrados' : 'aguardando primeira janela'}.</p>
        )}
        {p?.responderJourneyId && (
          <p>Quem responde entra na jornada semanal vinculada a esta campanha.</p>
        )}
        {(stats?.pendingInitial ?? 0) > 0 && (
          <p>{stats?.pendingInitial} contato(s) ainda aguardando envio da onda inicial.</p>
        )}
      </div>
    </Card>
  );
};
