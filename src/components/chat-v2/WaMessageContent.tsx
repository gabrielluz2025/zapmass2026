/**
 * Renderiza o conteúdo de uma bolha de mensagem.
 * Visual idêntico ao WhatsApp Web.
 */
import React, { useState } from 'react';
import {
  Download,
  FileText,
  Loader2,
  Mic,
  Play,
  RefreshCw,
} from 'lucide-react';
import type { ChatMessage } from '../../types';
import { WaAudioPlayer } from './WaAudioPlayer';

type Props = {
  msg: ChatMessage;
  side?: 'in' | 'out';
  onLoadMedia?: (messageId: string, silent?: boolean) => Promise<string | null>;
  searchHighlight?: string;
};

type MediaKind = 'audio' | 'image' | 'video' | 'document' | 'sticker';

function highlightText(text: string, needle: string): React.ReactNode {
  const q = needle.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="wa-search-hit">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function docExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 1 || dot === name.length - 1) return 'DOC';
  return name.slice(dot + 1).slice(0, 4).toUpperCase();
}

/** Placeholder visual de imagem/vídeo — quadrado cinza como no WA Web */
const ImageVideoPlaceholder: React.FC<{
  kind: 'image' | 'video' | 'sticker';
  loading?: boolean;
  failed?: boolean;
  onClick: () => void;
}> = ({ kind, loading, failed, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="wa-media-thumb-ph"
    disabled={loading}
    title={failed ? 'Falha ao carregar — tentar novamente' : 'Carregar mídia'}
  >
    <div className="wa-media-thumb-ph__icon">
      {loading ? (
        <Loader2 size={26} className="wa-media-ph__spin" strokeWidth={2} />
      ) : failed ? (
        <RefreshCw size={26} strokeWidth={2} />
      ) : kind === 'video' ? (
        <Play size={26} strokeWidth={2} fill="currentColor" />
      ) : (
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )}
    </div>
    {failed && (
      <span className="wa-media-thumb-ph__label">Toque para recarregar</span>
    )}
  </button>
);

/** Placeholder inline compacto (áudio, documento) */
const InlinePlaceholder: React.FC<{
  kind: 'audio' | 'document';
  title?: string;
  loading?: boolean;
  failed?: boolean;
  onClick: () => void;
}> = ({ kind, title, loading, failed, onClick }) => {
  const label = title?.trim() || (kind === 'audio' ? 'Mensagem de voz' : 'Documento');
  return (
    <button
      type="button"
      onClick={onClick}
      className="wa-media-ph"
      data-kind={kind}
      data-failed={failed ? 'true' : 'false'}
      disabled={loading}
      title={failed ? 'Tentar novamente' : 'Carregar mídia'}
    >
      <span className="wa-media-ph__icon">
        {loading ? (
          <Loader2 className="wa-media-ph__svg wa-media-ph__spin" strokeWidth={2} />
        ) : failed ? (
          <RefreshCw className="wa-media-ph__svg" strokeWidth={2} />
        ) : kind === 'audio' ? (
          <Mic className="wa-media-ph__svg" strokeWidth={2} />
        ) : (
          <FileText className="wa-media-ph__svg" strokeWidth={2} />
        )}
      </span>
      <span className="wa-media-ph__text">
        <span className="wa-media-ph__title">{label}</span>
        <span className="wa-media-ph__hint">
          {loading ? 'Carregando…' : failed ? 'Toque para tentar' : 'Toque para abrir'}
        </span>
      </span>
    </button>
  );
};

export const WaMessageContent: React.FC<Props> = ({
  msg,
  side = 'in',
  onLoadMedia,
  searchHighlight,
}) => {
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const text = (msg.text || '').trim();
  const hasText = Boolean(text && text !== '[Mídia]');
  const mediaUrl = msg.mediaUrl || localUrl;

  const handleLoad = async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const url = await onLoadMedia(msg.id);
      if (url) setLocalUrl(url);
      else setLoadFailed(true);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // Auto-load silencioso para mensagens sem URL
  React.useEffect(() => {
    if (!mediaUrl && onLoadMedia && !loading && !loadFailed) {
      setLoading(true);
      onLoadMedia(msg.id, true)
        .then((url) => {
          if (url) setLocalUrl(url);
          else setLoadFailed(true);
        })
        .catch(() => setLoadFailed(true))
        .finally(() => setLoading(false));
    }
  }, [mediaUrl, msg.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sticker ── */
  if (msg.type === 'sticker') {
    if (mediaUrl) return <img src={mediaUrl} alt="Figurinha" className="wa-media-sticker" />;
    return (
      <ImageVideoPlaceholder
        kind="sticker"
        loading={loading}
        failed={loadFailed}
        onClick={handleLoad}
      />
    );
  }

  /* ── Imagem ── */
  if (msg.type === 'image') {
    if (mediaUrl) {
      return (
        <div className={`wa-media-block wa-media-block--image${hasText ? ' wa-media-block--caption' : ''}`}>
          <button
            type="button"
            className="wa-media-block__visual"
            onClick={() => window.open(mediaUrl, '_blank')}
            aria-label="Abrir foto"
          >
            <img src={mediaUrl} alt="Foto" loading="lazy" />
          </button>
          {hasText && <p className="wa-media-caption">{highlightText(text, searchHighlight || '')}</p>}
        </div>
      );
    }
    return (
      <ImageVideoPlaceholder
        kind="image"
        loading={loading}
        failed={loadFailed}
        onClick={handleLoad}
      />
    );
  }

  /* ── Vídeo ── */
  if (msg.type === 'video') {
    if (mediaUrl) {
      return (
        <div className={`wa-media-block wa-media-block--video${hasText ? ' wa-media-block--caption' : ''}`}>
          <video src={mediaUrl} controls preload="metadata" className="wa-media-block__visual" />
          {hasText && <p className="wa-media-caption">{highlightText(text, searchHighlight || '')}</p>}
        </div>
      );
    }
    return (
      <ImageVideoPlaceholder
        kind="video"
        loading={loading}
        failed={loadFailed}
        onClick={handleLoad}
      />
    );
  }

  /* ── Áudio ── */
  if (msg.type === 'audio') {
    if (mediaUrl) return <WaAudioPlayer src={mediaUrl} side={side} />;
    return (
      <InlinePlaceholder
        kind="audio"
        loading={loading}
        failed={loadFailed}
        onClick={handleLoad}
      />
    );
  }

  /* ── Documento ── */
  if (msg.type === 'document') {
    const name = text && text !== '[Mídia]' ? text : 'Documento';
    if (mediaUrl) {
      return (
        <a href={mediaUrl} download target="_blank" rel="noreferrer" className="wa-doc">
          <span className="wa-doc__badge">{docExtension(name)}</span>
          <span className="wa-doc__info">
            <span className="wa-doc__name">{name}</span>
            <span className="wa-doc__meta">Documento</span>
          </span>
          <Download className="wa-doc__dl" strokeWidth={2} />
        </a>
      );
    }
    return (
      <InlinePlaceholder
        kind="document"
        title={name}
        loading={loading}
        failed={loadFailed}
        onClick={handleLoad}
      />
    );
  }

  /* ── Texto ── */
  if (!text) {
    return <span className="wa-text-body wa-text-body--muted">Mensagem recebida</span>;
  }

  return <span className="wa-text-body">{highlightText(text, searchHighlight || '')}</span>;
};

/** Tipos que usam layout de mídia na bolha (padding reduzido). */
export function messageMediaLayout(msg: ChatMessage): 'visual' | 'compact' | null {
  if (msg.type === 'image' || msg.type === 'video' || msg.type === 'sticker') return 'visual';
  if (msg.type === 'audio' || msg.type === 'document') return 'compact';
  return null;
}
