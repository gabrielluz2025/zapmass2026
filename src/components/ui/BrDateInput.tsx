import React from 'react';
import { Input } from './Input';
import { maskBrDateInput } from '../../utils/brDateMask';

export type BrDateInputProps = Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value' | 'type' | 'inputMode'> & {
  value: string;
  onValueChange: (next: string) => void;
};

/**
 * Campo de data só com dígitos; insere `/` automaticamente (DD/MM/AAAA).
 */
export const BrDateInput = React.forwardRef<HTMLInputElement, BrDateInputProps>(
  ({ value, onValueChange, placeholder = 'DD/MM/AAAA', maxLength = 10, ...rest }, ref) => (
    <Input
      ref={ref}
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      maxLength={maxLength}
      value={value}
      onChange={(e) => onValueChange(maskBrDateInput(e.target.value))}
    />
  )
);
BrDateInput.displayName = 'BrDateInput';
