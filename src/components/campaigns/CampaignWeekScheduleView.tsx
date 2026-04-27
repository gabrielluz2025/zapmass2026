import React, { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import type { Campaign } from '../../types';
import { CampaignStatus } from '../../types';
import { formatScheduleSlotLine } from '../../utils/campaignSchedule';
import { Card } from '../ui';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base: Date, n: number): Date {
  const x = new Date(base);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

interface CampaignWeekScheduleViewProps {
  campaigns: Campaign[];
  onOpenDetails: (id: string) => void;
}

/**
 * Grade da semana atual (seg–dom) com blocos das campanhas agendadas.
 */
export const CampaignWeekScheduleView: React.FC<CampaignWeekScheduleViewProps> = ({
  campaigns,
  onOpenDetails
}) => {
  const scheduled = useMemo(
    () =>
      campaigns.filter(
        (c) =>
          c.status === CampaignStatus.SCHEDULED &&
          c.weeklySchedule?.slots &&
          c.weeklySchedule.slots.length > 0 &&
          c.nextRunAt
      ),
    [campaigns]
  );

  const { weekStart, days } = useMemo(() => {
    const today = new Date();
    const start = startOfWeekMonday(today);
    const list: Date[] = [];
    for (let i = 0; i < 7; i++) list.push(addDays(start, i));
    return { weekStart: start, days: list };
  }, []);

  const itemsByWeekday = useMemo(() => {
    const map = new Map<number, { campaign: Campaign; label: string }[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const c of scheduled) {
      const slots = c.weeklySchedule?.slots || [];
      for (const s of slots) {
        const dow = Math.min(6, Math.max(0, s.dayOfWeek));
        const arr = map.get(dow) || [];
        arr.push({
          campaign: c,
          label: formatScheduleSlotLine(s)
        });
        map.set(dow, arr);
      }
    }
    return map;
  }, [scheduled]);

  if (scheduled.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2.5 mb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(99,102,241,0.15)' }}
        >
          <CalendarClock className="w-4 h-4 text-indigo-500" />
        </div>
        <div>
          <h3 className="ui-title text-[15px]">Programação da semana</h3>
          <p className="ui-subtitle text-[12px]">
            Semana de {weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} — campanhas
            agendadas por dia
          </p>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((d, idx) => {
          const dow = d.getDay();
          const entries = itemsByWeekday.get(dow) || [];
          const isToday = new Date().toDateString() === d.toDateString();
          return (
            <div
              key={idx}
              className="rounded-xl p-2 min-h-[100px] flex flex-col"
              style={{
                background: isToday ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
                border: `1px solid ${isToday ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)'}`
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
                {DAY_LABELS[dow]}
              </div>
              <div className="text-[13px] font-bold tabular-nums mb-2" style={{ color: 'var(--text-1)' }}>
                {d.getDate()}
              </div>
              <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                {entries.length === 0 ? (
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    —
                  </span>
                ) : (
                  entries.map((e, j) => (
                    <button
                      key={`${e.campaign.id}-${j}`}
                      type="button"
                      onClick={() => onOpenDetails(e.campaign.id)}
                      className="text-left rounded-lg px-1.5 py-1 transition-all hover:opacity-90"
                      style={{
                        background: 'var(--surface-0)',
                        border: '1px solid var(--border-subtle)'
                      }}
                      title={e.campaign.name}
                    >
                      <p className="text-[9px] font-bold truncate" style={{ color: 'var(--brand-600)' }}>
                        {e.label}
                      </p>
                      <p className="text-[9px] truncate leading-tight" style={{ color: 'var(--text-2)' }}>
                        {e.campaign.name}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 space-y-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          Próximos disparos
        </p>
        {scheduled
          .slice()
          .sort((a, b) => (a.nextRunAt || '').localeCompare(b.nextRunAt || ''))
          .slice(0, 6)
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpenDetails(c.id)}
              className="w-full flex items-center justify-between gap-2 text-left rounded-lg px-2 py-1.5 text-[12px]"
              style={{ background: 'var(--surface-1)' }}
            >
              <span className="truncate font-medium" style={{ color: 'var(--text-1)' }}>
                {c.name}
              </span>
              <span className="flex-shrink-0 tabular-nums text-[11px]" style={{ color: 'var(--text-3)' }}>
                {c.nextRunAt ? fmtShort(c.nextRunAt) : '—'}
              </span>
            </button>
          ))}
      </div>
    </Card>
  );
};
