import React from 'react';
import { ChevronRight, Pause, Play, Radio } from 'lucide-react';
import { Campaign, CampaignStatus } from '../../types';
import { Badge } from '../ui';

interface Props {
  campaigns: Campaign[];
  onOpenDetails: (id: string) => void;
  onTogglePause: (id: string) => void;
}

export const CampaignMissionStickyBar: React.FC<Props> = ({ campaigns, onOpenDetails, onTogglePause }) => {
  const active = campaigns.filter((c) => c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.PAUSED);
  if (active.length === 0) return null;

  const first = active[0];
  const more = active.length - 1;

  const progress =
    first.totalContacts > 0 ? Math.round((first.processedCount / first.totalContacts) * 100) : 0;

  return (
    <div
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none"
      style={{
        background: 'linear-gradient(to top, color-mix(in srgb, var(--surface-0) 96%, transparent), transparent)',
        paddingTop: '12px'
      }}
    >
      <div
        className="pointer-events-auto max-w-5xl mx-auto rounded-2xl px-3 py-2.5 flex items-center gap-3 shadow-lg border"
        style={{
          background: 'var(--surface-0)',
          borderColor: 'var(--border-subtle)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.12)'
        }}
      >
        <div className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
            <p className="text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
              {first.name}
            </p>
            {more > 0 && (
              <Badge variant="neutral" className="text-[10px] py-0">
                +{more}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: 'var(--brand-500)' }}
              />
            </div>
            <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--text-3)' }}>
              {progress}%
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onTogglePause(first.id)}
          className="shrink-0 p-2 rounded-xl"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          aria-label={first.status === CampaignStatus.RUNNING ? 'Pausar' : 'Retomar'}
        >
          {first.status === CampaignStatus.RUNNING ? (
            <Pause className="w-4 h-4" style={{ color: 'var(--text-1)' }} />
          ) : (
            <Play className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
          )}
        </button>
        <button
          type="button"
          onClick={() => onOpenDetails(first.id)}
          className="shrink-0 p-2 rounded-xl"
          style={{ background: 'var(--brand-50)', border: '1px solid rgba(16,185,129,0.25)' }}
          aria-label="Abrir detalhes"
        >
          <ChevronRight className="w-4 h-4 text-emerald-600" />
        </button>
      </div>
    </div>
  );
};
