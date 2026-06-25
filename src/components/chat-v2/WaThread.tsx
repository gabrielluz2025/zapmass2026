import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowLeft, History, Loader2, Lock, MoreVertical } from 'lucide-react';
import type { Conversation, WhatsAppConnection } from '../../types';
import { WaBubble } from '../chat/wa/WaBubble';
import { WaComposer } from './WaComposer';
import { WaMessageContent } from './WaMessageContent';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { formatContactPresenceSubtitle } from '../../utils/evolutionPresence';
import { inboxListTitle } from './lib/conversationDisplay';
import { formatDayLabel, formatMsgTime, messageDayKey } from './lib/messageTime';
import type { WaSocketStatus } from './hooks/useWaRealtime';

type VirtualRow =
  | { kind: 'date'; id: string; label: string }
  | { kind: 'msg'; id: string; index: number };

function buildVirtualRows(messages: Conversation['messages']): VirtualRow[] {
  const msgs = messages || [];
  const rows: VirtualRow[] = [];
  let lastDay = '';
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!msg) continue;
    const day = messageDayKey(msg);
    if (day && day !== lastDay) {
      lastDay = day;
      rows.push({ kind: 'date', id: `date-${day}-${i}`, label: formatDayLabel(msg) });
    }
    rows.push({ kind: 'msg', id: msg.id, index: i });
  }
  return rows;
}

type Props = {
  conversation: Conversation | null;
  display: ConversationDisplay | null;
  avatarSrc: string;
  loadingHistory: boolean;
  historyExhausted: boolean;
  canSend: boolean;
  socketStatus: WaSocketStatus;
  syncing?: boolean;
  chipConnected: boolean;
  connectionName?: string | null;
  showConnectionLabel?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onLoadOlder: () => void;
  onSend: (text: string) => void;
  onAttach?: (file: File, caption?: string) => void;
  sendingMedia?: boolean;
  onOpenContactInfo?: () => void;
  hideOnMobile?: boolean;
  onLoadMedia?: (messageId: string) => void;
  isDraft?: boolean;
  draftChannels?: WhatsAppConnection[];
  draftChannelId?: string;
  onDraftChannelChange?: (connectionId: string) => void;
  onExport?: () => void;
  onGetAiSuggestions?: () => Promise<string[]>;
};

function messageShowsTail(messages: Conversation['messages'], index: number): boolean {
  const cur = messages?.[index];
  const prev = messages?.[index - 1];
  if (!cur) return true;
  return !prev || prev.sender !== cur.sender;
}

