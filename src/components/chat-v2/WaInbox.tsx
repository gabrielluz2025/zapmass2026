import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, MessageCircleMore, Users } from 'lucide-react';
import type { Conversation } from '../../types';
import { WaAvatar } from './WaAvatar';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { formatListTime, isGroupConversation, unreadCount } from './lib/conversationDisplay';

export type InboxFilter = 'all' | 'unread' | 'groups';

type Props = {
  conversations: Conversation[];
  displayById: Map<string, ConversationDisplay>;
  avatarById: Map<string, string>;
  selectedId: string | null;
  search: string;
  filter: InboxFilter;
  onSearch: (q: string) => void;
  onFilter: (f: InboxFilter) => void;
  onSelect: (id: string) => void;
  hideOnMobile?: boolean;
};

export const WaInbox: React.FC<Props> = ({
  conversations,
  displayById,
  avatarById,
  selectedId,
  search,
  filter,
  onSearch,
  onFilter,
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

  const filters: { id: InboxFilter; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'unread', label: 'Não lidas' },
    { id: 'groups', label: 'Grupos' }
  ];

  return (
    <aside className="wa-v2-inbox" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
      <div className="wa-v2-search-wrap relative">
        <Search
          className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: 'var(--wv2-text-3)' }}
        />
        <input
          className="wa-v2-search"
          placeholder="Pesquisar ou começar uma nova conversa"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b" style={{ borderColor: 'var(--wv2-divider)' }}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            className="wa-v2-filter-pill"
            data-active={filter === f.id}
            onClick={() => onFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <MessageCircleMore className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">Nenhuma conversa</p>
            <p className="text-xs mt-1 opacity-70">Conecte um chip WhatsApp para sincronizar.</p>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const conv = conversations[row.index];
              if (!conv) return null;
              const disp = displayById.get(conv.id);
              const primary = disp?.primary ?? (conv.contactName || 'Contato');
              const preview = (conv.lastMessage || '').trim() || '[Mídia]';
              const unread = unreadCount(conv);
              const active = selectedId === conv.id;
              const isGroup = isGroupConversation(conv);

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
                        {isGroup && (
                          <Users className="inline w-3.5 h-3.5 mr-1 opacity-60" aria-hidden />
                        )}
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
                      {unread > 0 && <span className="wa-v2-unread-badge">{unread > 99 ? '99+' : unread}</span>}
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
