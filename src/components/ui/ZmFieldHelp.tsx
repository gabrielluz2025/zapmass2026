import React, { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

export type ZmFieldHelpProps = {
  /** Texto curto exibido no balão (pode incluir quebras com \n). */
  content: React.ReactNode;
  /** Rótulo acessível do botão (padrão: "Ajuda sobre este campo"). */
  ariaLabel?: string;
  /** Largura máxima do balão. */
  maxWidthClass?: string;
  className?: string;
};

/**
 * Ícone (i) reutilizável — tooltip/balão ao focar ou clicar.
 * Use ao lado de labels de formulário em telas comerciais.
 */
export const ZmFieldHelp: React.FC<ZmFieldHelpProps> = ({
  content,
  ariaLabel = 'Ajuda sobre este campo',
  maxWidthClass = 'max-w-[min(20rem,calc(100vw-2rem))]',
  className = ''
}) => {
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-500)]"
        style={{ color: 'var(--text-3)' }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className={`absolute z-[120] left-1/2 top-[calc(100%+6px)] -translate-x-1/2 ${maxWidthClass} rounded-xl px-3 py-2 text-[11.5px] leading-snug shadow-lg`}
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-2)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)'
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
};

type ZmFieldLabelProps = {
  children: React.ReactNode;
  help?: React.ReactNode;
  helpAriaLabel?: string;
  className?: string;
  htmlFor?: string;
};

/** Label + (i) opcional — padrão visual para formulários. */
export const ZmFieldLabel: React.FC<ZmFieldLabelProps> = ({
  children,
  help,
  helpAriaLabel,
  className = '',
  htmlFor
}) => (
  <label
    htmlFor={htmlFor}
    className={`inline-flex flex-wrap items-center gap-1.5 text-[13px] font-semibold ${className}`}
    style={{ color: 'var(--text-1)' }}
  >
    <span>{children}</span>
    {help ? <ZmFieldHelp content={help} ariaLabel={helpAriaLabel} /> : null}
  </label>
);
