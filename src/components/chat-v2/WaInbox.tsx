import React, { memo, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircle, RefreshCw, Search, Wifi, WifiOff } from 'lucide-react';
import type { Conversation, WhatsAppConnection } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import {
  connectionBadgeHue,
  connectionDisplayLabel,
  unreadCount
} from './lib/conversationDisplay';
import type { WaSocketStatus } from './hooks/useWaRealtime';
import { WaConvRow } from './WaConvRow';
import type { InboxSmartTab } from '../../utils/chatInboxPrefs';
import type { ConversationOrigin } from './lib/conversationOrigin';
import type { SlaLevel } from './lib/slaUtils';

type Props = {
  conversations: Conversation[];
  allConversations: Conversation[];
  displayById: Map<string, ConversationDisplay>;
  avatarById: Map<string, string>;
  selectedId: string | null;
  search: string;
  unreadOnly: boolean;
  campaignOnly?: boolean;
  totalSystem?: number;
  onToggleCampaign?: () => void;
  originById?: Map<string, ConversationOrigin>;
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
  onRequestPicture?: (conversationId: string, force?: boolean) => void;
  onAutoClassifyResponses?: () => void;
  autoClassifying?: boolean;
  inboxTab?: InboxSmartTab;
  onInboxTabChange?: (tab: InboxSmartTab) => void;
  pinnedIds?: string[];
  slaByConvId?: Map<string, SlaLevel>;
  hotCount?: number;
};

export const WaInbox: React.FC<Props> = memo(function WaInbox({
  conversations,
  allConversations,
  displayById,
  avatarById,
  selectedId,
  search,
  unreadOnly,
  campaignOnly = false,
  totalSystem = 0,
  onToggleCampaign,
  originById,
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
  onRequestPicture,
  onAutoClassifyResponses,
  autoClassifying = false,
  inboxTab = 'all',
  onInboxTabChange,
  pinnedIds = [],
  slaByConvId,
  hotCount = 0,
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

  const showChannelRail = connections.length > 1;
  const showChannelTagsInRows = showChannelRail && connectionFilterId === 'ALL';

  const virtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const conv = conversations[i];
      if (!conv) return 80;
      const disp = displayById.get(conv.id);
      let h = 80;
      if (disp?.fromDatabase && disp?.whatsappSubtitle) h += 16;
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
    if (showChannelRail) return [];
    return connections
      .map((conn) => {
        const label = connectionDisplayLabel(connections, conn.id);
        if (!label) return null;
        return {
          id: conn.id,
          label,
          count: channelCounts.get(conn.id) ?? 0,
          hue: connectionBadgeHue(conn.id),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [showChannelRail, connections, channelCounts]);

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

  const smartTabs: { id: InboxSmartTab; label: string; badge?: number }[] = [
    { id: 'all', label: 'Tudo' },
    { id: 'unread', label: 'Não lidas', badge: totalUnread || undefined },
    { id: 'hot', label: 'Quentes', badge: hotCount || undefined },
  ];

  const moreTabs: { id: InboxSmartTab; label: string }[] = [];

  const showAllActive = inboxTab === 'all' && !unreadOnly && !campaignOnly && connectionFilterId === 'ALL';

  const handleShowAll = useCallback(() => {
    onConnectionFilterChange('ALL');
    if (unreadOnly) onToggleUnread();
    if (campaignOnly && onToggleCampaign) onToggleCampaign();
  }, [onConnectionFilterChange, unreadOnly, onToggleUnread, campaignOnly, onToggleCampaign]);

  const handleChannelPill = useCallback(
    (id: string) => { onConnectionFilterChange(connectionFilterId === id ? 'ALL' : id); },
    [connectionFilterId, onConnectionFilterChange]
  );

  return (
    <aside className="wa-side flex flex-col min-h-0" data-hide-mobile={hideOnMobile ? 'true' : undefined}>

      {/* ── Header estilo WhatsApp Web ─────────────── */}
      <div className="wa-inbox-header wa-inbox-header--wa">
        <h2 className="wa-inbox-title wa-inbox-title--main">Conversas</h2>
        <div className="wa-inbox-header__actions">
          <button
            type="button"
            className="wa-icon-btn"
            title="Sincronizar conversas e mensagens abertas"
            aria-label="Sincronizar"
            onClick={onRefresh}
          >
            <RefreshCw className={`w-[18px] h-[18px] ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Status compacto — só quando relevante */}
      {(isOffline || isSlow || syncing || chipsConnected === 0) && (
        <div className="wa-inbox-status" data-state={isOffline ? 'off' : isSlow ? 'slow' : 'on'}>
          {isOffline ? <WifiOff className="w-3 h-3 shrink-0" /> : <Wifi className="w-3 h-3 shrink-0" />}
          <span className="flex-1 truncate">{statusText}</span>
        </div>
      )}

      {/* ── Busca ──────────────────────────────────── */}
      <div className="wa-search-wrap">
        <label className="wa-search">
          <Search className="w-[16px] h-[16px] shrink-0 opacity-50" aria-hidden />
          <span className="sr-only">Pesquisar</span>
          <input
            type="search"
            placeholder="Pesquisar ou começar nova conversa"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
      </div>

      {/* O seletor de canal foi movido para o WaChannelRail (coluna esquerda) */}

      {/* Filtros principais — estilo WA Web */}
      <div className="wa-filter-row flex-shrink-0 wa-filter-row--scroll">
        {smartTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="wa-filter-pill"
            data-active={inboxTab === t.id && !campaignOnly ? 'true' : 'false'}
            onClick={() => {
              onInboxTabChange?.(t.id);
              if (t.id === 'all') handleShowAll();
            }}
          >
            {t.label}
            {t.badge != null && t.badge > 0 ? (
              <span className="wa-pill-badge">{t.badge > 999 ? '999+' : t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {channelPills.length > 0 && (
        <div className="wa-filter-row flex-shrink-0 wa-filter-row--scroll">
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
              <span className="wa-filter-pill-label">{pill.label}</span>
              {pill.count > 0 && <span className="wa-pill-badge">{pill.count}</span>}
            </button>
          ))}
        </div>
      )}

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
              {syncing
                ? 'Sincronizando conversas com o WhatsApp…'
                : connectionFilterId !== 'ALL' || unreadOnly
                ? 'Nenhuma conversa com esses filtros.'
                : chipsConnected === 0
                  ? 'Vá em Conexões e escaneie o QR do WhatsApp.'
                  : 'Aguardando mensagens…'}
            </p>
            {!syncing && chipsConnected > 0 && connectionFilterId === 'ALL' && !unreadOnly && (
              <button
                type="button"
                className="wa-filter-pill mt-1"
                data-active="false"
                onClick={onRefresh}
              >
                Sincronizar agora
              </button>
            )}
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
                  showChannelTag={showChannelTagsInRows}
                  measureRef={virtualizer.measureElement}
                  dataIndex={row.index}
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                  onSelect={onSelect}
                  onRequestPicture={onRequestPicture}
                  isPinned={pinnedIds.includes(conv.id)}
                  slaLevel={slaByConvId?.get(conv.id) ?? 'none'}
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
