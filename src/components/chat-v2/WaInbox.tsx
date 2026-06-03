import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircle, RefreshCw, Search } from 'lucide-react';
import type { Conversation } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { formatListTime, inboxListTitle, unreadCount } from './lib/conversationDisplay';
import { getLastMsgPreview } from './lib/chatPreview';
import type { WaConnectionStatus } from './hooks/useWaRealtime';

type Props = {
  conversations: Conversation[];
  allConversations: Conversation[];
  displayById: Map<string, ConversationDisplay>;
  avatarById: Map<string, string>;
  selectedId: string | null;
  search: string;
  unreadOnly: boolean;
  connectionStatus: WaConnectionStatus;
  chipsConnected: number;
  onSearch: (q: string) => void;
  onToggleUnread: () => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  hideOnMobile?: boolean;
};

export const WaInbox: React.FC<Props> = ({
  conversations,
  allConversations,
  displayById,
  avatarById,
  selectedId,
  search,
  unreadOnly,
  connectionStatus,
  chipsConnected,
  onSearch,
  onToggleUnread,
  onRefresh,
  onSelect,
  hideOnMobile
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 10,
    getItemKey: (i) => conversations[i]?.id ?? i,
    measureElement: (el) => el.getBoundingClientRect().height
  });

  const totalUnread = useMemo(
    () => allConversations.reduce((n, c) => n + unreadCount(c), 0),
    [allConversations]
  );

  const statusText =
    connectionStatus === 'online'
      ? chipsConnected > 0
        ? `Conectado · ${chipsConnected} número${chipsConnected > 1 ? 's' : ''} ativo${chipsConnected > 1 ? 's' : ''}`
        : 'Conectado ao servidor'
      : 'Reconectando ao servidor…';

  return (
    <aside className="wa-side flex flex-col min-h-0" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
      <div className="wa-side-header flex items-center justify-between gap-2 px-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="wa-conv-name text-[17px] leading-tight">Conversas</p>
        </div>
        <button
          type="button"
          className="wa-icon-btn"
          title="Atualizar lista"
          aria-label="Atualizar lista"
          onClick={onRefresh}
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <div
        className="wa-status-strip"
        data-offline={connectionStatus !== 'online'}
        role="status"
      >
        <span className="wa-status-dot" aria-hidden />
        <span className="flex-1 truncate">{statusText}</span>
      </div>

      <div className="wa-search-wrap">
        <label className="wa-search">
          <Search className="w-[18px] h-[18px] flex-shrink-0 opacity-60" aria-hidden />
          <span className="sr-only">Pesquisar conversas</span>
          <input
            type="search"
            placeholder="Pesquisar conversa ou número"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
      </div>

      {totalUnread > 0 && (
        <button
          type="button"
          className="wa-filter-unread"
          data-active={unreadOnly}
          onClick={onToggleUnread}
        >
          {unreadOnly ? '← Ver todas as conversas' : `Não lidas (${totalUnread})`}
        </button>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="py-20 px-8 text-center">
            <MessageCircle className="w-11 h-11 mx-auto mb-4 opacity-35" style={{ color: 'var(--wa-text-3)' }} />
            <p className="wa-conv-name text-[15px]">{unreadOnly ? 'Sem não lidas' : 'Nenhuma conversa'}</p>
            <p className="wa-conv-preview mt-2">
              {chipsConnected === 0
                ? 'Conecte um chip em Conexões para sincronizar.'
                : unreadOnly
                  ? 'Todas as mensagens foram lidas.'
                  : 'Use atualizar ou aguarde a sincronização.'}
            </p>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const conv = conversations[row.index];
              if (!conv) return null;
              const disp = displayById.get(conv.id);
              const primary = inboxListTitle(disp, conv);
              const preview = getLastMsgPreview(conv) || 'Sem mensagens';
              const unread = unreadCount(conv);
              const active = selectedId === conv.id;

              return (
                <button
                  key={conv.id}
                  type="button"
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className="wa-conv-row absolute left-0 w-full"
                  style={{
                    height: row.size,
                    transform: `translateY(${row.start}px)`
                  }}
                  data-active={active}
                  onClick={() => onSelect(conv.id)}
                >
                  <img
                    src={avatarById.get(conv.id) || ''}
                    alt=""
                    className="wa-conv-avatar"
                    loading="lazy"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.onerror = null;
                      el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(primary)}&background=00a884&color=fff&size=200&bold=true`;
                    }}
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="wa-conv-name truncate">{primary}</span>
                      <span className="wa-conv-time flex-shrink-0" data-unread={unread > 0}>
                        {formatListTime(conv)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className="wa-conv-preview truncate flex-1"
                        style={{ fontWeight: unread > 0 ? 500 : 400, color: unread > 0 ? 'var(--wa-text)' : undefined }}
                      >
                        {preview}
                      </p>
                      {unread > 0 && (
                        <span className="wa-unread-badge">{unread > 99 ? '99+' : unread}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
