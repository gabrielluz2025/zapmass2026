/**
 * Renderiza o conteúdo de uma bolha de mensagem.
 *
 * FIX CRÍTICO: o servidor retorna { ok: true, mediaUrl } mas o evento conversation-delta
 * às vezes não chega quando a mensagem não está na RAM da conversa.
 * Solução: guardar a URL retornada em estado local e usar como fallback de msg.mediaUrl.
 */
import React, { useState } from 'react';
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  RefreshCw,
  Sticker,
  Video,
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

const MEDIA_LABELS: Record<MediaKind, string> = {
  audio: 'Mensagem de voz',
  image: 'Foto',
  video: 'Vídeo',
  document: 'Documento',
  sticker: 'Figurinha',
};

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

function MediaIcon({ kind }: { kind: MediaKind }) {
  const cls = 'wa-media-ph__svg';
  switch (kind) {
    case 'audio':
      return <Mic className={cls} strokeWidth={2} />;
    case 'image':
      return <ImageIcon className={cls} strokeWidth={2} />;
    case 'video':
      return <Video className={cls} strokeWidth={2} />;
    case 'document':
      return <FileText className={cls} strokeWidth={2} />;
    default:
      return <Sticker className={cls} strokeWidth={2} />;
  }
}

function docExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 1 || dot === name.length - 1) return 'DOC';
  return name.slice(dot + 1).slice(0, 4).toUpperCase();
}

/** Placeholder compacto enquanto a mídia não está carregada */
const MediaPlaceholder: React.FC<{
  kind: MediaKind;
  title?: string;
  onClick: () => void;
  loading?: boolean;
  failed?: boolean;
}> = ({ kind, title, onClick, loading, failed }) => {
  const label = title?.trim() || MEDIA_LABELS[kind];
  const hint = loading ? 'Carregando…' : failed ? 'Toque para tentar de novo' : 'Toque para abrir';

  return (
    <button
      type="button"
      onClick={onClick}
      className="wa-media-ph"
      data-kind={kind}
      data-failed={failed ? 'true' : 'false'}
      title={failed ? 'Falha ao carregar — tentar novamente' : 'Carregar mídia do WhatsApp'}
      disabled={loading}
    >
      <span className="wa-media-ph__icon">
        {loading ? (
          <Loader2 className="wa-media-ph__svg wa-media-ph__spin" strokeWidth={2} />
        ) : failed ? (
          <RefreshCw className="wa-media-ph__svg" strokeWidth={2} />
        ) : (
          <MediaIcon kind={kind} />
        )}
      </span>
      <span className="wa-media-ph__text">
        <span className="wa-media-ph__title">{label}</span>
        <span className="wa-media-ph__hint">{hint}</span>
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

  React.useEffect(() => {
    if (!mediaUrl && onLoadMedia && !loading && !loadFailed) {
      setLoading(true);
      setLoadFailed(false);
      onLoadMedia(msg.id, true)
        .then((url) => {
          if (url) setLocalUrl(url);
          else setLoadFailed(true);
        })
        .catch(() => setLoadFailed(true))
        .finally(() => setLoading(false));
    }
  }, [mediaUrl, msg.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ph = (kind: MediaKind, title?: string) => (
    <MediaPlaceholder
      kind={kind}
      title={title}
      onClick={handleLoad}
      loading={loading}
      failed={loadFailed}
    />
  );

  if (msg.type === 'sticker') {
    if (mediaUrl) {
      return <img src={mediaUrl} alt="Figurinha" className="wa-media-sticker" />;
    }
    return ph('sticker');
  }

  if (msg.type === 'image') {
    if (mediaUrl) {
      return (
        <div className={`wa-media-block wa-media-block--image${hasText ? ' wa-media-block--caption' : ''}`}>
          <button
            type="button"
            className="wa-media-block__visual"
            onClick={() => window.open(mediaUrl, '_blank')}
            aria-label="Abrir foto em tamanho real"
          >
            <img src={mediaUrl} alt="Foto" loading="lazy" />
          </button>
          {hasText && <p className="wa-media-caption">{highlightText(text, searchHighlight || '')}</p>}
        </div>
      );
    }
    return ph('image');
  }

  if (msg.type === 'video') {
    if (mediaUrl) {
      return (
        <div className={`wa-media-block wa-media-block--video${hasText ? ' wa-media-block--caption' : ''}`}>
          <video src={mediaUrl} controls preload="metadata" className="wa-media-block__visual" />
          {hasText && <p className="wa-media-caption">{highlightText(text, searchHighlight || '')}</p>}
        </div>
      );
    }
    return ph('video');
  }

  if (msg.type === 'audio') {
    if (mediaUrl) return <WaAudioPlayer src={mediaUrl} side={side} />;
    return ph('audio');
  }

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
    return ph('document', name);
  }

  if (!text) {
    return <span className="wa-text-body wa-text-body--muted">Mensagem recebida</span>;
  }

  return (
    <span className="wa-text-body">{highlightText(text, searchHighlight || '')}</span>
  );
};

/** Tipos que usam layout de mídia na bolha (padding reduzido). */
export function messageMediaLayout(msg: ChatMessage): 'visual' | 'compact' | null {
  if (msg.type === 'image' || msg.type === 'video' || msg.type === 'sticker') return 'visual';
  if (msg.type === 'audio' || msg.type === 'document') return 'compact';
  return null;
}
