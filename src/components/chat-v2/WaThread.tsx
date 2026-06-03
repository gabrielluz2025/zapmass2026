import React, { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, Check, CheckCheck, History, Loader2, Lock } from 'lucide-react';
import type { ChatMessage, Conversation } from '../../types';
import { WaAvatar } from './WaAvatar';
import { WaComposer } from './WaComposer';
import { inboxListTitle, type ConversationDisplay } from './lib/conversationDisplay';

function formatMsgTime(msg: ChatMessage): string {
  if (typeof msg.timestampMs === 'number' && msg.timestampMs > 0) {
    return new Date(msg.timestampMs).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  const raw = String(msg.timestamp || '').trim();
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    return raw.slice(-8);
  }
  return '';
}

function StatusTicks({ status }: { status?: ChatMessage['status'] }) {
  if (status === 'read') {
    return <CheckCheck className="w-4 h-4" style={{ color: 'var(--wv2-tick-read)' }} strokeWidth={2.5} />;
  }
  if (status === 'delivered') {
    return <CheckCheck className="w-4 h-4 opacity-70" strokeWidth={2.5} />;
  }
  return <Check className="w-4 h-4 opacity-70" strokeWidth={2.5} />;
}

type Props = {
  conversation: Conversation | null;
  display: ConversationDisplay | null;
  avatarSrc: string;
  loadingHistory: boolean;
  historyExhausted: boolean;
  canSend: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onLoadOlder: () => void;
  onSend: (text: string) => void;
  hideOnMobile?: boolean;
};

export const WaThread: React.FC<Props> = ({
  conversation,
  display,
  avatarSrc,
  loadingHistory,
  historyExhausted,
  canSend,
  showBack,
  onBack,
  onLoadOlder,
  onSend,
  hideOnMobile
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = conversation?.messages ?? [];

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
    getItemKey: (i) => messages[i]?.id ?? i
  });

  const primary = conversation
    ? inboxListTitle(display ?? undefined, conversation)
    : 'Contato';

  useEffect(() => {
    if (!scrollRef.current || messages.length === 0) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversation?.id, messages.length, messages[messages.length - 1]?.id]);

  const grouped = useMemo(() => {
    const out: boolean[] = [];
    for (let i = 0; i < messages.length; i++) {
      const cur = messages[i];
      const prev = messages[i - 1];
      out.push(!prev || prev.sender !== cur.sender);
    }
    return out;
  }, [messages]);

  if (!conversation) {
    return (
      <section className="wa-v2-thread wa-v2-empty-hero" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
        <div
          className="max-w-md rounded-lg px-8 py-10"
          style={{ background: '#fff', boxShadow: '0 2px 8px rgba(11,20,26,0.08)' }}
        >
          <h2 className="text-[22px] font-light mb-3" style={{ color: 'var(--wv2-green-dark)' }}>
            WhatsApp Web
          </h2>
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--wv2-text-2)' }}>
            Selecione uma conversa à esquerda para enviar e receber mensagens.
          </p>
          <p className="text-[13px] mt-6 flex items-center justify-center gap-2" style={{ color: 'var(--wv2-text-3)' }}>
            <Lock className="w-4 h-4" />
            Suas mensagens são sincronizadas com o WhatsApp conectado.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="wa-v2-thread flex flex-col min-h-0" data-hide-mobile={hideOnMobile ? 'true' : undefined}>
      <header className="wa-v2-header">
        {showBack && (
          <button type="button" className="md:hidden p-2 -ml-2" onClick={onBack} aria-label="Voltar">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <WaAvatar src={avatarSrc} name={primary} size={40} />
        <div className="flex-1 min-w-0">
          <p className="text-[16px] truncate">{primary}</p>
          {display?.phoneSecondary && (
            <p className="text-[13px] truncate" style={{ color: 'var(--wv2-text-3)' }}>
              {display.phoneSecondary}
            </p>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto py-3">
        {!historyExhausted && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingHistory}
              className="text-[13px] px-4 py-1.5 rounded-full flex items-center gap-2"
              style={{ background: 'rgba(255,255,255,0.92)', color: 'var(--wv2-green-dark)' }}
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

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const msg = messages[row.index];
            if (!msg) return null;
            const side = msg.sender === 'me' ? 'out' : 'in';
            const showTail = grouped[row.index];

            return (
              <div
                key={msg.id}
                className={`absolute left-0 w-full flex px-4 my-[2px] ${side === 'out' ? 'justify-end' : 'justify-start'}`}
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              >
                <div className="wa-v2-bubble" data-side={side} data-tail={showTail ? 'true' : 'false'}>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</span>
                  <span className="wa-v2-bubble-meta">
                    {formatMsgTime(msg)}
                    {side === 'out' && <StatusTicks status={msg.status} />}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <WaComposer disabled={!canSend} onSend={onSend} />
    </section>
  );
};
