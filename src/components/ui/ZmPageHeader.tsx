import React from 'react';

type ZmPageHeaderProps = {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export const ZmPageHeader: React.FC<ZmPageHeaderProps> = ({
  icon,
  title,
  subtitle,
  actions,
  footer,
  className = '',
}) => (
  <header className={`zm-page-header ${className}`.trim()}>
    <div className="zm-page-header__inner">
      <div className="zm-page-header__icon">{icon}</div>
      <div className="zm-page-header__body">
        <h1 className="zm-page-header__title">{title}</h1>
        {subtitle ? <p className="zm-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="zm-page-header__actions">{actions}</div> : null}
    </div>
    {footer ? <div className="zm-page-header__footer">{footer}</div> : null}
  </header>
);
