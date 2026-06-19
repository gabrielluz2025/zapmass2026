import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  'linear-gradient(90deg, #8b5cf6, #06B6D4)',
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

/**
 * Lista vertical dentro de cada coluna do quadro — evita montar milhares de cartões ao mesmo tempo.
 * Memoizado para que o re-render do board (ex.: troca de `dragOverColumn`) só rerenderize a coluna
 * cujos `props` realmente mudaram.
 */
type KanbanColumnBodyProps = {
  list: Conversation[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  getConvAvatar: (conv: Conversation) => string;
  connectionName?: (connectionId: string) => string | undefined;
  formatConversationTitles?: (conv: Conversation) => { primary: string; whatsappSubtitle?: string };
  onDragStartNative: (e: React.DragEvent, conversationId: string) => void;
  onDragEndNative: () => void;
};
const KanbanColumnBody: React.FC<KanbanColumnBodyProps> = memo(function KanbanColumnBodyInner({
  list,
  selectedChatId,
  onSelectChat,
  getConvAvatar,
  connectionName,
  formatConversationTitles,
  onDragStartNative,
  onDragEndNative
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 100,
    overscan: 5,
    getItemKey: (index) => list[index]?.id ?? index
  });

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 pt-0.5">
      <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const conv = list[vRow.index];
          if (!conv) return null;
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
            <div
              key={conv.id}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start}px)`
              }}
              className="pb-2"
            >
              <button
                type="button"
                draggable
                onDragStart={(e) => onDragStartNative(e, conv.id)}
                onDragEnd={onDragEndNative}
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
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`leading-tight truncate ${waSub ? 'text-[14px] font-extrabold' : 'text-[12.5px] font-bold'}`}
                      style={{ color: 'var(--text-1)' }}
                    >
                      {primary}
                    </p>
                    {waSub && (
                      <p className="text-[10px] truncate opacity-80 mt-0.5" style={{ color: 'var(--text-3)' }} title="Nome salvo no celular">
                        {waSub}
                      </p>
                    )}
                    {preview && (
                      <p className="text-[10px] leading-snug mt-1 line-clamp-2" style={{ color: 'var(--text-3)' }}>
                        {preview}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2.5">
                      {conv.unreadCount > 0 && (
                        <span
                          className="text-[9.5px] font-bold px-2 py-0.5 rounded-md"
                          style={{
                            background: 'linear-gradient(135deg, var(--brand-500), var(--brand-600))',
                            color: '#fff',
                            boxShadow: '0 2px 8px -2px color-mix(in srgb, var(--brand-500) 50%, transparent)'
                          }}
                        >
                          {conv.unreadCount} nova{conv.unreadCount === 1 ? '' : 's'}
                        </span>
                      )}
                      <p className="text-[9.5px] font-medium ml-auto" style={{ color: 'var(--text-3)', opacity: 0.85 }}>
                        {conn ? `${conn} · ` : ''}
                        {conv.contactPhone}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

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

/** Quadro Kanban: memoizado para não rerender ao digitar na caixa de mensagem / estados só do painel direito. */
export const ClientPipelineBoard = memo(function ClientPipelineBoardInner({
  userUid,
  conversations,
  selectedChatId,
  onSelectChat,
  getConvAvatar,
  connectionName,
  formatConversationTitles
}: ClientPipelineBoardProps) {
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
    setCanScrollBoardX((prev) => {
      const next = {
        left: scrollLeft > 6,
        right: scrollLeft + clientWidth < scrollWidth - 6
      };
      if (prev.left === next.left && prev.right === next.right) return prev;
      return next;
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
  }, [updateBoardScrollHints, state.columns.length, conversations.length]);

  const scrollBoardBy = useCallback((dir: 'left' | 'right') => {
    const el = columnsScrollRef.current;
    if (!el) return;
    const step = Math.min(320, Math.max(220, el.clientWidth * 0.45));
    el.scrollBy({ left: dir === 'right' ? step : -step, behavior: 'smooth' });
  }, []);

  const moveCard = useCallback(
    (conversationId: string, columnId: string) => {
      setState((prev) => {
        if (prev.cardColumn[conversationId] === columnId) return prev;
        const next = {
          ...prev,
          cardColumn: { ...prev.cardColumn, [conversationId]: columnId }
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

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

  const onDragStart = useCallback((e: React.DragEvent, conversationId: string) => {
    e.dataTransfer.setData(DND_TYPE, conversationId);
    e.dataTransfer.setData('text/plain', conversationId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  /**
   * `dragover` dispara ~60Hz enquanto o cursor está sobre a coluna; sem o guard, cada frame causa
   * `setState` → re-render do board inteiro → re-render de cada KanbanColumnBody → recomputo do
   * virtualizer (CPU 80-95% durante o arrasto). Lemos o id da coluna do `data-col-id` para que o
   * handler seja referência estável (não cria nova função por coluna a cada render).
   */
  const onDragOverCol = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const columnId = e.currentTarget.getAttribute('data-col-id');
    if (!columnId) return;
    setDragOverColumn((prev) => (prev === columnId ? prev : columnId));
  }, []);

  const onDragLeaveCol = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOverColumn((prev) => (prev === null ? prev : null));
  }, []);

  const onDropCol = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOverColumn(null);
      const columnId = e.currentTarget.getAttribute('data-col-id');
      if (!columnId) return;
      const id = e.dataTransfer.getData(DND_TYPE) || e.dataTransfer.getData('text/plain');
      if (!id) return;
      moveCard(id, columnId);
    },
    [moveCard]
  );

  const onDragEndNative = useCallback(() => {
    setDragOverColumn((prev) => (prev === null ? prev : null));
  }, []);

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
          <button
            type="button"
            className="ui-btn ui-btn-primary flex items-center gap-1.5"
            onClick={() => {
              setNewColName('');
              setAddOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Nova etapa
          </button>
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
                data-col-id={col.id}
                onDragOver={onDragOverCol}
                onDragLeave={onDragLeaveCol}
                onDrop={onDropCol}
              >
                <div className="h-[3px] w-full flex-shrink-0 rounded-t-[13px] overflow-hidden" style={{ background: accent }} aria-hidden />
                <div
                  className="flex items-start justify-between gap-2 px-3 pt-3 pb-2 flex-shrink-0"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[14px] font-black truncate tracking-tight uppercase" style={{ color: 'var(--text-1)' }}>
                      {col.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span
                      className="inline-flex tabular-nums text-[11px] font-black px-2 py-0.5 rounded-lg mr-1"
                      style={{
                        background: 'color-mix(in srgb, var(--text-3) 15%, transparent)',
                        color: 'var(--text-2)'
                      }}
                    >
                      {list.length}
                    </span>
                    <button
                      type="button"
                      className="p-1.5 rounded-lg transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
                      style={{ color: 'var(--text-3)' }}
                      title="Renomear coluna"
                      onClick={() => setRenameOpen({ id: col.id, name: col.name })}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-lg transition-colors hover:bg-rose-100 hover:text-rose-500 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                      style={{ color: 'var(--text-3)' }}
                      title="Remover coluna"
                      onClick={() => setDeleteAsk(col)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {list.length === 0 ? (
                  <div
                    className="flex flex-1 flex-col items-center justify-center text-center py-10 px-3 rounded-xl mx-2.5 mb-2.5 mt-2 min-h-0"
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
                ) : (
                  <KanbanColumnBody
                    list={list}
                    selectedChatId={selectedChatId}
                    onSelectChat={onSelectChat}
                    getConvAvatar={getConvAvatar}
                    connectionName={connectionName}
                    formatConversationTitles={formatConversationTitles}
                    onDragStartNative={onDragStart}
                    onDragEndNative={onDragEndNative}
                  />
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setNewColName('');
              setAddOpen(true);
            }}
            className="flex w-[min(100%,120px)] flex-shrink-0 flex-col items-center justify-center gap-3 rounded-2xl transition-all duration-200 self-stretch min-h-[180px] hover:scale-[1.02] active:scale-[0.98] group"
            style={{
              background: 'var(--surface-0)',
              border: '2px dashed var(--border-subtle)',
            }}
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 group-hover:bg-[var(--brand-500)] group-hover:text-white transition-colors"
            >
              <Plus className="w-6 h-6" />
            </span>
            <span className="text-xs font-bold text-slate-500 group-hover:text-[var(--brand-600)] dark:group-hover:text-[var(--brand-400)] text-center leading-tight transition-colors">
              Adicionar<br />Etapa
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
});
