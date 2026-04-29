import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Inbox, Layers, Pencil, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Conversation } from '../../types';
import type { ClientPipelineBoardPersisted, PipelineColumnDef } from '../../utils/clientPipelineBoardStorage';
import {
  defaultPipelineState,
  loadClientPipeline,
  saveClientPipeline
} from '../../utils/clientPipelineBoardStorage';
import { Button, Input, Modal } from '../ui';
import toast from 'react-hot-toast';

const DND_TYPE = 'application/x-zapmass-conversation';

const newColumnId = () => `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Faixa de cor no topo de cada coluna (ciclo). */
const COLUMN_ACCENTS = [
  'linear-gradient(90deg, #f59e0b, #ea580c)',
  'linear-gradient(90deg, #8b5cf6, #6366f1)',
  'linear-gradient(90deg, #0ea5e9, #06b6d4)',
  'linear-gradient(90deg, #10b981, #059669)',
  'linear-gradient(90deg, #ec4899, #f43f5e)',
  'linear-gradient(90deg, #eab308, #ca8a04)'
];

function truncateText(s: string, max: number): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

interface ClientPipelineBoardProps {
  userUid: string | null | undefined;
  conversations: Conversation[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  getConvAvatar: (conv: Conversation) => string;
  connectionName?: (connectionId: string) => string | undefined;
  formatConversationTitles?: (
    conv: Conversation
  ) => { primary: string; whatsappSubtitle?: string };
}

export const ClientPipelineBoard: React.FC<ClientPipelineBoardProps> = ({
  userUid,
  conversations,
  selectedChatId,
  onSelectChat,
  getConvAvatar,
  connectionName,
  formatConversationTitles
}) => {
  const [state, setState] = useState<ClientPipelineBoardPersisted>(() => defaultPipelineState());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renameOpen, setRenameOpen] = useState<{ id: string; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [deleteAsk, setDeleteAsk] = useState<PipelineColumnDef | null>(null);
  const newColInputRef = useRef<HTMLInputElement>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const columnsScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollBoardX, setCanScrollBoardX] = useState({ left: false, right: false });

  const updateBoardScrollHints = useCallback(() => {
    const el = columnsScrollRef.current;
    if (!el) return;
    const { scrollLeft, clientWidth, scrollWidth } = el;
    setCanScrollBoardX({
      left: scrollLeft > 6,
      right: scrollLeft + clientWidth < scrollWidth - 6
    });
  }, []);

  useEffect(() => {
    setState(loadClientPipeline(userUid));
  }, [userUid]);

  const scheduleSave = useCallback(
    (next: ClientPipelineBoardPersisted) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        saveClientPipeline(userUid, next);
      }, 350);
    },
    [userUid]
  );

  const firstColId = state.columns[0]?.id;

  const convsByColumn = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of state.columns) map.set(c.id, []);
    const fallback = firstColId || '';
    for (const conv of conversations) {
      let col = state.cardColumn[conv.id];
      if (!col || !map.has(col)) col = fallback;
      if (!map.has(col)) continue;
      map.get(col)!.push(conv);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));
    }
    return map;
  }, [conversations, state.columns, state.cardColumn, firstColId]);

  const totalInBoard = useMemo(
    () => Array.from(convsByColumn.values()).reduce((n, list) => n + list.length, 0),
    [convsByColumn]
  );

  useEffect(() => {
    const el = columnsScrollRef.current;
    if (!el) return;
    updateBoardScrollHints();
    const onScroll = () => updateBoardScrollHints();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateBoardScrollHints());
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [updateBoardScrollHints, state.columns.length, conversations.length, state.cardColumn]);

  const scrollBoardBy = useCallback((dir: 'left' | 'right') => {
    const el = columnsScrollRef.current;
    if (!el) return;
    const step = Math.min(320, Math.max(220, el.clientWidth * 0.45));
    el.scrollBy({ left: dir === 'right' ? step : -step, behavior: 'smooth' });
  }, []);

  const moveCard = (conversationId: string, columnId: string) => {
    setState((prev) => {
      const next = {
        ...prev,
        cardColumn: { ...prev.cardColumn, [conversationId]: columnId }
      };
      scheduleSave(next);
      return next;
    });
  };

  const submitNewColumn = (keepModalOpen: boolean) => {
    const name = newColName.trim() || 'Nova coluna';
    const id = newColumnId();
    setState((prev) => {
      const next = { ...prev, columns: [...prev.columns, { id, name }] };
      scheduleSave(next);
      return next;
    });
    setNewColName('');
    if (!keepModalOpen) setAddOpen(false);
    else setTimeout(() => newColInputRef.current?.focus(), 0);
    toast.success(`Coluna "${name}" criada.`);
  };

  const applyRename = () => {
    if (!renameOpen) return;
    const name = renameOpen.name.trim();
    if (!name) {
      toast.error('Nome nao pode ficar vazio.');
      return;
    }
    setState((prev) => {
      const next = {
        ...prev,
        columns: prev.columns.map((c) => (c.id === renameOpen.id ? { ...c, name } : c))
      };
      scheduleSave(next);
      return next;
    });
    setRenameOpen(null);
  };

  const confirmDeleteColumn = () => {
    if (!deleteAsk) return;
    if (state.columns.length <= 1) {
      toast.error('Mantenha ao menos uma coluna.');
      setDeleteAsk(null);
      return;
    }
    const victimId = deleteAsk.id;
    setState((prev) => {
      const fc = prev.columns[0]?.id;
      const target = fc === victimId ? prev.columns.find((c) => c.id !== victimId)?.id : fc;
      if (!target) return prev;
      const cardColumn = { ...prev.cardColumn };
      for (const [cid, col] of Object.entries(cardColumn)) {
        if (col === victimId) cardColumn[cid] = target;
      }
      const columns = prev.columns.filter((c) => c.id !== victimId);
      const next = { ...prev, columns, cardColumn };
      scheduleSave(next);
      return next;
    });
    toast.success('Coluna removida; cartoes foram movidos.');
    setDeleteAsk(null);
  };

  const onDragStart = (e: React.DragEvent, conversationId: string) => {
    e.dataTransfer.setData(DND_TYPE, conversationId);
    e.dataTransfer.setData('text/plain', conversationId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOverCol = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  };

  const onDragLeaveCol = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOverColumn(null);
  };

  const onDropCol = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    const id = e.dataTransfer.getData(DND_TYPE) || e.dataTransfer.getData('text/plain');
    if (!id) return;
    moveCard(id, columnId);
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {/* Barra de contexto do funil */}
        <div
          className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-3"
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 35%, var(--surface-0)) 0%, var(--surface-0) 100%)'
          }}
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              className="inline-flex items-center gap-2 rounded-full pl-2 pr-3 py-1.5 text-[11px] font-semibold"
              style={{
                background: 'color-mix(in srgb, var(--brand-500) 12%, var(--surface-1))',
                border: '1px solid color-mix(in srgb, var(--brand-500) 28%, transparent)',
                color: 'var(--text-2)'
              }}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-500)' }} aria-hidden />
              <span className="tabular-nums">{state.columns.length}</span>
              <span className="font-medium opacity-90">etapa{state.columns.length === 1 ? '' : 's'}</span>
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-3)'
              }}
            >
              <span className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
                {totalInBoard}
              </span>
              contacto{totalInBoard === 1 ? '' : 's'} no quadro
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => {
              setNewColName('');
              setAddOpen(true);
            }}
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
              boxShadow: '0 8px 20px -6px rgba(245, 158, 11, 0.45)'
            }}
          >
            Nova etapa
          </Button>
        </div>

        {/* Área de colunas — “mesa” com profundidade + deslize horizontal */}
        <div className="relative flex min-h-0 flex-1 min-w-0 flex-col">
          {canScrollBoardX.left && (
            <button
              type="button"
              onClick={() => scrollBoardBy('left')}
              className="absolute left-2 top-1/2 z-[5] -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-opacity hover:opacity-95 md:left-3"
              style={{
                background: 'color-mix(in srgb, var(--surface-1) 92%, var(--surface-0))',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-1)',
                boxShadow: '0 8px 24px -8px rgba(0,0,0,0.45)'
              }}
              title="Deslizar quadro para a esquerda"
              aria-label="Deslizar quadro para a esquerda"
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={2.25} aria-hidden />
            </button>
          )}
          {canScrollBoardX.right && (
            <button
              type="button"
              onClick={() => scrollBoardBy('right')}
              className="absolute right-2 top-1/2 z-[5] -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-opacity hover:opacity-95 md:right-3"
              style={{
                background: 'color-mix(in srgb, var(--surface-1) 92%, var(--surface-0))',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-1)',
                boxShadow: '0 8px 24px -8px rgba(0,0,0,0.45)'
              }}
              title="Deslizar quadro para a direita"
              aria-label="Deslizar quadro para a direita"
            >
              <ChevronRight className="w-5 h-5" strokeWidth={2.25} aria-hidden />
            </button>
          )}
          <div
            ref={columnsScrollRef}
            className="relative flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden scroll-smooth px-3 sm:px-4 pb-3 pt-3"
            style={{
              background:
                'radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in srgb, var(--brand-500) 7%, transparent) 0%, transparent 52%), linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 28%, var(--surface-0)) 0%, var(--surface-0) 100%)'
            }}
          >
          {state.columns.map((col, colIdx) => {
            const list = convsByColumn.get(col.id) || [];
            const accent = COLUMN_ACCENTS[colIdx % COLUMN_ACCENTS.length];
            const isDrop = dragOverColumn === col.id;
            return (
              <div
                key={col.id}
                className="flex w-[min(100%,280px)] flex-shrink-0 flex-col rounded-2xl min-h-0 transition-[box-shadow,border-color,transform] duration-200"
                style={{
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 92%, var(--surface-2)) 0%, var(--surface-1) 100%)',
                  border: `1px solid ${isDrop ? 'color-mix(in srgb, var(--brand-500) 55%, transparent)' : 'var(--border-subtle)'}`,
                  boxShadow: isDrop
                    ? '0 0 0 2px color-mix(in srgb, var(--brand-500) 35%, transparent), 0 12px 40px -12px rgba(0,0,0,0.35)'
                    : '0 8px 30px -12px rgba(0,0,0,0.2), inset 0 1px 0 color-mix(in srgb, #fff 6%, transparent)'
                }}
                onDragOver={(e) => onDragOverCol(e, col.id)}
                onDragLeave={onDragLeaveCol}
                onDrop={(e) => onDropCol(e, col.id)}
              >
                <div className="h-[3px] w-full flex-shrink-0 rounded-t-[13px] overflow-hidden" style={{ background: accent }} aria-hidden />
                <div
                  className="flex items-start justify-between gap-2 px-3 pt-3 pb-2 flex-shrink-0"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[13px] font-bold truncate tracking-tight" style={{ color: 'var(--text-1)' }}>
                      {col.name}
                    </p>
                    <span
                      className="inline-flex mt-1.5 tabular-nums text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                      style={{
                        background: 'var(--surface-2)',
                        color: 'var(--text-3)',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      {list.length} · contacto{list.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      type="button"
                      className="p-2 rounded-lg transition-colors hover:brightness-110"
                      style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
                      title="Renomear coluna"
                      onClick={() => setRenameOpen({ id: col.id, name: col.name })}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-2 rounded-lg transition-colors hover:brightness-110"
                      style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
                      title="Remover coluna"
                      onClick={() => setDeleteAsk(col)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2.5 p-2.5 min-h-0">
                  {list.map((conv) => {
                    const active = selectedChatId === conv.id;
                    const conn = connectionName?.(conv.connectionId);
                    const titles = formatConversationTitles?.(conv);
                    const primary = titles?.primary ?? conv.contactName;
                    const waSub = titles?.whatsappSubtitle;
                    const preview =
                      conv.lastMessage && conv.lastMessage !== '[Mídia]'
                        ? truncateText(conv.lastMessage, 72)
                        : conv.lastMessageTime
                          ? conv.lastMessageTime
                          : '';
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        draggable
                        onDragStart={(e) => onDragStart(e, conv.id)}
                        onDragEnd={() => setDragOverColumn(null)}
                        onClick={() => onSelectChat(conv.id)}
                        className="w-full text-left rounded-xl px-2.5 py-2.5 transition-all duration-200 border group"
                        style={{
                          background: active
                            ? 'linear-gradient(135deg, color-mix(in srgb, var(--brand-500) 14%, var(--surface-0)) 0%, var(--surface-0) 100%)'
                            : 'var(--surface-0)',
                          borderColor: active
                            ? 'color-mix(in srgb, var(--brand-500) 45%, transparent)'
                            : 'var(--border-subtle)',
                          boxShadow: active
                            ? '0 6px 20px -8px color-mix(in srgb, var(--brand-500) 25%, transparent), inset 0 1px 0 color-mix(in srgb, #fff 8%, transparent)'
                            : '0 4px 14px -10px rgba(0,0,0,0.25), inset 0 1px 0 color-mix(in srgb, #fff 4%, transparent)'
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <GripVertical
                            className="w-3.5 h-3.5 flex-shrink-0 mt-2 opacity-35 group-hover:opacity-70 cursor-grab active:cursor-grabbing"
                            style={{ color: 'var(--text-3)' }}
                            aria-hidden
                          />
                          <img
                            src={getConvAvatar(conv)}
                            className="w-10 h-10 rounded-xl object-cover flex-shrink-0 ring-1 ring-black/5"
                            alt=""
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-bold leading-tight truncate" style={{ color: 'var(--text-1)' }}>
                              {primary}
                            </p>
                            {waSub && (
                              <p className="text-[10px] truncate opacity-90 mt-0.5" style={{ color: 'var(--text-3)' }} title="Nome no WhatsApp">
                                {waSub}
                              </p>
                            )}
                            {preview && (
                              <p className="text-[10px] leading-snug mt-1 line-clamp-2" style={{ color: 'var(--text-3)' }}>
                                {preview}
                              </p>
                            )}
                            <p className="text-[9.5px] truncate mt-1 font-medium" style={{ color: 'var(--text-3)', opacity: 0.85 }}>
                              {conn ? `${conn} · ` : ''}
                              {conv.contactPhone}
                            </p>
                            {conv.unreadCount > 0 && (
                              <span
                                className="inline-block mt-1 text-[9.5px] font-bold px-2 py-0.5 rounded-full"
                                style={{
                                  background: 'linear-gradient(135deg, var(--brand-500), var(--brand-600))',
                                  color: '#fff',
                                  boxShadow: '0 2px 8px -2px color-mix(in srgb, var(--brand-500) 50%, transparent)'
                                }}
                              >
                                {conv.unreadCount} nova{conv.unreadCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {list.length === 0 && (
                    <div
                      className="flex flex-col items-center justify-center text-center py-10 px-3 rounded-xl mx-0.5"
                      style={{
                        border: '2px dashed color-mix(in srgb, var(--border-subtle) 85%, var(--brand-500))',
                        background: 'color-mix(in srgb, var(--surface-0) 70%, transparent)'
                      }}
                    >
                      <Inbox className="w-8 h-8 mb-2 opacity-40" style={{ color: 'var(--text-3)' }} aria-hidden />
                      <p className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                        Nada nesta etapa
                      </p>
                      <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                        Arraste um contacto da lista ou aguarde novas mensagens neste canal.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setNewColName('');
              setAddOpen(true);
            }}
            className="flex w-[min(100%,104px)] flex-shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition-all duration-200 self-stretch min-h-[180px] hover:scale-[1.01] active:scale-[0.99]"
            style={{
              borderColor: 'color-mix(in srgb, var(--brand-500) 40%, transparent)',
              color: 'var(--brand-600)',
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--brand-500) 8%, var(--surface-0)) 0%, var(--surface-1) 100%)',
              boxShadow: 'inset 0 1px 0 color-mix(in srgb, #fff 5%, transparent)'
            }}
          >
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{
                background: 'color-mix(in srgb, var(--brand-500) 16%, transparent)',
                border: '1px solid color-mix(in srgb, var(--brand-500) 35%, transparent)'
              }}
            >
              <Plus className="w-5 h-5" style={{ color: 'var(--brand-500)' }} />
            </span>
            <span className="text-[10px] font-bold px-1.5 text-center leading-tight" style={{ color: 'var(--text-2)' }}>
              Nova etapa
            </span>
          </button>
        </div>
      </div>
      </div>

      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Nova coluna"
        subtitle="Voce pode criar quantas colunas quiser. Use o botao encadeado ou o atalho no teclado."
      >
        <div className="space-y-3">
          <div>
            <label className="ui-eyebrow mb-1.5 block">Nome da coluna</label>
            <Input
              ref={newColInputRef}
              autoFocus
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="Ex.: Negociacao, Follow-up, Aguardando pagamento..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitNewColumn(e.shiftKey);
                }
              }}
            />
            <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--text-3)' }}>
              <kbd className="px-1 rounded" style={{ background: 'var(--surface-2)' }}>
                Enter
              </kbd>{' '}
              cria e fecha ·{' '}
              <kbd className="px-1 rounded" style={{ background: 'var(--surface-2)' }}>
                Shift+Enter
              </kbd>{' '}
              cria e abre outra linha
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Fechar
            </Button>
            <Button type="button" variant="secondary" onClick={() => submitNewColumn(true)}>
              Criar e adicionar outra
            </Button>
            <Button type="button" variant="primary" onClick={() => submitNewColumn(false)}>
              Criar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!renameOpen}
        onClose={() => setRenameOpen(null)}
        title="Renomear coluna"
        subtitle="O nome aparece no topo do quadro."
      >
        {renameOpen && (
          <div className="space-y-3">
            <div>
              <label className="ui-eyebrow mb-1.5 block">Nome</label>
              <Input value={renameOpen.name} onChange={(e) => setRenameOpen({ ...renameOpen, name: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameOpen(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="primary" onClick={applyRename}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!deleteAsk}
        onClose={() => setDeleteAsk(null)}
        title="Remover coluna?"
        subtitle="Os clientes desta coluna serao movidos para outra coluna ativa."
      >
        {deleteAsk && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
              Remover <strong>{deleteAsk.name}</strong>?
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleteAsk(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="primary" onClick={confirmDeleteColumn}>
                Remover
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
