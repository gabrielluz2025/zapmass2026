import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Mic, MicOff, Paperclip, Send, Sparkles, Square, X } from 'lucide-react';
import type { WhatsAppConnection } from '../../types';
import { ConnectionStatus } from '../../types';

const ACCEPT = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt';

type Props = {
  disabled?: boolean;
  disabledHint?: string;
  sendingMedia?: boolean;
  onSend: (text: string) => void;
  onAttach?: (file: File, caption?: string) => void;
  onExport?: () => void;
  /** Função para gerar sugestões de resposta via IA */
  onGetAiSuggestions?: () => Promise<string[]>;
  isDraft?: boolean;
  draftChannels?: WhatsAppConnection[];
  draftChannelId?: string;
  onDraftChannelChange?: (connectionId: string) => void;
};

export const WaComposer: React.FC<Props> = ({
  disabled, disabledHint, sendingMedia,
  onSend, onAttach, onExport, onGetAiSuggestions,
  isDraft, draftChannels, draftChannelId, onDraftChannelChange,
}) => {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [loadingAi, setLoadingAi] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showChannelPicker = Boolean(isDraft && draftChannels && draftChannels.length > 1 && onDraftChannelChange);
  const busy = Boolean(sendingMedia);
  const blocked = disabled || (isDraft && !draftChannelId);
  const hasText = text.trim().length > 0;

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
    const t = (override ?? text).trim();
    if (!t || blocked || busy) return;
    onSend(t);
    setText('');
    setAiSuggestions([]);
    if (textRef.current) textRef.current.style.height = 'auto';
  };

  const pickFile = () => {
    if (blocked || busy || !onAttach) return;
    fileRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || blocked || !onAttach) return;
    const caption = text.trim() || undefined;
    if (caption) { setText(''); if (textRef.current) textRef.current.style.height = 'auto'; }
    onAttach(file, caption);
  };

  /* ── Gravação de áudio ── */
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
      alert('Acesso ao microfone negado. Verifique as permissões do navegador.');
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

  /* ── Sugestões de IA ── */
  const handleAiSuggest = async () => {
    if (!onGetAiSuggestions || loadingAi) return;
    setLoadingAi(true);
    setAiSuggestions([]);
    try {
      const suggestions = await onGetAiSuggestions();
      setAiSuggestions(suggestions);
    } catch {
      // silencioso
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

      {/* ── Chips de sugestão IA ── */}
      {(aiSuggestions.length > 0 || loadingAi) && (
        <div className="wa-ai-suggestions">
          {loadingAi ? (
            <div className="wa-ai-suggestions__loading">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>Gemini pensando…</span>
            </div>
          ) : (
            <>
              <Sparkles className="w-3 h-3 flex-shrink-0" style={{ color: '#818cf8' }} />
              {aiSuggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="wa-ai-chip"
                  onClick={() => submit(s)}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                className="wa-ai-suggestions__close"
                onClick={() => setAiSuggestions([])}
                title="Fechar sugestões"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Barra de gravação ── */}
      {recording && (
        <div className="wa-rec-bar">
          <span className="wa-rec-dot" />
          <span className="wa-rec-time">{fmtTime(recSeconds)}</span>
          <span className="wa-rec-label">Gravando…</span>
          <button type="button" className="wa-rec-cancel" onClick={cancelRecording} title="Cancelar">
            <MicOff className="w-3.5 h-3.5" /> Cancelar
          </button>
          <button type="button" className="wa-rec-stop" onClick={stopRecording} title="Enviar áudio">
            <Square className="w-3 h-3 fill-current" /> Enviar
          </button>
        </div>
      )}

      {/* ── Área de input ── */}
      {!recording && (
        <div className="wa-composer-row">
          <input ref={fileRef} type="file" className="sr-only" accept={ACCEPT} onChange={onFileChange} tabIndex={-1} />

          {onAttach && (
            <button
              type="button" className="wa-composer-btn"
              disabled={blocked || busy} onClick={pickFile}
              aria-label="Anexar" title="Foto, vídeo ou documento"
            >
              <Paperclip className="w-5 h-5" />
            </button>
          )}

          <textarea
            ref={textRef}
            className="wa-composer-input"
            rows={1}
            placeholder={
              busy ? 'Enviando…'
                : isDraft && !draftChannelId ? 'Escolha um canal acima'
                  : blocked && disabledHint ? disabledHint
                    : 'Digite uma mensagem'
            }
            value={text}
            disabled={blocked || busy}
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

          {/* Botão IA */}
          {onGetAiSuggestions && !hasText && !blocked && !busy && (
            <button
              type="button"
              className="wa-composer-btn wa-composer-btn--ai"
              onClick={handleAiSuggest}
              disabled={loadingAi}
              aria-label="Sugerir resposta com IA"
              title="Gemini: sugerir resposta"
            >
              {loadingAi
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Sparkles className="w-4 h-4" />
              }
            </button>
          )}

          {/* Mic ou Send */}
          {!hasText && onAttach && !blocked && !busy ? (
            <button
              type="button" className="wa-composer-btn wa-composer-btn--mic"
              onClick={startRecording} aria-label="Gravar áudio" title="Gravar mensagem de voz"
            >
              <Mic className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button" className="wa-composer-send"
              data-mode={hasText ? 'send' : undefined}
              disabled={blocked || busy || !hasText} onClick={() => submit()}
              aria-label="Enviar"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          )}

          {onExport && (
            <button
              type="button" className="wa-composer-btn"
              onClick={onExport} aria-label="Exportar conversa" title="Baixar conversa como texto"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </footer>
  );
};
