import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
}

const sizeClass = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl'
};

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => closeOnBackdrop && onClose()}
      />
      <div
        className={`relative w-full ${sizeClass[size]} rounded-2xl overflow-hidden shadow-2xl`}
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
      >
        {(title || icon) && (
          <div className="flex items-start justify-between gap-4 px-6 py-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {icon && (
                <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center brand-soft">
                  {icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {title && <h2 className="ui-title text-[17px]">{title}</h2>}
                {subtitle && <p className="ui-subtitle mt-1">{subtitle}</p>}
              </div>
            </div>
            <button
              onClick={onClose}
              className="ui-btn ui-btn-ghost ui-btn-icon ui-focus-ring"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
