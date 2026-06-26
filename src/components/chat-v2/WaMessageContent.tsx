/**
 * Renderiza o conteúdo de uma bolha de mensagem.
 *
 * FIX CRÍTICO: o servidor retorna { ok: true, mediaUrl } mas o evento conversation-delta
 * às vezes não chega quando a mensagem não está na RAM da conversa.
 * Solução: guardar a URL retornada em estado local e usar como fallback de msg.mediaUrl.
 */
import React, { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import type { ChatMessage } from '../../types';

type Props = {
  msg: ChatMessage;
  onLoadMedia?: (messageId: string) => Promise<string | null>;
};

/** Botão placeholder enquanto a mídia não está carregada */
const MediaPlaceholder: React.FC<{
  label: string;
  icon: string;
  onClick: () => void;
  loading?: boolean;
}> = ({ label, icon, onClick, loading }) => (
  <button
    type="button"
    onClick={onClick}
    className="wa-media-placeholder"
    title="Carregar mídia do WhatsApp"
  >
    <span className="wa-media-placeholder__icon">
      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
    </span>
    <span className="wa-media-placeholder__label">{label}</span>
    {!loading && (
      <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 'auto', flexShrink: 0 }}>↓</span>
    )}
  </button>
);

export const WaMessageContent: React.FC<Props> = ({ msg, onLoadMedia }) => {
  // URL resolvida localmente — usada quando conversation-delta não chega
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const text = (msg.text || '').trim();
  const hasText = Boolean(text && text !== '[Mídia]');

  // URL final: prioridade para msg.mediaUrl (via socket delta), depois local, depois nada
  const mediaUrl = msg.mediaUrl || localUrl;

  const handleLoad = async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const url = await onLoadMedia(msg.id);
      if (url) {
        setLocalUrl(url);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // Autocarregamento automático de mídia (Auto-Load) idêntico ao WhatsApp Web!
  React.useEffect(() => {
    if (!mediaUrl && onLoadMedia && !loading && !loadFailed) {
      void handleLoad();
    }
  }, [mediaUrl, msg.id]);

  const failLabel = (base: string) =>
    loadFailed ? `${base} (falhou — toque para tentar novamente)` : base;

  /* ── Sticker ── */
  if (msg.type === 'sticker') {
    if (mediaUrl) return <img src={mediaUrl} alt="Figurinha" className="w-32 h-32 object-contain" />;
    return (
      <MediaPlaceholder
        label={failLabel('Figurinha')}
        icon="🌟"
        onClick={handleLoad}
        loading={loading}
      />
    );
  }

  /* ── Imagem ── */
  if (msg.type === 'image') {
    if (mediaUrl) {
      return (
        <div className="wa-media-image">
          <img
            src={mediaUrl}
            alt="Foto"
            loading="lazy"
            style={{ cursor: 'pointer', borderRadius: 8, maxWidth: '100%', display: 'block' }}
            onClick={() => window.open(mediaUrl, '_blank')}
          />
          {hasText && <p className="wa-media-caption">{text}</p>}
        </div>
      );
    }
    return (
      <MediaPlaceholder
        label={failLabel('Foto — toque para ver')}
        icon="📷"
        onClick={handleLoad}
        loading={loading}
      />
    );
  }

  /* ── Vídeo ── */
  if (msg.type === 'video') {
    if (mediaUrl) {
      return (
        <div className="wa-media-video">
          <video
            src={mediaUrl}
            controls
            preload="metadata"
            style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, display: 'block' }}
          />
          {hasText && <p className="wa-media-caption">{text}</p>}
        </div>
      );
    }
    return (
      <MediaPlaceholder
        label={failLabel('Vídeo — toque para ver')}
        icon="🎥"
        onClick={handleLoad}
        loading={loading}
      />
    );
  }

  /* ── Áudio — player real quando URL disponível ── */
  if (msg.type === 'audio') {
    if (mediaUrl) {
      return (
        <div className="wa-audio-player">
          <span className="wa-audio-player__icon">🎙️</span>
          <audio
            src={mediaUrl}
            controls
            preload="metadata"
            className="wa-audio-element"
            style={{ accentColor: '#25d366' }}
          />
        </div>
      );
    }
    return (
      <MediaPlaceholder
        label={failLabel('Áudio — toque para ouvir')}
        icon="🎙️"
        onClick={handleLoad}
        loading={loading}
      />
    );
  }

  /* ── Documento ── */
  if (msg.type === 'document') {
    if (mediaUrl) {
      return (
        <a
          href={mediaUrl}
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
    return (
      <MediaPlaceholder
        label={failLabel(text || 'Documento — toque para baixar')}
        icon="📄"
        onClick={handleLoad}
        loading={loading}
      />
    );
  }

  /* ── Texto simples ── */
  return <span style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{text}</span>;
};
