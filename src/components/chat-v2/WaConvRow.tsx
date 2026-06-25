import React, { memo } from 'react';
import type { Conversation, WhatsAppConnection } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import {
  connectionBadgeHue,
  connectionDisplayLabel,
  formatListTime,
  inboxListTitle,
  unreadCount,
} from './lib/conversationDisplay';
import { getLastMsgPreview } from './lib/chatPreview';
import {
  formatContactPresenceSubtitle,
  isContactPresenceOnline,
} from '../../utils/evolutionPresence';

type Props = {
  conv: Conversation;
  display?: ConversationDisplay;
  avatarSrc: string;
  selected: boolean;
  connections: WhatsAppConnection[];
  style: React.CSSProperties;
  measureRef?: (el: HTMLElement | null) => void;
  dataIndex: number;
  onSelect: (id: string) => void;
};

export const WaConvRow = memo(function WaConvRow({
  conv, display, avatarSrc, selected, connections,
  style, measureRef, dataIndex, onSelect,
}: Props) {
  const title = inboxListTitle(display, conv);
  const presencePreview = formatContactPresenceSubtitle(conv);
  const preview = presencePreview || getLastMsgPreview(conv);
  const unread = unreadCount(conv);
  const online = isContactPresenceOnline(conv);
  const channelLabel = connectionDisplayLabel(connections, conv.connectionId);
  const hue = connectionBadgeHue(conv.connectionId);

  return (
    <button
      type="button"
      ref={measureRef}
      data-index={dataIndex}
      className="wa-conv-row absolute left-0 w-full text-left"
      data-active={selected ? 'true' : 'false'}
      data-unread={unread > 0 ? 'true' : 'false'}
      style={style}
      onClick={() => onSelect(conv.id)}
    >
      {/* Barra lateral esquerda para item selecionado */}
      {selected && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{ background: 'var(--wa-green)' }}
          aria-hidden
        />
      )}

      {/* Avatar com indicadores */}
      <span className="wa-conv-avatar-wrap relative flex-shrink-0">
        <img
          src={avatarSrc}
          alt=""
          className="wa-conv-avatar"
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const el = e.currentTarget;
            el.onerror = null;
            el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=00a884&color=fff&size=200&bold=true`;
          }}
        />
        {/* Dot colorido do canal */}
        {conv.connectionId && (
          <span
            className="wa-channel-dot"
            aria-hidden
            title={channelLabel ? `Canal: ${channelLabel}` : 'Conexão WhatsApp'}
            style={{ background: `hsl(${hue}, 60%, 50%)` }}
          />
        )}
        {/* Presença online com anel pulsante */}
        {online && (
          <span className="wa-presence-ring" aria-hidden title="Online" />
        )}
      </span>

      {/* Corpo da linha */}
      <div className="wa-conv-body min-w-0 flex-1">
        {/* Linha 1: nome + hora */}
        <div className="flex justify-between gap-2 items-baseline">
          <span
            className={`wa-conv-name truncate${unread > 0 ? ' wa-conv-name--bold' : ''}${display?.fromDatabase ? ' wa-conv-name--crm' : ''}`}
          >
            {title}
          </span>
          <span
            className="wa-conv-time flex-shrink-0 text-[11px]"
            style={{ color: unread > 0 ? 'var(--wa-green)' : undefined }}
          >
            {formatListTime(conv)}
          </span>
        </div>

        {/* Alias do WhatsApp (se diferente do nome do CRM) */}
        {display?.fromDatabase && display.whatsappSubtitle && (
          <span className="wa-conv-wa-alias truncate block text-[11px]">
            {display.whatsappSubtitle}
          </span>
        )}

        {/* Linha 2: preview + badge */}
        <div className="flex justify-between gap-2 items-center mt-0.5">
          <span
            className={`wa-conv-preview truncate text-[13px]${presencePreview ? ' wa-conv-preview--presence' : ''}`}
          >
            {preview}
          </span>
          {unread > 0 && (
            <span className="wa-unread-badge flex-shrink-0">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>

        {/* Linha 3: tag de canal como pill colorido */}
        {channelLabel && (
          <span
            className="wa-conv-channel-tag"
            title={`Canal: ${channelLabel}`}
            style={{
              borderColor: `hsl(${hue}, 60%, 50%, 0.35)`,
              color: `hsl(${hue}, 55%, 65%)`,
              background: `hsl(${hue}, 60%, 50%, 0.10)`,
            }}
          >
            {channelLabel}
          </span>
        )}
      </div>
    </button>
  );
});
