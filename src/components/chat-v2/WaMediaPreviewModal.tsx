import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, Send, X } from 'lucide-react';

type Props = {
  file: File | null;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onSend: (caption: string) => void;
};

function fileKind(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
}

export const WaMediaPreviewModal: React.FC<Props> = ({ file, open, busy, onClose, onSend }) => {
  const [caption, setCaption] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const kind = file ? fileKind(file) : 'document';

  useEffect(() => {
    if (!file || !open) {
      setPreviewUrl(null);
      setCaption('');
      return;
    }
    if (kind === 'image' || kind === 'video') {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
    return undefined;
  }, [file, open, kind]);

  const title = useMemo(() => {
    if (!file) return '';
    return file.name || 'Anexo';
  }, [file]);

  if (!open || !file) return null;

  return (
    <div className="wa-media-preview-overlay" role="dialog" aria-modal="true">
      <div className="wa-media-preview">
        <header className="wa-media-preview__head">
          <span className="truncate font-medium">{title}</span>
          <button type="button" className="wa-icon-btn" onClick={onClose} disabled={busy} aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="wa-media-preview__body">
          {kind === 'image' && previewUrl && (
            <img src={previewUrl} alt="" className="wa-media-preview__img" />
          )}
          {kind === 'video' && previewUrl && (
            <video src={previewUrl} controls className="wa-media-preview__video" />
          )}
          {(kind === 'audio' || kind === 'document') && (
            <div className="wa-media-preview__doc">
              {kind === 'audio' ? <FileText className="w-10 h-10" /> : <ImageIcon className="w-10 h-10" />}
              <p className="text-sm mt-2">{file.name}</p>
              <p className="text-xs opacity-70">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
          )}
        </div>

        <footer className="wa-media-preview__foot">
          <input
            className="wa-media-preview__caption"
            placeholder="Legenda (opcional)"
            value={caption}
            disabled={busy}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend(caption.trim());
              }
            }}
          />
          <button
            type="button"
            className="wa-composer-send"
            data-mode="send"
            disabled={busy}
            onClick={() => onSend(caption.trim())}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </footer>
      </div>
    </div>
  );
};
