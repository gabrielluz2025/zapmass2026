import React, { memo, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircle, RefreshCw, Search, Wifi, WifiOff, Zap } from 'lucide-react';
import type { Conversation, WhatsAppConnection } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import {
  connectionBadgeHue,
  connectionDisplayLabel,
  unreadCount
} from './lib/conversationDisplay';
import type { WaSocketStatus } from './hooks/useWaRealtime';
import { WaConvRow } from './WaConvRow';

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

export const WaInbox: React.FC<Props> = memo(function WaInbox({
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
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreLockRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !inboxHasMore || inboxLoadingMore || !onLoadMore || loadMoreLockRef.current) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!nearBottom) return;
    loadMoreLockRef.current = true;
    onLoadMore();
    window.setTimeout(() => { loadMoreLockRef.current = false; }, 800);
  }, [inboxHasMore, inboxLoadingMore, onLoadMore]);

  const showMultiChannelUi = connections.length > 1;

  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const conv = conversations[i];
      if (!conv) return 76;
      const disp = displayById.get(conv.id);
      let h = 76;
      if (disp?.fromDatabase && disp?.whatsappSubtitle) h += 14;
      if (connectionDisplayLabel(connections, conv.connectionId)) h += 22;
      return h;
    },
    overscan: 4,
    getItemKey: (i) => conversations[i]?.id ?? i,
    measureElement: (el) => el.getBoundingClientRect().height,
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
          id: conn.id, label,
          count: channelCounts.get(conn.id) ?? 0,
          hue: connectionBadgeHue(conn.id),
          connected: conn.status === 'CONNECTED',
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [showMultiChannelUi, connections, channelCounts]);

  const isOnline = socketStatus === 'online';
  const isSlow = socketStatus === 'slow';
  const isOffline = socketStatus === 'offline';

  const statusText = useMemo(() => {
    if (syncing) return 'Sincronizando…';
    if (isOffline) return 'Servidor desconectado';
    if (isSlow) return 'Conexão instável — sync ativo';
    if (chipsConnected > 0) return `${chipsConnected} chip${chipsConnected > 1 ? 's' : ''} ativo${chipsConnected > 1 ? 's' : ''}`;
    return 'Conecte um chip em Conexões';
  }, [syncing, isOffline, isSlow, chipsConnected]);

  const showAllActive = !unreadOnly && connectionFilterId === 'ALL';

  const handleShowAll = useCallback(() => {
    onConnectionFilterChange('ALL');
    if (unreadOnly) onToggleUnread();
  }, [onConnectionFilterChange, unreadOnly, onToggleUnread]);

  const handleChannelPill = useCallback(
    (id: string) => { onConnectionFilterChange(connectionFilterId === id ? 'ALL' : id); },
    [connectionFilterId, onConnectionFilterChange]
  );

  return (
    <aside className="wa-side flex flex-col min-h-0" data-hide-mobile={hideOnMobile ? 'true' : undefined}>

      {/* ── Header redesenhado ─────────────────────── */}
      <div className="wa-inbox-header">
        <div className="wa-inbox-header__left">
          {/* Indicador de status ao vivo */}
          <div className="wa-live-badge" data-state={syncing ? 'sync' : isOffline ? 'off' : isSlow ? 'slow' : 'on'}>
            <span className="wa-live-dot" />
            <span className="wa-live-label">
              {syncing ? 'SYNC' : isOffline ? 'OFF' : isSlow ? 'LENTO' : 'LIVE'}
            </span>
          </div>
        </div>

        <div className="wa-inbox-header__center">
          {totalUnread > 0 ? (
            <div className="wa-unread-hero">
              <span className="wa-unread-hero__count">{totalUnread > 999 ? '999+' : totalUnread}</span>
              <span className="wa-unread-hero__label">não lidas</span>
            </div>
          ) : (
            <span className="wa-inbox-title">Bate-papo</span>
          )}
        </div>

        <div className="wa-inbox-header__right">
          <button
            type="button"
            className="wa-icon-btn"
            title="Sincronizar conversas"
            onClick={onRefresh}
          >
            <RefreshCw className={`w-[18px] h-[18px] ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Linha de status contextual ──────────────── */}
      <div className="wa-inbox-status" data-state={isOffline ? 'off' : isSlow ? 'slow' : 'on'}>
        {isOffline ? <WifiOff className="w-3 h-3 shrink-0" /> : <Wifi className="w-3 h-3 shrink-0" />}
        <span className="flex-1 truncate">{statusText}</span>
        {chipsConnected > 0 && !isOffline && (
          <span className="wa-inbox-status__chips">
            <Zap className="w-2.5 h-2.5" />
            {allConversations.length}
          </span>
        )}
      </div>

      {/* ── Busca ──────────────────────────────────── */}
      <div className="wa-search-wrap">
        <label className="wa-search">
          <Search className="w-[16px] h-[16px] shrink-0 opacity-50" aria-hidden />
          <span className="sr-only">Pesquisar</span>
          <input
            type="search"
            placeholder="Pesquisar conversa ou número…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
      </div>

      {/* ── Seletor de conexão (collapse em select) ── */}
      {connections.length > 1 && (
        <div className="wa-connection-bar flex-shrink-0">
          <label htmlFor="wa-connection-filter" className="wa-connection-bar-label">
            Canal
          </label>
          <select
            id="wa-connection-filter"
            className="wa-connection-select"
            value={connectionFilterId}
            onChange={(e) => onConnectionFilterChange(e.target.value)}
          >
            <option value="ALL">Todas as conexões ({allConversations.length})</option>
            {connections.map((conn) => {
              const label = connectionDisplayLabel(connections, conn.id) || 'Canal';
              const count = channelCounts.get(conn.id) ?? 0;
              const suffix = conn.status !== 'CONNECTED' ? ' · offline' : '';
              return (
                <option key={conn.id} value={conn.id}>
                  {label} ({count}){suffix}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* ── Pills de filtro ─────────────────────────── */}
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
            Não lidas
            <span className="wa-pill-badge">{totalUnread}</span>
          </button>
        )}
        {channelPills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            className="wa-filter-pill wa-filter-pill--channel"
            data-active={connectionFilterId === pill.id ? 'true' : 'false'}
            title={pill.label}
            onClick={() => handleChannelPill(pill.id)}
          >
            <span
              className="wa-filter-pill-dot"
              aria-hidden
              style={{ background: `hsl(${pill.hue}, 60%, 50%)` }}
            />
            <span className="truncate max-w-[8rem]">{pill.label}</span>
            {pill.count > 0 && <span className="wa-pill-badge">{pill.count}</span>}
          </button>
        ))}
      </div>

      {/* ── Lista virtualizada ──────────────────────── */}
      <div
        ref={scrollRef}
        className="wa-conv-list flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
            <MessageCircle className="w-10 h-10 opacity-20" style={{ color: 'var(--wa-text-3)' }} />
            <p className="text-sm" style={{ color: 'var(--wa-text-3)' }}>
              {connectionFilterId !== 'ALL' || unreadOnly
                ? 'Nenhuma conversa com esses filtros.'
                : chipsConnected === 0
                  ? 'Vá em Conexões e escaneie o QR do WhatsApp.'
                  : 'Aguardando mensagens…'}
            </p>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const conv = conversations[row.index];
              if (!conv) return null;
              return (
                <WaConvRow
                  key={conv.id}
                  conv={conv}
                  display={displayById.get(conv.id)}
                  avatarSrc={avatarById.get(conv.id) || ''}
                  selected={conv.id === selectedId}
                  connections={connections}
                  measureRef={virtualizer.measureElement}
                  dataIndex={row.index}
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        )}
        {inboxLoadingMore && (
          <p className="text-center text-xs py-3" style={{ color: 'var(--wa-text-3)' }}>
            Carregando mais…
          </p>
        )}
      </div>
    </aside>
  );
});
