import React from 'react';

type PageShellProps = {
  /** Barra de chips / status (esquerda). Título da página fica no TopBar. */
  statusStrip?: React.ReactNode;
  /** Botões de ação (direita). */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export const PageShell: React.FC<PageShellProps> = ({ statusStrip, actions, children, className = '' }) => {
  const hasToolbar = Boolean(statusStrip || actions);
  return (
    <div className={`zm-page-shell ${className}`.trim()}>
      {hasToolbar && (
        <div className="zm-page-toolbar">
          {statusStrip ? <div className="zm-page-status">{statusStrip}</div> : <div />}
          {actions ? <div className="zm-page-actions">{actions}</div> : null}
        </div>
      )}
      <div className="zm-page-sections">{children}</div>
    </div>
  );
};
