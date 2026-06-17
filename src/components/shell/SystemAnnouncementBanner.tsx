import React from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useAppConfig } from '../../context/AppConfigContext';

const ICON = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle
} as const;

const STYLE = {
  info: {
    bg: 'rgba(59, 130, 246, 0.12)',
    border: 'rgba(59, 130, 246, 0.35)',
    icon: 'text-blue-500'
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.35)',
    icon: 'text-amber-500'
  },
  error: {
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.35)',
    icon: 'text-red-500'
  }
} as const;

export const SystemAnnouncementBanner: React.FC = () => {
  const { config } = useAppConfig();
  const announcement = config.systemAnnouncement;

  if (!announcement?.active || !announcement.showBanner) return null;

  const kind = announcement.kind in STYLE ? announcement.kind : 'info';
  const Icon = ICON[kind];
  const palette = STYLE[kind];

  return (
    <div
      className="px-4 py-3 border-b"
      style={{ background: palette.bg, borderColor: palette.border }}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-[1500px] mx-auto flex items-start gap-3">
        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${palette.icon}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            {announcement.title}
          </p>
          <p className="text-[12px] mt-1 whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {announcement.body}
          </p>
        </div>
      </div>
    </div>
  );
};
