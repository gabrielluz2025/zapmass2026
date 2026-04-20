import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = ''
}) => {
  return (
    <div className={`ui-card text-center py-16 px-6 flex flex-col items-center ${className}`}>
      {icon && (
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 brand-soft">
          {icon}
        </div>
      )}
      <h3 className="ui-title text-[16px] mb-1.5">{title}</h3>
      {description && (
        <p className="ui-subtitle text-[13.5px] max-w-md leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
};
