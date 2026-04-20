import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
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

interface ClientPipelineBoardProps {
  userUid: string | null | undefined;
  conversations: Conversation[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  getAvatar: (name: string, pic?: string) => string;
  connectionName?: (connectionId: string) => string | undefined;
}

export const ClientPipelineBoard: React.FC<ClientPipelineBoardProps> = ({
  userUid,
  conversations,
  selectedChatId,
  onSelectChat,
  getAvatar,
  connectionName
}) => {
  const [state, setState] = useState<ClientPipelineBoardPersisted>(() => defaultPipelineState());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renameOpen, setRenameOpen] = useState<{ id: string; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [deleteAsk, setDeleteAsk] = useState<PipelineColumnDef | null>(null);
  const newColInputRef = useRef<HTMLInputElement>(null);

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

  const onDragOverCol = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDropCol = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(DND_TYPE) || e.dataTransfer.getData('text/plain');
    if (!id) return;
    moveCard(id, columnId);
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2"
          style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-0)' }}
        >
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
            {state.columns.length} coluna{state.columns.length === 1 ? '' : 's'} — adicione quantas precisar
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => {
              setNewColName('');
              setAddOpen(true);
            }}
          >
            Adicionar coluna
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-2 pb-2 pt-2">
        {state.columns.map((col) => {
          const list = convsByColumn.get(col.id) || [];
          return (
            <div
              key={col.id}
              className="flex w-[min(100%,240px)] flex-shrink-0 flex-col rounded-xl min-h-0"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)'
              }}
              onDragOver={onDragOverCol}
              onDrop={(e) => onDropCol(e, col.id)}
            >
              <div
                className="flex items-start justify-between gap-1 px-2.5 py-2 border-b flex-shrink-0"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                    {col.name}
                  </p>
                  <p className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {list.length} cliente{list.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    className="p-1 rounded-md transition-colors"
                    style={{ color: 'var(--text-3)' }}
                    title="Renomear coluna"
                    onClick={() => setRenameOpen({ id: col.id, name: col.name })}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="p-1 rounded-md transition-colors"
                    style={{ color: 'var(--text-3)' }}
                    title="Remover coluna"
                    onClick={() => setDeleteAsk(col)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 p-2 min-h-0">
                {list.map((conv) => {
                  const active = selectedChatId === conv.id;
                  const conn = connectionName?.(conv.connectionId);
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      draggable
                      onDragStart={(e) => onDragStart(e, conv.id)}
                      onClick={() => onSelectChat(conv.id)}
                      className="w-full text-left rounded-lg px-2 py-2 transition-colors border group"
                      style={{
                        background: active ? 'var(--surface-2)' : 'var(--surface-0)',
                        borderColor: active ? 'var(--brand-500)' : 'var(--border-subtle)'
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical
                          className="w-3.5 h-3.5 flex-shrink-0 opacity-40 group-hover:opacity-70 cursor-grab active:cursor-grabbing"
                          style={{ color: 'var(--text-3)' }}
                          aria-hidden
                        />
                        <img
                          src={getAvatar(conv.contactName, conv.profilePicUrl)}
                          className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                          alt=""
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                            {conv.contactName}
                          </p>
                          <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
                            {conn ? `${conn} · ` : ''}
                            {conv.contactPhone}
                          </p>
                          {conv.unreadCount > 0 && (
                            <span
                              className="inline-block mt-0.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: 'var(--brand-600)', color: '#fff' }}
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
                  <p className="text-[11px] text-center py-6 px-1" style={{ color: 'var(--text-3)' }}>
                    Arraste clientes para aqui ou receba novas conversas.
                  </p>
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
          className="flex w-[min(100%,88px)] flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-colors self-stretch min-h-[140px] hover:opacity-90"
          style={{ borderColor: 'var(--brand-500)', color: 'var(--brand-600)', background: 'rgba(16,185,129,0.06)' }}
        >
          <Plus className="w-5 h-5" />
          <span className="text-[10px] font-semibold px-1.5 text-center leading-tight">Outra coluna</span>
        </button>
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
