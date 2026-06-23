import React from 'react';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage } from '../../types';

type Props = {
  msg: ChatMessage;
  onLoadMedia?: (messageId: string) => void;
};

export const WaMessageContent: React.FC<Props> = ({ msg, onLoadMedia }) => {
  const text = (msg.text || '').trim();
  const hasText = Boolean(text && text !== '[Mídia]');
  const isMedia = msg.type !== 'text';

  const placeholder = (label: string, icon: string) => (
    <button
      type="button"
      onClick={() => onLoadMedia?.(msg.id)}
      className="flex items-center gap-2 p-2 rounded-md mb-1 transition-colors hover:bg-black/10 w-full text-left"
      style={{ background: 'rgba(0,0,0,0.06)', minWidth: 160 }}
      title="Carregar mídia do WhatsApp"
    >
      <span className="text-lg">{icon}</span>
      <span className="text-[12px] opacity-80 truncate">{label}</span>
      <ArrowDown className="w-3 h-3 ml-auto opacity-60" />
    </button>
  );

  if (msg.type === 'sticker' && msg.mediaUrl) {
    return <img src={msg.mediaUrl} alt="" className="w-32 h-32 object-contain" />;
  }
  if (msg.type === 'image' && msg.mediaUrl) {
    return (
      <div className="rounded-md overflow-hidden mb-1" style={{ maxWidth: 330 }}>
        <img
          src={msg.mediaUrl}
          alt=""
          className="w-full object-cover"
          style={{ minHeight: 100, maxHeight: 330 }}
        />
        {hasText ? (
          <p className="mt-1 text-[14px] whitespace-pre-wrap break-words">{text}</p>
        ) : null}
      </div>
    );
  }
  if (msg.type === 'video' && msg.mediaUrl) {
    return (
      <div className="rounded-md overflow-hidden mb-1" style={{ maxWidth: 330 }}>
        <video src={msg.mediaUrl} controls className="w-full" style={{ maxHeight: 280 }} />
        {hasText ? (
          <p className="mt-1 text-[14px] whitespace-pre-wrap break-words">{text}</p>
        ) : null}
      </div>
    );
  }
  if (msg.type === 'document' && msg.mediaUrl) {
    return (
      <a
        href={msg.mediaUrl}
        download
        className="flex items-center gap-3 p-3 rounded-lg mb-1"
        style={{ background: 'rgba(255,255,255,0.06)', minWidth: 240 }}
      >
        <div className="w-10 h-12 rounded-lg flex items-center justify-center flex-shrink-0 bg-black/20">
          <span className="text-xl">📄</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] truncate">{text || 'Documento'}</p>
          <p className="text-[11px] opacity-70">Toque para baixar</p>
        </div>
      </a>
    );
  }

  if (isMedia && !msg.mediaUrl) {
    if (msg.type === 'image') return placeholder('Foto — toque para ver', '📷');
    if (msg.type === 'video') return placeholder('Vídeo — toque para ver', '🎥');
    if (msg.type === 'audio') return placeholder('Áudio — toque para ouvir', '🎙️');
    if (msg.type === 'sticker') return placeholder('Figurinha', '🌟');
    if (msg.type === 'document') return placeholder(text || 'Documento', '📄');
  }

  return <span style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{text}</span>;
};
