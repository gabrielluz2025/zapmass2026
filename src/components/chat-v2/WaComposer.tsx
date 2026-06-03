import React, { useRef, useState } from 'react';
import { Loader2, Paperclip, Send } from 'lucide-react';

const ACCEPT =
  'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt';

type Props = {
  disabled?: boolean;
  disabledHint?: string;
  sendingMedia?: boolean;
  onSend: (text: string) => void;
  onAttach?: (file: File, caption?: string) => void;
};

export const WaComposer: React.FC<Props> = ({
  disabled,
  disabledHint,
  sendingMedia,
  onSend,
  onAttach
}) => {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled || sendingMedia) return;
    onSend(t);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  const pickFile = () => {
    if (disabled || sendingMedia || !onAttach) return;
    fileRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || disabled || !onAttach) return;
    const caption = text.trim() || undefined;
    if (caption) {
      setText('');
      if (ref.current) ref.current.style.height = 'auto';
    }
    onAttach(file, caption);
  };

  const busy = Boolean(sendingMedia);

  return (
    <footer className="wa-composer">
      {onAttach && (
        <>
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept={ACCEPT}
            onChange={onFileChange}
            tabIndex={-1}
          />
          <button
            type="button"
            className="wa-composer-attach"
            disabled={disabled || busy}
            onClick={pickFile}
            aria-label="Anexar arquivo"
            title="Anexar imagem, vídeo ou documento"
          >
            <Paperclip className="w-5 h-5" strokeWidth={2} />
          </button>
        </>
      )}
      <textarea
        ref={ref}
        className="wa-composer-input"
        rows={1}
        placeholder={
          busy
            ? 'Enviando arquivo…'
            : disabled && disabledHint
              ? disabledHint
              : 'Digite uma mensagem'
        }
        value={text}
        disabled={disabled || busy}
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
        className="wa-composer-send"
        data-mode={text.trim() ? 'send' : undefined}
        disabled={disabled || busy || !text.trim()}
        onClick={submit}
        aria-label="Enviar mensagem"
      >
        {busy ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Send className="w-5 h-5" strokeWidth={2} />
        )}
      </button>
    </footer>
  );
};