export const WaThread: React.FC<Props> = memo(function WaThread({
  conversation,
  display,
  avatarSrc,
  loadingHistory,
  historyExhausted,
  canSend,
  socketStatus,
  syncing = false,
  chipConnected,
  connectionName,
  showConnectionLabel = false,
  showBack,
  onBack,
  onLoadOlder,
  onSend,
  onAttach,
  sendingMedia,
  onOpenContactInfo,
  hideOnMobile,
  onLoadMedia,
  isDraft,
  draftChannels,
  draftChannelId,
  onDraftChannelChange,
  onExport,
  onGetAiSuggestions,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPreserveRef = useRef<{ id: string; height: number; top: number } | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const messages = conversation?.messages ?? [];
  const virtualRows = useMemo(() => buildVirtualRows(messages), [messages]);

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (virtualRows[i]?.kind === 'date' ? 36 : 72),
    overscan: 8,
    getItemKey: (i) => virtualRows[i]?.id ?? i,
    measureElement: (el) => el.getBoundingClientRect().height
  });

  const primary = conversation ? inboxListTitle(display ?? undefined, conversation) : '';

  const presenceLine = useMemo(
    () => formatContactPresenceSubtitle(conversation),
    [conversation?.waPresence, conversation?.waLastSeenMs, conversation?.waPresenceUpdatedAt]
  );

  const headerSub = useMemo(() => {
    if (!conversation) return '';
    if (!chipConnected) return 'Chip WhatsApp desconectado — conecte em Conexões';
    if (showConnectionLabel && connectionName) {
      return `Via ${connectionName}${presenceLine ? ` · ${presenceLine}` : ''}`;
    }
    if (!connectionName && showConnectionLabel) return 'Conexão não identificada';
    if (syncing) return 'Sincronizando conversas…';
    if (socketStatus === 'offline') return 'Servidor desconectado';
    if (socketStatus === 'slow') return 'Conexão instável — mensagens em tempo real ativas';
    if (presenceLine) return presenceLine;
    return display?.phoneSecondary || display?.whatsappSubtitle || '';
  }, [
    conversation,
    chipConnected,
    showConnectionLabel,
    connectionName,
    syncing,
    socketStatus,
    presenceLine,
    display?.phoneSecondary,
    display?.whatsappSubtitle
  ]);

  const headerPresenceKind = useMemo(() => {
    if (!presenceLine) return '';
    if (presenceLine === 'online') return 'online';
    if (presenceLine.startsWith('digitando') || presenceLine.startsWith('gravando')) return 'active';
    if (presenceLine.startsWith('visto')) return 'last-seen';
    return '';
  }, [presenceLine]);

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !conversation?.id) return;

    if (
      scrollPreserveRef.current &&
      conversation.id === scrollPreserveRef.current.id
    ) {
      const delta = el.scrollHeight - scrollPreserveRef.current.height;
      el.scrollTop = scrollPreserveRef.current.top + delta;
      scrollPreserveRef.current = null;
      return;
    }

    if (messages.length === 0) return;
    if (isNearBottom()) scrollToBottom();
  }, [conversation?.id, messages.length, messages[messages.length - 1]?.id, isNearBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !conversation?.id) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(fromBottom > 160);
    if (
      el.scrollTop < 180 &&
      !loadingHistory &&
      !historyExhausted
    ) {
      scrollPreserveRef.current = {
        id: conversation.id,
        height: el.scrollHeight,
        top: el.scrollTop
      };
      onLoadOlder();
    }
  }, [conversation?.id, loadingHistory, historyExhausted, onLoadOlder]);

  if (!conversation) {
    return (
      <section className="wa-empty-pro flex-1 min-w-0" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 wa-empty-pro__icon"
          style={{
            background: 'linear-gradient(135deg, rgba(37,211,102,0.18), rgba(18,140,126,0.08))',
            border: '1.5px solid rgba(37,211,102,0.28)',
          }}
        >
          <Lock className="w-8 h-8 opacity-80" style={{ color: 'var(--wa-green-strong)' }} />
        </div>
        <h2>ZapMass Atendimento</h2>
        <p>
          Selecione uma conversa na lista ao lado. Mensagens em tempo real, histórico completo e nomes da sua agenda CRM.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          <span className="wa-empty-zap-badge">Criptografia de ponta a ponta</span>
          <span className="wa-empty-zap-badge">Multi-chip</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="wa-chat-pane flex flex-col flex-1 min-w-0 min-h-0"
      data-hide-mobile={hideOnMobile ? 'true' : undefined}
    >
      <header className="wa-chat-header">
        {showBack && (
          <button type="button" className="wa-icon-btn md:hidden" onClick={onBack} aria-label="Voltar">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <img
          src={avatarSrc}
          alt=""
          className="wa-conv-avatar"
          width={40}
          height={40}
          onError={(e) => {
            const el = e.currentTarget;
            el.onerror = null;
            el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(primary)}&background=00a884&color=fff&size=200&bold=true`;
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p
              className={`wa-chat-header-title truncate flex-1 min-w-0${display?.fromDatabase ? ' wa-chat-header-title--crm' : ''}`}
            >
              {primary}
            </p>
            {showConnectionLabel && connectionName && (
              <span className="wa-chat-channel-pill flex-shrink-0" title={`Canal: ${connectionName}`}>
                {connectionName}
              </span>
            )}
          </div>
          <p
            className="wa-chat-header-sub truncate"
            data-presence={headerPresenceKind || undefined}
          >
            {headerSub}
          </p>
        </div>
        {onOpenContactInfo && (
          <button
            type="button"
            className="wa-icon-btn flex-shrink-0"
            onClick={onOpenContactInfo}
            aria-label="Dados do contato e CRM"
            title="Ficha do cliente"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        )}
      </header>

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="wa-chat-wallpaper absolute inset-0 overflow-y-auto"
          onScroll={handleScroll}
        >
          {!historyExhausted && messages.length > 0 && (
            <div className="flex justify-center pt-3 sticky top-0 z-[1]">
              <button
                type="button"
                className="wa-history-btn"
                onClick={onLoadOlder}
                disabled={loadingHistory}
              >
                {loadingHistory ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <History className="w-4 h-4" />
                )}
                Carregar mensagens anteriores
              </button>
            </div>
          )}

          {messages.length === 0 && !loadingHistory && (
            <p className="text-center text-[13px] py-12" style={{ color: 'var(--wa-text-3)' }}>
              {isDraft
                ? 'Nova conversa — envie a primeira mensagem pelo canal escolhido abaixo.'
                : 'Nenhuma mensagem nesta conversa ainda.'}
            </p>
          )}

          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((row) => {
              const vr = virtualRows[row.index];
              if (!vr) return null;

              if (vr.kind === 'date') {
                return (
                  <div
                    key={vr.id}
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    className="wa-date-pill absolute left-0 w-full"
                    style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                  >
                    <span>{vr.label}</span>
                  </div>
                );
              }

              const msg = messages[vr.index];
              if (!msg) return null;
              const side = msg.sender === 'me' ? 'out' : 'in';

              return (
                <div
                  key={vr.id}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  className="absolute left-0 w-full"
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  <WaBubble
                    side={side}
                    showTail={messageShowsTail(messages, vr.index)}
                    status={msg.status}
                    time={formatMsgTime(msg)}
                    fromCampaign={msg.fromCampaign}
                  >
                    <WaMessageContent msg={msg} onLoadMedia={onLoadMedia} />
                  </WaBubble>
                </div>
              );
            })}
          </div>
        </div>

        {showScrollDown && (
          <button
            type="button"
            className="absolute bottom-4 right-4 z-[2] w-10 h-10 rounded-full shadow-md flex items-center justify-center"
            style={{ background: 'var(--wa-panel,#fff)', color: 'var(--wa-text-2)' }}
            onClick={() => scrollToBottom(true)}
            aria-label="Ir para mensagens recentes"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
        )}
      </div>

      <WaComposer
        disabled={!canSend}
        disabledHint={canSend ? undefined : 'Conecte um chip WhatsApp para enviar'}
        sendingMedia={sendingMedia}
        onSend={onSend}
        onAttach={canSend ? onAttach : undefined}
        onExport={onExport}
        onGetAiSuggestions={onGetAiSuggestions}
        isDraft={isDraft}
        draftChannels={draftChannels}
        draftChannelId={draftChannelId}
        onDraftChannelChange={onDraftChannelChange}
      />
    </section>
  );
});
