import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui';

type Props = {
  label?: string;
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost';
  onClick: () => void;
  title?: string;
};

/** Botão padrão para ações com Gemini (assistente IA). */
export const AiSparkButton: React.FC<Props> = ({
  label = 'IA organizar',
  loading = false,
  disabled = false,
  size = 'sm',
  variant = 'secondary',
  onClick,
  title,
}) => (
  <Button
    type="button"
    size={size}
    variant={variant}
    disabled={disabled || loading}
    loading={loading}
    leftIcon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
    onClick={onClick}
    title={title}
    className="zm-ai-spark-btn"
  >
    {label}
  </Button>
);
