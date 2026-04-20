import React from 'react';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ leftIcon, rightIcon, size = 'md', className = '', containerClassName = '', ...rest }, ref) => {
    const sizeClass = size === 'lg' ? 'ui-input-lg' : size === 'sm' ? 'py-1.5 text-[12.5px]' : '';
    return (
      <div className={`relative ${containerClassName}`}>
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none flex">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          {...rest}
          className={`ui-input ui-focus-ring ${sizeClass} ${leftIcon ? 'pl-9' : ''} ${rightIcon ? 'pr-9' : ''} ${className}`}
        />
        {rightIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] flex">
            {rightIcon}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...rest }, ref) => {
    return (
      <textarea
        ref={ref}
        {...rest}
        className={`ui-input ui-focus-ring resize-none ${className}`}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', children, ...rest }, ref) => {
    return (
      <select
        ref={ref}
        {...rest}
        className={`ui-input ui-focus-ring pr-9 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat ${className}`}
        style={{
          backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`
        }}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';
