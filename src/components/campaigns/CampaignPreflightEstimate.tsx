import React, { useMemo } from 'react';
import { Clock, Users, Zap } from 'lucide-react';

type Props = {
  recipientCount: number;
  delayMinSec: number;
  delayMaxSec: number;
  channelCount: number;
  stageCount: number;
  dailyLimit?: number;
};

/** Estimativa de duração e limites antes do disparo (passo Revisão). */
export const CampaignPreflightEstimate: React.FC<Props> = ({
  recipientCount,
  delayMinSec,
  delayMaxSec,
  channelCount,
  stageCount,
  dailyLimit
}) => {
  const stats = useMemo(() => {
    const avgDelay = (delayMinSec + Math.max(delayMinSec, delayMaxSec)) / 2;
    const msgsTotal = recipientCount * Math.max(1, stageCount);
    const secTotal = (msgsTotal * avgDelay) / Math.max(1, channelCount);
    const hours = secTotal / 3600;
    const hitsDailyLimit = dailyLimit != null && dailyLimit > 0 && recipientCount > dailyLimit;
    return { avgDelay, msgsTotal, hours, hitsDailyLimit };
  }, [recipientCount, delayMinSec, delayMaxSec, channelCount, stageCount, dailyLimit]);

  if (recipientCount <= 0) return null;

  return (
    <div
      className="rounded-xl p-4 space-y-2 mb-4"
      style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
        <Zap className="w-3.5 h-3.5 text-indigo-500" />
        Simulador de disparo (pré-voo)
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500 shrink-0" />
          <span>
            <strong>{recipientCount.toLocaleString('pt-BR')}</strong> destinatários ·{' '}
            <strong>{stats.msgsTotal.toLocaleString('pt-BR')}</strong> envios (etapas)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-500 shrink-0" />
          <span>
            ~<strong>{stats.hours < 1 ? `${Math.round(stats.hours * 60)} min` : `${stats.hours.toFixed(1)} h`}</strong>{' '}
            com {channelCount} chip{channelCount !== 1 ? 's' : ''} (média {Math.round(stats.avgDelay)}s)
          </span>
        </div>
        {stats.hitsDailyLimit ? (
          <span className="text-amber-600 font-semibold sm:col-span-1">
            Atenção: público acima do limite diário ({dailyLimit}). O restante continua no dia seguinte.
          </span>
        ) : null}
      </div>
    </div>
  );
};
