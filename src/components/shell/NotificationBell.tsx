import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  Loader2,
  Send,
  Trash2,
  X
} from 'lucide-react';
import { useNotifications, type AppNotificationRow } from '../../context/NotificationContext';
import { useAppView } from '../../context/AppViewContext';
import { Button, Modal } from '../ui';

const kindStyles: Record<string, { dot: string; accent: string }> = {
  success: { dot: 'bg-emerald-500', accent: '#10b981' },
  warning: { dot: 'bg-amber-500', accent: '#f59e0b' },
  error: { dot: 'bg-red-500', accent: '#ef4444' },
  info: { dot: 'bg-indigo-500', accent: '#6366f1' }
};

const categoryLabel: Record<string, string> = {
  campaign: 'Campanha',
  schedule: 'Agendamento',
  billing: 'Assinatura',
  system: 'Sistema',
  admin: 'Administrador',
  other: 'Outro'
};

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, remove } = useNotifications();
  const { setCurrentView } = useAppView();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AppNotificationRow | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const navigateToCampaign = (campaignId: string) => {
    try {
      sessionStorage.setItem('zapmass.openCampaignById', campaignId);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('zapmass-open-campaign', { detail: { campaignId } }));
    setCurrentView('campaigns');
    setDetail(null);
    setOpen(false);
  };

  const openNotificationDetail = (n: AppNotificationRow) => {
    setDetail(n);
    if (!n.read) void markAsRead(n.id);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const dSt = detail ? kindStyles[detail.kind] || kindStyles.info : null;
  const dCat = detail ? categoryLabel[detail.category] || detail.category || 'Outro' : '';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Modal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title || 'Notificação'}
        subtitle={detail ? `${dCat} · ${formatTime(detail.createdAtMs)}` : undefined}
        icon={detail ? <span className={`inline-block w-2.5 h-2.5 rounded-full ${dSt?.dot || ''}`} /> : undefined}
        size="md"
        footer={
          detail ? (
            <div className="flex flex-wrap items-center justify-end gap-2 w-full">
              {detail.campaignId ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<Send className="w-3.5 h-3.5" />}
                  onClick={() => navigateToCampaign(detail.campaignId!)}
                >
                  Ver campanha
                </Button>
              ) : null}
              {detail.category === 'billing' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
                  onClick={() => {
                    setCurrentView('subscription');
                    setDetail(null);
                    setOpen(false);
                  }}
                >
                  Minha assinatura
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => void remove(detail.id)}>
                Apagar
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setDetail(null)}>
                Fechar
              </Button>
            </div>
          ) : undefined
        }
      >
        {detail ? (
          <div className="space-y-3 text-left">
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
              {detail.body}
            </p>
            {detail.campaignId ? (
              <p className="text-[11px] rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                Refere-se à campanha{' '}
                <code className="text-[11px] font-mono" style={{ color: 'var(--text-2)' }}>
                  {detail.campaignId}
                </code>
                . Use «Ver campanha» para abrir o relatório.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:brightness-105"
        style={{
          background: 'var(--surface-2)',
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-2)'
        }}
        title="Notificações"
        aria-label="Notificações"
        aria-expanded={open}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 ? (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center text-white"
            style={{ background: '#dc2626' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[70] bg-black/40 sm:bg-transparent sm:pointer-events-none"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="fixed sm:absolute z-[71] inset-x-2 top-16 sm:inset-auto sm:right-0 sm:top-[calc(100%+8px)] w-auto sm:w-[min(100vw-2rem,400px)] max-h-[min(80vh,520px)] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              boxShadow: '0 24px 48px rgba(0,0,0,.2)'
            }}
          >
            <div
              className="flex items-center justify-between gap-2 px-4 py-3 border-b"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div>
                <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                  Notificações
                </p>
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Campanhas, agendamentos, assinatura e mais
                </p>
              </div>
              <button
                type="button"
                className="p-1.5 rounded-lg sm:hidden hover:opacity-80"
                style={{ color: 'var(--text-3)' }}
                onClick={() => setOpen(false)}
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllAsRead()}
                  className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--brand-600)'
                  }}
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Marcar lidas
                </button>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2 pb-4">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-14 gap-2" style={{ color: 'var(--text-3)' }}>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-[13px]">A carregar…</span>
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <Bell className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>
                    Sem notificações
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                    Quando houver algo importante, aparece aqui (também fica registado mesmo com o pc desligado).
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {notifications.map((n) => {
                    const st = kindStyles[n.kind] || kindStyles.info;
                    const cat =
                      categoryLabel[n.category] || n.category || 'Outro';
                    return (
                      <li
                        key={n.id}
                        className="rounded-xl text-left transition-colors"
                        style={{
                          background: n.read ? 'var(--surface-1)' : 'var(--surface-2)',
                          borderLeft: `4px solid ${st.accent}`
                        }}
                      >
                        <button
                          type="button"
                          className="w-full text-left p-3 rounded-xl cursor-pointer hover:brightness-[1.02] active:brightness-[0.98]"
                          style={{ color: 'inherit' }}
                          onClick={() => openNotificationDetail(n)}
                        >
                          <div className="flex gap-2 pointer-events-none">
                            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                                <span
                                  className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                                  style={{
                                    background: 'rgba(99,102,241,0.12)',
                                    color: 'var(--text-3)'
                                  }}
                                >
                                  {cat}
                                </span>
                                {!n.read ? (
                                  <span className="text-[10px] font-bold text-sky-600">Nova</span>
                                ) : null}
                                <span className="text-[10px] ml-auto tabular-nums" style={{ color: 'var(--text-3)' }}>
                                  {formatTime(n.createdAtMs)}
                                </span>
                              </div>
                              <p className="text-[13px] font-bold leading-snug" style={{ color: 'var(--text-1)' }}>
                                {n.title}
                              </p>
                              <p
                                className="text-[12px] mt-1 line-clamp-2 whitespace-pre-wrap leading-relaxed"
                                style={{ color: 'var(--text-2)' }}
                              >
                                {n.body}
                              </p>
                              <p className="text-[10px] mt-1.5 font-medium" style={{ color: 'var(--brand-600)' }}>
                                Toque para ver o conteúdo completo
                                {n.campaignId ? ' · campanha ligada' : ''}
                              </p>
                            </div>
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-0">
                          {!n.read ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void markAsRead(n.id);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg"
                              style={{
                                background: 'var(--surface-0)',
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--brand-600)'
                              }}
                            >
                              <Check className="w-3.5 h-3.5" />
                              Marcar como lida
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void remove(n.id);
                              if (detail?.id === n.id) setDetail(null);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg opacity-80 hover:opacity-100"
                            style={{
                              color: 'var(--text-3)'
                            }}
                            title="Remover"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Apagar
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {unreadCount > 0 ? (
              <div
                className="sm:hidden flex justify-center py-2 border-t px-3"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <button
                  type="button"
                  onClick={() => void markAllAsRead()}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold py-2"
                  style={{ color: 'var(--brand-600)' }}
                >
                  <CheckCheck className="w-4 h-4" />
                  Marcar todas como lidas
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
