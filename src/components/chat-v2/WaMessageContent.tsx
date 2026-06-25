import React, { useState } from 'react';
import { ArrowDown, Download, FileText, Loader2, Play } from 'lucide-react';
import type { ChatMessage } from '../../types';

type Props = {
  msg: ChatMessage;
  onLoadMedia?: (messageId: string) => void;
};

/** Botão placeholder enquanto a mídia não está carregada */
const MediaPlaceholder: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
}> = ({ label, icon, onClick, loading }) => (
  <button
    type="button"
    onClick={onClick}
    className="wa-media-placeholder"
    title="Carregar mídia"
  >
    <span className="wa-media-placeholder__icon">{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}</span>
    <span className="wa-media-placeholder__label">{label}</span>
    {!loading && <ArrowDown className="w-3.5 h-3.5 ml-auto opacity-50 flex-shrink-0" />}
  </button>
);

export const WaMessageContent: React.FC<Props> = ({ msg, onLoadMedia }) => {
  const [loading, setLoading] = useState(false);
  const text = (msg.text || '').trim();
  const hasText = Boolean(text && text !== '[Mídia]');

  const handleLoad = async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    try {
      await onLoadMedia(msg.id);
    } finally {
      setLoading(false);
    }
  };

  /* ── Sticker ── */
  if (msg.type === 'sticker') {
    if (msg.mediaUrl) return <img src={msg.mediaUrl} alt="Figurinha" className="w-32 h-32 object-contain" />;
    return <MediaPlaceholder label="Figurinha" icon="🌟" onClick={handleLoad} loading={loading} />;
  }

  /* ── Imagem ── */
  if (msg.type === 'image') {
    if (msg.mediaUrl) {
      return (
        <div className="wa-media-image">
          <img
            src={msg.mediaUrl}
            alt="Foto"
            loading="lazy"
            style={{ cursor: 'pointer' }}
            onClick={() => window.open(msg.mediaUrl!, '_blank')}
          />
          {hasText && <p className="wa-media-caption">{text}</p>}
        </div>
      );
    }
    return <MediaPlaceholder label="Foto — toque para ver" icon="📷" onClick={handleLoad} loading={loading} />;
  }

  /* ── Vídeo ── */
  if (msg.type === 'video') {
    if (msg.mediaUrl) {
      return (
        <div className="wa-media-video">
          <video src={msg.mediaUrl} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: 300 }} />
          {hasText && <p className="wa-media-caption">{text}</p>}
        </div>
      );
    }
    return <MediaPlaceholder label="Vídeo — toque para ver" icon="🎥" onClick={handleLoad} loading={loading} />;
  }

  /* ── Áudio — player real quando carregado ── */
  if (msg.type === 'audio') {
    if (msg.mediaUrl) {
      return (
        <div className="wa-audio-player">
          <span className="wa-audio-player__icon">🎙️</span>
          <audio
            src={msg.mediaUrl}
            controls
            preload="metadata"
            className="wa-audio-element"
          />
        </div>
      );
    }
    return <MediaPlaceholder label="Áudio — toque para ouvir" icon="🎙️" onClick={handleLoad} loading={loading} />;
  }

  /* ── Documento ── */
  if (msg.type === 'document') {
    if (msg.mediaUrl) {
      return (
        <a
          href={msg.mediaUrl}
          download
          target="_blank"
          rel="noreferrer"
          className="wa-media-document"
        >
          <div className="wa-media-document__icon">
            <FileText className="w-6 h-6" />
          </div>
          <div className="wa-media-document__info">
            <p className="wa-media-document__name">{text || 'Documento'}</p>
            <p className="wa-media-document__hint">Toque para baixar</p>
          </div>
          <Download className="w-4 h-4 flex-shrink-0 opacity-60" />
        </a>
      );
    }
    return <MediaPlaceholder label={text || 'Documento — toque para baixar'} icon="📄" onClick={handleLoad} loading={loading} />;
  }

  /* ── Texto ── */
  return <span style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{text}</span>;
};
