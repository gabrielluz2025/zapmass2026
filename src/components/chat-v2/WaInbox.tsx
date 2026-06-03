import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircle, RefreshCw, Search } from 'lucide-react';
import type { Conversation } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { formatListTime, inboxListTitle, unreadCount } from './lib/conversationDisplay';
import { getLastMsgPreview } from './lib/chatPreview';
import type { WaSocketStatus } from './hooks/useWaRealtime';

type Props = {
  conversations: Conversation[];
  allConversations: Conversation[];
  displayById: Map<string, ConversationDisplay>;
  avatarById: Map<string, string>;
  selectedId: string | null;
  search: string;
  unreadOnly: boolean;
  socketStatus: WaSocketStatus;
  chipsConnected: number;
  syncing: boolean;
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
  socketStatus,
  chipsConnected,
  syncing,
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

  const statusText = useMemo(() => {
    if (syncing) return 'Sincronizando conversas…';
    if (socketStatus === 'offline') return 'Servidor desconectado';
    if (socketStatus === 'slow') return 'Servidor lento — mensagens em tempo real ativas';
    if (chipsConnected > 0) {
      return `Painel online · ${chipsConnected} chip${chipsConnected > 1 ? 's' : ''} ativo${chipsConnected > 1 ? 's' : ''}`;
    }
    return 'Painel online · conecte um chip em Conexões';
  }, [syncing, socketStatus, chipsConnected]);

  const stripOffline = socketStatus === 'offline' || syncing;

  return (
    <aside className="wa-side flex flex-col min-h-0" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
      <div className="wa-side-header flex items-center justify-between gap-2 px-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="wa-conv-name text-[17px] leading-tight">Conversas</p>
        </div>
        <button
          type="button"
          className="wa-icon-btn"
          title="Sincronizar com o WhatsApp (completo)"
          aria-label="Sincronizar com o WhatsApp"
          onClick={onRefresh}
        >
          <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div
        className="wa-status-strip"
        data-offline={stripOffline ? 'true' : 'false'}
        data-slow={socketStatus === 'slow' ? 'true' : 'false'}
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
          className={`wa-filter-unread ${unreadOnly ? 'wa-filter-unread--on' : ''}`}
          onClick={onToggleUnread}
        >
          {unreadOnly ? 'Mostrar todas' : `Não lidas (${totalUnread})`}
        </button>
      )}

      <div ref={scrollRef} className="wa-conv-list flex-1 min-h-0 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="text-center text-sm py-10 px-4" style={{ color: 'var(--wa-text-3)' }}>
            Nenhuma conversa. Conecte um chip e use Atualizar, ou aguarde novas mensagens.
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const conv = conversations[row.index];
              if (!conv) return null;
              const display = displayById.get(conv.id);
              const title = inboxListTitle(display, conv);
              const preview = getLastMsgPreview(conv);
              const unread = unreadCount(conv);
              const selected = conv.id === selectedId;

              return (
                <button
                  key={conv.id}
                  type="button"
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className={`wa-conv-row absolute left-0 w-full text-left ${selected ? 'wa-conv-row--active' : ''}`}
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                  onClick={() => onSelect(conv.id)}
                >
                  <img
                    src={avatarById.get(conv.id) || ''}
                    alt=""
                    className="wa-conv-avatar"
                    width={48}
                    height={48}
                    loading="lazy"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.onerror = null;
                      el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=00a884&color=fff&size=200&bold=true`;
                    }}
                  />
                  <div className="wa-conv-body min-w-0 flex-1">
                    <div className="flex justify-between gap-2 items-baseline">
                      <span className="wa-conv-name truncate">{title}</span>
                      <span className="wa-conv-time flex-shrink-0">
                        {formatListTime(conv)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 items-center mt-0.5">
                      <span className="wa-conv-preview truncate">{preview}</span>
                      {unread > 0 && (
                        <span className="wa-unread-badge flex-shrink-0">{unread > 99 ? '99+' : unread}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {conversations.length === 0 && chipsConnected === 0 && (
        <div className="px-4 pb-4 text-center">
          <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs" style={{ color: 'var(--wa-text-3)' }}>
            Vá em Conexões e escaneie o QR do WhatsApp.
          </p>
        </div>
      )}
    </aside>
  );
};
