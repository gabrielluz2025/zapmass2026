import React, { memo, useEffect, useRef } from 'react';
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
  showChannelTag: boolean;
  style: React.CSSProperties;
  measureRef?: (el: HTMLElement | null) => void;
  dataIndex: number;
  onSelect: (id: string) => void;
  onRequestPicture?: (id: string, force?: boolean) => void;
};

const UI_AVATAR_HOST = 'ui-avatars.com';

function isGeneratedAvatar(src: string): boolean {
  return !src || src.includes(UI_AVATAR_HOST);
}

export const WaConvRow = memo(function WaConvRow({
  conv,
  display,
  avatarSrc,
  selected,
  connections,
  showChannelTag,
  style,
  measureRef,
  dataIndex,
  onSelect,
  onRequestPicture,
}: Props) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const title = inboxListTitle(display, conv);
  const presencePreview = formatContactPresenceSubtitle(conv);
  const preview = presencePreview || getLastMsgPreview(conv);
  const unread = unreadCount(conv);
  const online = isContactPresenceOnline(conv);
  const channelLabel = connectionDisplayLabel(connections, conv.connectionId);
  const hue = connectionBadgeHue(conv.connectionId);

  useEffect(() => {
    if (!onRequestPicture || !isGeneratedAvatar(avatarSrc)) return;
    const el = rowRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onRequestPicture(conv.id);
          obs.disconnect();
        }
      },
      { root: el.closest('.wa-conv-list'), rootMargin: '80px 0px', threshold: 0.01 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [conv.id, avatarSrc, onRequestPicture]);

  const setRef = (el: HTMLButtonElement | null) => {
    rowRef.current = el;
    measureRef?.(el);
  };

  return (
    <button
      type="button"
      ref={setRef}
      data-index={dataIndex}
      className="wa-conv-row absolute left-0 w-full text-left"
      data-active={selected ? 'true' : 'false'}
      data-unread={unread > 0 ? 'true' : 'false'}
      style={style}
      onClick={() => onSelect(conv.id)}
    >
      <span
        className="wa-conv-avatar-wrap relative flex-shrink-0"
        data-channel={showChannelTag && conv.connectionId ? 'true' : undefined}
        style={
          showChannelTag && conv.connectionId
            ? ({ '--wa-channel-hue': `${hue}` } as React.CSSProperties)
            : undefined
        }
      >
        <img
          src={avatarSrc}
          alt=""
          className="wa-conv-avatar"
          width={52}
          height={52}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const el = e.currentTarget;
            if (el.dataset.fallback === '1') return;
            el.dataset.fallback = '1';
            el.onerror = null;
            el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=00a884&color=fff&size=200&bold=true`;
            if (conv.profilePicUrl?.startsWith('http')) {
              onRequestPicture?.(conv.id, true);
            }
          }}
        />
        {online && (
          <span className="wa-presence-ring" aria-hidden title="Online" />
        )}
      </span>

      <div className="wa-conv-body min-w-0 flex-1">
        <div className="wa-conv-topline">
          <span
            className={`wa-conv-name${unread > 0 ? ' wa-conv-name--bold' : ''}${display?.fromDatabase ? ' wa-conv-name--crm' : ''}`}
            title={title}
          >
            {title}
          </span>
          <span
            className="wa-conv-time flex-shrink-0"
            data-unread={unread > 0 ? 'true' : undefined}
          >
            {formatListTime(conv)}
          </span>
        </div>

        {display?.fromDatabase && display.whatsappSubtitle && (
          <span className="wa-conv-wa-alias" title={display.whatsappSubtitle}>
            {display.whatsappSubtitle}
          </span>
        )}

        <div className="wa-conv-bottomline">
          <span
            className={`wa-conv-preview${presencePreview ? ' wa-conv-preview--presence' : ''}`}
            title={preview}
          >
            {preview}
          </span>
          {showChannelTag && channelLabel && (
            <span
              className="wa-conv-channel-inline"
              title={`Canal: ${channelLabel}`}
              style={{
                color: `hsl(${hue}, 55%, 68%)`,
                background: `hsl(${hue}, 55%, 42%, 0.18)`,
                borderColor: `hsl(${hue}, 55%, 50%, 0.35)`,
              }}
            >
              {channelLabel}
            </span>
          )}
          {unread > 0 && (
            <span className="wa-unread-badge flex-shrink-0">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
