import React, { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircle, RefreshCw, Search } from 'lucide-react';
import type { Conversation, WhatsAppConnection } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import {
  connectionBadgeHue,
  connectionDisplayLabel,
  formatListTime,
  inboxListTitle,
  unreadCount
} from './lib/conversationDisplay';
import { getLastMsgPreview } from './lib/chatPreview';
import {
  formatContactPresenceSubtitle,
  isContactPresenceOnline,
} from '../../utils/evolutionPresence';
import type { WaSocketStatus } from './hooks/useWaRealtime';

type Props = {
  conversations: Conversation[];
  allConversations: Conversation[];
  displayById: Map<string, ConversationDisplay>;
  avatarById: Map<string, string>;
  selectedId: string | null;
  search: string;
  unreadOnly: boolean;
  connectionFilterId: string | 'ALL';
  onConnectionFilterChange: (id: string | 'ALL') => void;
  socketStatus: WaSocketStatus;
  chipsConnected: number;
  connections: WhatsAppConnection[];
  syncing: boolean;
  onSearch: (q: string) => void;
  onToggleUnread: () => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  hideOnMobile?: boolean;
  inboxHasMore?: boolean;
  inboxLoadingMore?: boolean;
  onLoadMore?: () => void;
};

export const WaInbox: React.FC<Props> = ({
  conversations,
  allConversations,
  displayById,
  avatarById,
  selectedId,
  search,
  unreadOnly,
  connectionFilterId,
  onConnectionFilterChange,
  socketStatus,
  chipsConnected,
  connections,
  syncing,
  onSearch,
  onToggleUnread,
  onRefresh,
  onSelect,
  hideOnMobile,
  inboxHasMore,
  inboxLoadingMore,
  onLoadMore,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreLockRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !inboxHasMore || inboxLoadingMore || !onLoadMore || loadMoreLockRef.current) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!nearBottom) return;
    loadMoreLockRef.current = true;
    onLoadMore();
    window.setTimeout(() => {
      loadMoreLockRef.current = false;
    }, 800);
  }, [inboxHasMore, inboxLoadingMore, onLoadMore]);

  const showMultiChannelUi = connections.length > 1;

  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const conv = conversations[i];
      if (!conv) return 72;
      const disp = displayById.get(conv.id);
      return disp?.fromDatabase && disp?.whatsappSubtitle ? 88 : 72;
    },
    overscan: 4,
    getItemKey: (i) => conversations[i]?.id ?? i,
    measureElement: (el) => el.getBoundingClientRect().height
  });

  const totalUnread = useMemo(
    () => allConversations.reduce((n, c) => n + unreadCount(c), 0),
    [allConversations]
  );

  const channelCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of allConversations) {
      const id = (c.connectionId || '').trim();
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [allConversations]);

  const channelPills = useMemo(() => {
    if (!showMultiChannelUi) return [];
    return connections
      .map((conn) => {
        const label = connectionDisplayLabel(connections, conn.id);
        if (!label) return null;
        return {
          id: conn.id,
          label,
          count: channelCounts.get(conn.id) ?? 0,
          hue: connectionBadgeHue(conn.id),
          connected: conn.status === 'CONNECTED',
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [showMultiChannelUi, connections, channelCounts]);

  const statusText = useMemo(() => {
    if (syncing) return 'Sincronizando conversas…';
    if (socketStatus === 'offline') return 'Servidor desconectado';
    if (socketStatus === 'slow') return 'Conexão instável — sync automático ativo';
    if (chipsConnected > 0) {
      return `Painel online · ${chipsConnected} chip${chipsConnected > 1 ? 's' : ''} ativo${chipsConnected > 1 ? 's' : ''} · sync automático`;
    }
    return 'Painel online · conecte um chip em Conexões';
  }, [syncing, socketStatus, chipsConnected]);

  const stripOffline = socketStatus === 'offline';
  const showAllActive = !unreadOnly && connectionFilterId === 'ALL';

  const handleShowAll = useCallback(() => {
    onConnectionFilterChange('ALL');
    if (unreadOnly) onToggleUnread();
  }, [onConnectionFilterChange, unreadOnly, onToggleUnread]);

  const handleChannelPill = useCallback(
    (id: string) => {
      onConnectionFilterChange(connectionFilterId === id ? 'ALL' : id);
    },
    [connectionFilterId, onConnectionFilterChange]
  );

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

      {connections.length > 0 && (
        <div className="wa-connection-bar flex-shrink-0">
          <label htmlFor="wa-connection-filter" className="wa-connection-bar-label">
            Conexão WhatsApp
          </label>
          <select
            id="wa-connection-filter"
            className="wa-connection-select"
            value={connectionFilterId}
            onChange={(e) => onConnectionFilterChange(e.target.value)}
            aria-label="Filtrar conversas por conexão WhatsApp"
          >
            <option value="ALL">
              Todas as conexões ({allConversations.length})
            </option>
            {connections.map((conn) => {
              const label = connectionDisplayLabel(connections, conn.id) || 'Canal';
              const count = channelCounts.get(conn.id) ?? 0;
              const offline = conn.status !== 'CONNECTED' ? ' · offline' : '';
              return (
                <option key={conn.id} value={conn.id}>
                  {label} ({count}){offline}
                </option>
              );
            })}
          </select>
        </div>
      )}

      <div className="wa-filter-row flex-shrink-0">
        <button
          type="button"
          className="wa-filter-pill"
          data-active={showAllActive ? 'true' : 'false'}
          onClick={handleShowAll}
        >
          Todas
        </button>
        {totalUnread > 0 && (
          <button
            type="button"
            className="wa-filter-pill"
            data-active={unreadOnly ? 'true' : 'false'}
            onClick={onToggleUnread}
          >
            Não lidas {totalUnread}
          </button>
        )}
        {channelPills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            className="wa-filter-pill wa-filter-pill--channel"
            data-active={connectionFilterId === pill.id ? 'true' : 'false'}
            title={pill.connected ? pill.label : `${pill.label} (offline)`}
            onClick={() => handleChannelPill(pill.id)}
          >
            <span
              className="wa-filter-pill-dot"
              aria-hidden
              style={{ background: `hsl(${pill.hue}, 52%, 42%)` }}
            />
            <span className="truncate max-w-[9rem]">{pill.label}</span>
            {pill.count > 0 && <span className="opacity-70">{pill.count}</span>}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="wa-conv-list flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        {conversations.length === 0 ? (
          <p className="text-center text-sm py-10 px-4" style={{ color: 'var(--wa-text-3)' }}>
            {connectionFilterId !== 'ALL' || unreadOnly
              ? 'Nenhuma conversa com esses filtros.'
              : 'Nenhuma conversa. Conecte um chip e use Atualizar, ou aguarde novas mensagens.'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const conv = conversations[row.index];
              if (!conv) return null;
              const display = displayById.get(conv.id);
              const title = inboxListTitle(display, conv);
              const presencePreview = formatContactPresenceSubtitle(conv);
              const preview = presencePreview || getLastMsgPreview(conv);
              const unread = unreadCount(conv);
              const selected = conv.id === selectedId;
              const online = isContactPresenceOnline(conv);
              const channelLabel = connectionDisplayLabel(connections, conv.connectionId);

              return (
                <button
                  key={conv.id}
                  type="button"
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className="wa-conv-row absolute left-0 w-full text-left"
                  data-active={selected ? 'true' : 'false'}
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                  onClick={() => onSelect(conv.id)}
                >
                  <span className="wa-conv-avatar-wrap relative flex-shrink-0">
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
                          <span
                            className="wa-conv-wa-alias truncate block"
                            title="Nome salvo no celular"
                          >
                            {display.whatsappSubtitle}
                          </span>
                        )}
                      </div>
                      <span
                        className="wa-conv-time flex-shrink-0 pt-0.5"
                        data-unread={unread > 0 ? 'true' : 'false'}
                      >
                        {formatListTime(conv)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 items-center mt-0.5">
                      <span
                        className={`wa-conv-preview truncate${presencePreview ? ' wa-conv-preview--presence' : ''}`}
                      >
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
            })}
          </div>
        )}
        {inboxLoadingMore && (
          <p className="text-center text-xs py-3" style={{ color: 'var(--wa-text-3)' }}>
            Carregando mais conversas…
          </p>
        )}
        {inboxHasMore && !inboxLoadingMore && conversations.length > 0 && (
          <p className="text-center text-[11px] py-2 opacity-60" style={{ color: 'var(--wa-text-3)' }}>
            Role para carregar mais
          </p>
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
