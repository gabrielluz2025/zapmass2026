import React, { useRef, useState } from 'react';
import { Send, Smile } from 'lucide-react';

type Props = {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
};

export const WaComposer: React.FC<Props> = ({
  disabled,
  placeholder = 'Digite uma mensagem',
  onSend
}) => {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  return (
    <div className="wa-v2-composer">
      <button
        type="button"
        className="p-2 rounded-full opacity-60 hover:opacity-100"
        aria-label="Emoji"
        disabled={disabled}
      >
        <Smile className="w-6 h-6" style={{ color: 'var(--wv2-text-3)' }} />
      </button>
      <textarea
        ref={ref}
        className="wa-v2-composer-input"
        rows={1}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.target;
          el.style.height = 'auto';
          el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="wa-v2-send-btn"
        disabled={disabled || !text.trim()}
        onClick={submit}
        aria-label="Enviar"
      >
        <Send className="w-5 h-5" />
      </button>
    </div>
  );
};
