import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Paperclip, Send, Smile, Square, X } from 'lucide-react';
import type { WhatsAppConnection } from '../../types';
import { ConnectionStatus } from '../../types';
import { WaEmojiPicker } from './WaEmojiPicker';
import { WaQuotePreview } from './WaMessageTools';
import type { ChatMessage } from '../../types';
import {
  clearConversationDraft,
  loadConversationDraft,
  saveConversationDraft,
} from '../../utils/chatConversationDraft';

const ACCEPT = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt';

type Props = {
  conversationId?: string;
  disabled?: boolean;
  disabledHint?: string;
  sendingMedia?: boolean;
  quoteMessage?: ChatMessage | null;
  onClearQuote?: () => void;
  onSend: (text: string) => void;
  onAttach?: (file: File, caption?: string) => void;
  onPickFileForPreview?: (file: File) => void;
  onExport?: () => void;
  onGetAiSuggestions?: () => Promise<string[]>;
  isDraft?: boolean;
  draftChannels?: WhatsAppConnection[];
  draftChannelId?: string;
  onDraftChannelChange?: (connectionId: string) => void;
};

export const WaComposer: React.FC<Props> = ({
  conversationId,
  disabled,
  disabledHint,
  sendingMedia,
  quoteMessage,
  onClearQuote,
  onSend,
  onAttach,
  onPickFileForPreview,
  onExport,
  onGetAiSuggestions,
  isDraft,
  draftChannels,
  draftChannelId,
  onDraftChannelChange,
}) => {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [loadingAi, setLoadingAi] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevConvRef = useRef<string | undefined>(undefined);

  const showChannelPicker = Boolean(isDraft && draftChannels && draftChannels.length > 1 && onDraftChannelChange);
  const busy = Boolean(sendingMedia);
  const blocked = disabled || (isDraft && !draftChannelId);
  const hasText = text.trim().length > 0;

  useEffect(() => {
    if (prevConvRef.current && prevConvRef.current !== conversationId) {
      saveConversationDraft(prevConvRef.current, text);
    }
    prevConvRef.current = conversationId;
    if (conversationId) {
      setText(loadConversationDraft(conversationId));
    } else {
      setText('');
    }
    setAiSuggestions([]);
    if (textRef.current) textRef.current.style.height = 'auto';
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const t = window.setTimeout(() => saveConversationDraft(conversationId, text), 400);
    return () => window.clearTimeout(t);
  }, [conversationId, text]);

  useEffect(() => {
    if (recording) {
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecSeconds(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  const submit = (override?: string) => {
    const raw = (override ?? text).trim();
    if (!raw || blocked || busy) return;
    let payload = raw;
    if (quoteMessage?.text) {
      const q = quoteMessage.text.trim().slice(0, 200);
      payload = `> ${q}\n\n${raw}`;
    }
    onSend(payload);
    setText('');
    if (conversationId) clearConversationDraft(conversationId);
    setAiSuggestions([]);
    onClearQuote?.();
    if (textRef.current) textRef.current.style.height = 'auto';
  };

  const pickFile = () => {
    if (blocked || busy || (!onAttach && !onPickFileForPreview)) return;
    fileRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || blocked) return;
    if (onPickFileForPreview) {
      onPickFileForPreview(file);
      return;
    }
    if (!onAttach) return;
    const caption = text.trim() || undefined;
    if (caption) { setText(''); if (textRef.current) textRef.current.style.height = 'auto'; }
    onAttach(file, caption);
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    textRef.current?.focus();
  };

  const startRecording = async () => {
    if (blocked || busy || !onAttach) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const file = new File([blob], `audio_${Date.now()}.webm`, { type: mimeType });
        onAttach(file);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(200);
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      alert('Acesso ao microfone negado.');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const cancelRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    chunksRef.current = [];
    setRecording(false);
  };

  const handleAiSuggest = async () => {
    if (!onGetAiSuggestions || loadingAi) return;
    setLoadingAi(true);
    setAiSuggestions([]);
    try {
      const suggestions = await onGetAiSuggestions();
      setAiSuggestions(suggestions);
    } finally {
      setLoadingAi(false);
    }
  };

  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <footer className="wa-composer">
      {showChannelPicker && (
        <div className="wa-connection-bar" style={{ borderTop: '1px solid var(--wa-divider)' }}>
          <label className="wa-connection-bar-label" htmlFor="wa-draft-channel">Canal para enviar</label>
          <select
            id="wa-draft-channel"
            className="wa-connection-select"
            value={draftChannelId || ''}
            onChange={(e) => onDraftChannelChange?.(e.target.value)}
          >
            <option value="">Escolher canal…</option>
            {draftChannels!.map((c) => (
              <option key={c.id} value={c.id} disabled={c.status !== ConnectionStatus.CONNECTED}>
                {c.name}{c.status !== ConnectionStatus.CONNECTED ? ' (offline)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <WaQuotePreview quote={quoteMessage ?? null} onClear={() => onClearQuote?.()} />

      {recording && (
        <div className="wa-rec-bar">
          <span className="wa-rec-dot" />
          <span className="wa-rec-time">{fmtTime(recSeconds)}</span>
          <span className="wa-rec-label">Gravando…</span>
          <button type="button" className="wa-rec-cancel" onClick={cancelRecording}><MicOff className="w-3.5 h-3.5" /> Cancelar</button>
          <button type="button" className="wa-rec-stop" onClick={stopRecording}><Square className="w-3 h-3 fill-current" /> Enviar</button>
        </div>
      )}

      {!recording && (
        <div className="wa-composer-row">
          <input ref={fileRef} type="file" className="sr-only" accept={ACCEPT} onChange={onFileChange} tabIndex={-1} />

          {blocked && disabledHint && (
            <p id="wa-composer-blocked-hint" className="wa-composer-blocked" role="status">
              {disabledHint}
            </p>
          )}

          {(onAttach || onPickFileForPreview) && (
            <button type="button" className="wa-composer-btn" disabled={blocked || busy} onClick={pickFile} aria-label="Anexar">
              <Paperclip className="w-5 h-5" />
            </button>
          )}

          <div className="relative flex-1 min-w-0">
            <textarea
              ref={textRef}
              className="wa-composer-input"
              rows={1}
              placeholder={
                busy ? 'Enviando…'
                  : isDraft && !draftChannelId ? 'Escolha o canal acima'
                    : 'Digite uma mensagem'
              }
              value={text}
              disabled={blocked || busy}
              aria-describedby={blocked && disabledHint ? 'wa-composer-blocked-hint' : undefined}
              onChange={(e) => {
                setText(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                if (aiSuggestions.length > 0) setAiSuggestions([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
            />
            <WaEmojiPicker open={emojiOpen} onClose={() => setEmojiOpen(false)} onPick={insertEmoji} />
          </div>

          <button
            type="button"
            className="wa-composer-btn wa-composer-btn--emoji"
            disabled={blocked || busy}
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Emoji"
          >
            <Smile className="w-5 h-5" />
          </button>

          {!hasText && onAttach && !blocked && !busy ? (
            <button type="button" className="wa-composer-btn wa-composer-btn--mic" onClick={startRecording} aria-label="Gravar áudio">
              <Mic className="w-5 h-5" />
            </button>
          ) : (
            <button type="button" className="wa-composer-send" data-mode={hasText ? 'send' : undefined} disabled={blocked || busy || !hasText} onClick={() => submit()}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          )}
        </div>
      )}
    </footer>
  );
};
