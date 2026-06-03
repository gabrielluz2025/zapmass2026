import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircleMore, RefreshCw, Search } from 'lucide-react';
import type { Conversation } from '../../types';
import { WaAvatar } from './WaAvatar';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { formatListTime, inboxListTitle, unreadCount } from './lib/conversationDisplay';
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
    overscan: 8,
    getItemKey: (i) => conversations[i]?.id ?? i
  });

  const totalUnread = useMemo(
    () => allConversations.reduce((n, c) => n + unreadCount(c), 0),
    [allConversations]
  );

  const statusLabel =
    connectionStatus === 'online'
      ? chipsConnected > 0
        ? `${chipsConnected} chip conectado`
        : 'Conectado'
      : 'Reconectando…';

  return (
    <aside className="wa-v2-inbox" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
      <div className="wa-v2-header flex-shrink-0">
        <p className="text-[15px] font-medium flex-1">Conversas</p>
        <span
          className="text-[12px] flex items-center gap-1.5 mr-1"
          style={{ color: 'var(--wv2-text-3)' }}
          title={statusLabel}
        >
          <span
            className="wa-v2-live-dot inline-block"
            data-offline={connectionStatus !== 'online'}
          />
          {statusLabel}
        </span>
        <button
          type="button"
          className="p-2 rounded-full hover:bg-black/5"
          title="Atualizar conversas"
          onClick={onRefresh}
          aria-label="Atualizar conversas"
        >
          <RefreshCw className="w-5 h-5" style={{ color: 'var(--wv2-text-2)' }} />
        </button>
      </div>

      <div className="wa-v2-search-wrap relative">
        <Search
          className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: 'var(--wv2-text-3)' }}
        />
        <input
          className="wa-v2-search"
          placeholder="Pesquisar"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      {totalUnread > 0 && (
        <div className="px-3 pb-2">
          <button
            type="button"
            className="wa-v2-filter-pill w-full text-left"
            data-active={unreadOnly}
            onClick={onToggleUnread}
          >
            {unreadOnly ? 'Mostrar todas' : `Não lidas (${totalUnread})`}
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <MessageCircleMore className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">
              {unreadOnly ? 'Nenhuma não lida' : 'Nenhuma conversa'}
            </p>
            <p className="text-xs mt-1 opacity-70">
              {chipsConnected === 0
                ? 'Conecte um chip em Conexões.'
                : unreadOnly
                  ? 'Você leu todas as mensagens.'
                  : 'Aguarde a sincronização ou toque em atualizar.'}
            </p>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const conv = conversations[row.index];
              if (!conv) return null;
              const disp = displayById.get(conv.id);
              const primary = inboxListTitle(disp, conv);
              const preview = (conv.lastMessage || '').trim() || '[Mídia]';
              const unread = unreadCount(conv);
              const active = selectedId === conv.id;

              return (
                <div
                  key={conv.id}
                  className="wa-v2-chat-row absolute left-0 w-full"
                  style={{
                    height: row.size,
                    transform: `translateY(${row.start}px)`
                  }}
                  data-active={active}
                  onClick={() => onSelect(conv.id)}
                >
                  <WaAvatar src={avatarById.get(conv.id) || ''} name={primary} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[16px] font-normal truncate" style={{ color: 'var(--wv2-text)' }}>
                        {primary}
                      </span>
                      <span
                        className="text-[12px] flex-shrink-0"
                        style={{ color: unread > 0 ? 'var(--wv2-green)' : 'var(--wv2-text-3)' }}
                      >
                        {formatListTime(conv)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className="text-[13px] truncate"
                        style={{ color: 'var(--wv2-text-2)', fontWeight: unread > 0 ? 500 : 400 }}
                      >
                        {preview}
                      </p>
                      {unread > 0 && (
                        <span className="wa-v2-unread-badge">{unread > 99 ? '99+' : unread}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
