import React from 'react';
import { X } from 'lucide-react';

interface WaContactDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Drawer lateral direito estilo WA Web: aparece sobre a área da conversa,
 * com header próprio e overlay clicável para fechar. Usado para abrigar
 * o ClientCrmPanel, a auditoria de origem das conversas e a faixa de
 * pipeline (sent/delivered/read/replies) — tudo o que antes ocupava a
 * área principal e poluía a aparência de "WhatsApp Web".
 */
export const WaContactDrawer: React.FC<WaContactDrawerProps> = ({
  open,
  title,
  subtitle,
  onClose,
  children
}) => {
  if (!open) return null;
  return (
    <>
      <div
        className="wa-drawer-overlay"
        onClick={onClose}
        role="presentation"
        aria-hidden="true"
      />
      <aside className="wa-drawer" role="dialog" aria-label={title}>
        <header className="wa-drawer-header">
          <button type="button" className="wa-icon-btn" onClick={onClose} aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-medium leading-tight" style={{ color: 'var(--wa-text)' }}>
              {title}
            </p>
            {subtitle && (
              <p
                className="text-[12.5px] mt-0.5 truncate"
                style={{ color: 'var(--wa-text-3)' }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </header>
        <div className="wa-drawer-body">{children}</div>
      </aside>
    </>
  );
};
