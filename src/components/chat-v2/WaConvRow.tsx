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
  conv,
  display,
  avatarSrc,
  selected,
  connections,
  style,
  measureRef,
  dataIndex,
  onSelect,
}: Props) {
  const title = inboxListTitle(display, conv);
  const presencePreview = formatContactPresenceSubtitle(conv);
  const preview = presencePreview || getLastMsgPreview(conv);
  const unread = unreadCount(conv);
  const online = isContactPresenceOnline(conv);
  const channelLabel = connectionDisplayLabel(connections, conv.connectionId);

  return (
    <button
      type="button"
      ref={measureRef}
      data-index={dataIndex}
      className="wa-conv-row absolute left-0 w-full text-left"
      data-active={selected ? 'true' : 'false'}
      style={style}
      onClick={() => onSelect(conv.id)}
    >
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
        {conv.connectionId && (
          <span
            className="wa-channel-dot"
            aria-hidden
            title={channelLabel ? `Conexão: ${channelLabel}` : 'Conexão WhatsApp'}
            style={{ background: `hsl(${connectionBadgeHue(conv.connectionId)}, 52%, 42%)` }}
          />
        )}
        {online && <span className="wa-presence-dot" aria-hidden title="Online" />}
      </span>
      <div className="wa-conv-body min-w-0 flex-1">
        <div className="flex justify-between gap-2 items-start">
          <div className="min-w-0 flex-1">
            <span
              className={`wa-conv-name truncate block${display?.fromDatabase ? ' wa-conv-name--crm' : ''}`}
            >
              {title}
            </span>
            {display?.fromDatabase && display.whatsappSubtitle && (
              <span className="wa-conv-wa-alias truncate block" title="Nome salvo no celular">
                {display.whatsappSubtitle}
              </span>
            )}
          </div>
          <span className="wa-conv-time flex-shrink-0 pt-0.5" data-unread={unread > 0 ? 'true' : 'false'}>
            {formatListTime(conv)}
          </span>
        </div>
        <div className="flex justify-between gap-2 items-center mt-0.5">
          <span className={`wa-conv-preview truncate${presencePreview ? ' wa-conv-preview--presence' : ''}`}>
            {preview}
          </span>
          {unread > 0 && (
            <span className="wa-unread-badge flex-shrink-0">{unread > 99 ? '99+' : unread}</span>
          )}
        </div>
        {channelLabel && (
          <span className="wa-conv-channel-tag truncate" title={`Conexão: ${channelLabel}`}>
            {channelLabel}
          </span>
        )}
      </div>
    </button>
  );
});
