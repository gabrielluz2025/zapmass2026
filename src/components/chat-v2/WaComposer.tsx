import React, { useRef, useState } from 'react';
import { Loader2, Paperclip, Send } from 'lucide-react';
import type { WhatsAppConnection } from '../../types';
import { ConnectionStatus } from '../../types';

const ACCEPT =
  'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt';

type Props = {
  disabled?: boolean;
  disabledHint?: string;
  sendingMedia?: boolean;
  onSend: (text: string) => void;
  onAttach?: (file: File, caption?: string) => void;
  /** Rascunho sem conversa real — escolher chip antes do 1º envio. */
  isDraft?: boolean;
  draftChannels?: WhatsAppConnection[];
  draftChannelId?: string;
  onDraftChannelChange?: (connectionId: string) => void;
};

export const WaComposer: React.FC<Props> = ({
  disabled,
  disabledHint,
  sendingMedia,
  onSend,
  onAttach,
  isDraft,
  draftChannels,
  draftChannelId,
  onDraftChannelChange
}) => {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showChannelPicker =
    Boolean(isDraft && draftChannels && draftChannels.length > 1 && onDraftChannelChange);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled || sendingMedia) return;
    if (isDraft && !draftChannelId) return;
    onSend(t);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  const pickFile = () => {
    if (disabled || sendingMedia || !onAttach) return;
    if (isDraft && !draftChannelId) return;
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
  const blocked = disabled || (isDraft && !draftChannelId);

  return (
    <footer className="wa-composer">
      {showChannelPicker && (
        <div className="wa-connection-bar border-t border-[var(--wa-divider,#e9edef)]">
          <label className="wa-connection-bar-label" htmlFor="wa-draft-channel">
            Canal para enviar
          </label>
          <select
            id="wa-draft-channel"
            className="wa-connection-select"
            value={draftChannelId || ''}
            onChange={(e) => onDraftChannelChange?.(e.target.value)}
          >
            <option value="">Escolher canal…</option>
            {draftChannels!.map((c) => (
              <option key={c.id} value={c.id} disabled={c.status !== ConnectionStatus.CONNECTED}>
                {c.name}
                {c.status !== ConnectionStatus.CONNECTED ? ' (offline)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-end gap-1 px-2 py-2">
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
              disabled={blocked || busy}
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
          className="wa-composer-input flex-1"
          rows={1}
          placeholder={
            busy
              ? 'Enviando arquivo…'
              : isDraft && !draftChannelId
                ? 'Escolha um canal acima para enviar'
                : blocked && disabledHint
                  ? disabledHint
                  : 'Digite uma mensagem'
          }
          value={text}
          disabled={blocked || busy}
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
          disabled={blocked || busy || !text.trim()}
          onClick={submit}
          aria-label="Enviar mensagem"
        >
          {busy ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" strokeWidth={2} />
          )}
        </button>
      </div>
    </footer>
  );
};
