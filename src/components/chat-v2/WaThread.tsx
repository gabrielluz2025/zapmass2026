import React, { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, History, Loader2, Lock, MoreVertical } from 'lucide-react';
import type { Conversation } from '../../types';
import { WaBubble } from '../chat/wa/WaBubble';
import { WaComposer } from './WaComposer';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { inboxListTitle } from './lib/conversationDisplay';
import { formatDayLabel, formatMsgTime, messageDayKey } from './lib/messageTime';
import { formatMessageBubbleText } from './lib/chatPreview';
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
  chipConnected: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onLoadOlder: () => void;
  onSend: (text: string) => void;
  onAttach?: (file: File, caption?: string) => void;
  sendingMedia?: boolean;
  onOpenContactInfo?: () => void;
  hideOnMobile?: boolean;
};

export const WaThread: React.FC<Props> = ({
  conversation,
  display,
  avatarSrc,
  loadingHistory,
  historyExhausted,
  canSend,
  socketStatus,
  chipConnected,
  showBack,
  onBack,
  onLoadOlder,
  onSend,
  onAttach,
  sendingMedia,
  onOpenContactInfo,
  hideOnMobile
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = conversation?.messages ?? [];
  const virtualRows = useMemo(() => buildVirtualRows(messages), [messages]);

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (virtualRows[i]?.kind === 'date' ? 36 : 52),
    overscan: 14,
    getItemKey: (i) => virtualRows[i]?.id ?? i,
    measureElement: (el) => el.getBoundingClientRect().height
  });

  const primary = conversation ? inboxListTitle(display ?? undefined, conversation) : '';

  const grouped = useMemo(() => {
    const out: boolean[] = [];
    for (let i = 0; i < messages.length; i++) {
      const cur = messages[i];
      const prev = messages[i - 1];
      out.push(!prev || prev.sender !== cur.sender);
    }
    return out;
  }, [messages]);

  const headerSub = useMemo(() => {
    if (!conversation) return '';
    if (!chipConnected) return 'Chip WhatsApp desconectado — conecte em Conexões';
    if (socketStatus === 'offline') return 'Servidor desconectado';
    if (socketStatus === 'slow') return 'Servidor lento — mensagens em tempo real ativas';
    return display?.phoneSecondary || display?.whatsappSubtitle || 'online';
  }, [
    conversation,
    chipConnected,
    socketStatus,
    display?.phoneSecondary,
    display?.whatsappSubtitle
  ]);

  useEffect(() => {
    if (!scrollRef.current || messages.length === 0) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversation?.id, messages.length, messages[messages.length - 1]?.id]);

  if (!conversation) {
    return (
      <section className="wa-empty-pro flex-1 min-w-0" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
        <Lock className="w-14 h-14 mb-5 opacity-30" style={{ color: 'var(--wa-green-strong)' }} />
        <h2>ZapMass · Atendimento</h2>
        <p>
          Envie e receba mensagens com a mesma experiência do WhatsApp Web: histórico completo,
          sincronização em tempo real e nomes da sua agenda ou CRM.
        </p>
        <span className="wa-empty-zap-badge mt-6">Criptografia de ponta a ponta</span>
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
          <p className="wa-chat-header-title truncate">{primary}</p>
          <p className="wa-chat-header-sub truncate">{headerSub}</p>
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

      <div ref={scrollRef} className="wa-chat-wallpaper flex-1 min-h-0 overflow-y-auto">
        {!historyExhausted && (
          <div className="flex justify-center pt-3">
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
            Nenhuma mensagem nesta conversa ainda.
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
                  showTail={grouped[vr.index]}
                  status={msg.status}
                  time={formatMsgTime(msg)}
                  fromCampaign={msg.fromCampaign}
                >
                  {formatMessageBubbleText(msg)}
                </WaBubble>
              </div>
            );
          })}
        </div>
      </div>

      <WaComposer
        disabled={!canSend}
        disabledHint={canSend ? undefined : 'Conecte um chip WhatsApp para enviar'}
        sendingMedia={sendingMedia}
        onSend={onSend}
        onAttach={canSend ? onAttach : undefined}
      />
    </section>
  );
};
