import React from 'react';
import type { StageReplyEntry } from '../../utils/campaignStageRepliesFromLogs';

type Props = {
  stageReplies?: StageReplyEntry[];
  fallbackText?: string;
  compact?: boolean;
};

export const CampaignStageRepliesCell: React.FC<Props> = ({
  stageReplies,
  fallbackText,
  compact = false
}) => {
  if (stageReplies && stageReplies.length > 0) {
    return (
      <div className={`max-w-full ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
        {stageReplies.map((s) => {
          const snippet = s.replyText
            ? s.replyText.length > (compact ? 48 : 80)
              ? `${s.replyText.slice(0, compact ? 48 : 80)}…`
              : s.replyText
            : '—';
          return (
            <div
              key={`${s.stageNumber}-${s.replyTimestampMs}`}
              className="px-2.5 py-1.5 rounded-lg"
              style={{
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid rgba(16,185,129,0.2)'
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span
                  className="text-[9.5px] font-bold uppercase tracking-wide"
                  style={{ color: '#d97706' }}
                >
                  Etapa {s.stageNumber}
                </span>
                <span className="text-[9.5px] font-mono tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {s.replyTime}
                </span>
              </div>
              <span className="text-[12.5px] block truncate" style={{ color: 'var(--text-1)' }} title={s.replyText}>
                {snippet.startsWith('[') ? snippet : `"${snippet}"`}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (fallbackText) {
    const snippet =
      fallbackText.length > 80 ? `${fallbackText.slice(0, 80)}…` : fallbackText;
    return (
      <div
        className="px-2.5 py-1.5 rounded-lg inline-block max-w-full"
        style={{
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.2)',
          color: 'var(--text-1)'
        }}
      >
        <span className="truncate block">"{snippet}"</span>
      </div>
    );
  }

  return null;
};
