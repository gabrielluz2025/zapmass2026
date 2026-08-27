import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Forward, Reply, Trash2, X } from 'lucide-react';
import type { ChatMessage } from '../../types';

type Props = {
  message: ChatMessage;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onReply: (msg: ChatMessage) => void;
  onForward: (msg: ChatMessage) => void;
  onDeleteLocal: (msg: ChatMessage) => void;
};

export const WaMessageMenu: React.FC<Props> = ({
  message,
  anchorRect,
  onClose,
  onReply,
  onForward,
  onDeleteLocal,
}) => {
  const style = useMemo((): React.CSSProperties => {
    if (!anchorRect) return { visibility: 'hidden' };
    const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 220);
    const left = Math.min(anchorRect.left, window.innerWidth - 200);
    return { position: 'fixed', top, left, zIndex: 120 };
  }, [anchorRect]);

  const copyText = useCallback(async () => {
    const t = (message.text || '').trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      /* ignore */
    }
    onClose();
  }, [message.text, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="wa-msg-menu-backdrop" onClick={onClose} aria-hidden />
      <div className="wa-msg-menu" style={style} role="menu">
        <button type="button" className="wa-msg-menu__item" onClick={() => { onReply(message); onClose(); }}>
          <Reply className="w-4 h-4" /> Responder
        </button>
        <button type="button" className="wa-msg-menu__item" onClick={() => { onForward(message); onClose(); }}>
          <Forward className="w-4 h-4" /> Encaminhar
        </button>
        {message.text && (
          <button type="button" className="wa-msg-menu__item" onClick={() => void copyText()}>
            <Copy className="w-4 h-4" /> Copiar texto
          </button>
        )}
        <button
          type="button"
          className="wa-msg-menu__item wa-msg-menu__item--danger"
          onClick={() => { onDeleteLocal(message); onClose(); }}
        >
          <Trash2 className="w-4 h-4" /> Remover da tela
        </button>
      </div>
    </>
  );
};

type QuoteProps = {
  quote: ChatMessage | null;
  onClear: () => void;
};

export const WaQuotePreview: React.FC<QuoteProps> = ({ quote, onClear }) => {
  if (!quote) return null;
  const label = quote.sender === 'me' ? 'Você' : 'Contato';
  const preview = (quote.text || '').trim().slice(0, 120) || '[mídia]';
  return (
    <div className="wa-quote-preview">
      <div className="wa-quote-preview__bar" />
      <div className="wa-quote-preview__body">
        <p className="wa-quote-preview__who">{label}</p>
        <p className="wa-quote-preview__text">{preview}</p>
      </div>
      <button type="button" className="wa-icon-btn" onClick={onClear} aria-label="Cancelar resposta">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

type InThreadSearchProps = {
  open: boolean;
  query: string;
  matchCount: number;
  matchIndex: number;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export const WaInThreadSearchBar: React.FC<InThreadSearchProps> = ({
  open,
  query,
  matchCount,
  matchIndex,
  onQueryChange,
  onClose,
  onPrev,
  onNext,
}) => {
  if (!open) return null;
  return (
    <div className="wa-inthread-search">
      <input
        autoFocus
        className="wa-inthread-search__input"
        placeholder="Buscar na conversa…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && e.shiftKey) onPrev();
          if (e.key === 'Enter' && !e.shiftKey) onNext();
        }}
      />
      <span className="wa-inthread-search__count">
        {query.trim() ? (matchCount ? `${matchIndex + 1}/${matchCount}` : '0') : '—'}
      </span>
      <button type="button" className="wa-icon-btn" onClick={onPrev} disabled={!matchCount} aria-label="Anterior">
        <ChevronUp className="w-4 h-4" />
      </button>
      <button type="button" className="wa-icon-btn" onClick={onNext} disabled={!matchCount} aria-label="Próximo">
        <ChevronDown className="w-4 h-4" />
      </button>
      <button type="button" className="wa-icon-btn" onClick={onClose} aria-label="Fechar busca">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
