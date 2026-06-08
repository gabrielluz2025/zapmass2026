import React from 'react';
import {
  List as ListIcon,
  Plus,
  Trash2,
  Users,
  Rocket,
  FolderOpen,
  UserMinus
} from 'lucide-react';
import type { ContactList } from '../../../types';

type Props = {
  lists: ContactList[];
  activeListId: string | null;
  noListCount: number;
  noListActive: boolean;
  onSelectNoList: () => void;
  onSelectList: (listId: string) => void;
  onCreateList: (name: string) => void;
  onManageList: (listId: string) => void;
  onDeleteList: (listId: string, listName: string) => void;
  onShowAll: () => void;
  /** Incrementado pelo rail/sidebar para abrir o formulário de criação. */
  openCreateSignal?: number;
};

export const ContactsListsPanel: React.FC<Props> = ({
  lists,
  activeListId,
  noListCount,
  noListActive,
  onSelectNoList,
  onSelectList,
  onCreateList,
  onManageList,
  onDeleteList,
  onShowAll,
  openCreateSignal = 0
}) => {
  const [name, setName] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (openCreateSignal > 0) setCreating(true);
  }, [openCreateSignal]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateList(trimmed);
    setName('');
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white shadow-md transition hover:brightness-110 active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
      >
        <Plus className="w-4 h-4" />
        Nova lista
      </button>

      {(creating || lists.length === 0) && (
        <div
          className="rounded-xl p-3 space-y-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
            {lists.length === 0 ? 'Crie sua primeira lista' : 'Nome da nova lista'}
          </p>
          <input
            type="text"
            autoFocus={creating}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            }}
            placeholder="Ex.: Clientes VIP, Aniversariantes…"
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-500)]/30"
            style={{
              background: 'var(--surface-0)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-1)'
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!name.trim()}
              className="flex-1 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--brand-600)' }}
            >
              Criar lista
            </button>
            {lists.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setName('');
                }}
                className="px-3 py-2 rounded-lg text-xs font-semibold"
                style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onShowAll}
        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-semibold transition ${
          activeListId === null && !noListActive
            ? 'text-white shadow-md'
            : 'hover:bg-[var(--surface-2)]'
        }`}
        style={
          activeListId === null && !noListActive
            ? { background: 'var(--brand-600)' }
            : { color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
        }
      >
        <Users className="w-4 h-4 shrink-0" />
        <span>Todos os contatos</span>
      </button>

      <button
        type="button"
        onClick={onSelectNoList}
        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-semibold transition ${
          noListActive ? 'text-white shadow-md' : 'hover:bg-[var(--surface-2)]'
        }`}
        style={
          noListActive
            ? { background: 'linear-gradient(135deg, #f97316, #ea580c)' }
            : { color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
        }
        title="Contatos que não pertencem a nenhuma lista"
      >
        <UserMinus className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0 truncate">Sem lista</span>
        <span
          className="text-[11px] font-black tabular-nums px-1.5 py-0.5 rounded-md shrink-0"
          style={{
            background: noListActive ? 'rgba(255,255,255,0.2)' : 'var(--surface-2)',
            color: noListActive ? '#fff' : 'var(--text-3)'
          }}
        >
          {noListCount.toLocaleString('pt-BR')}
        </span>
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-2 custom-scrollbar">
        {lists.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{ border: '1px dashed var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-30" style={{ color: 'var(--text-3)' }} />
            <p className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
              Listas organizam contatos para campanhas e exportações.
            </p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
              Use o botão acima para começar.
            </p>
          </div>
        ) : (
          lists.map((list) => {
            const count = (list.contactIds || []).length;
            const isActive = activeListId === list.id;
            return (
              <div
                key={list.id}
                className="rounded-xl overflow-hidden transition"
                style={{
                  background: isActive ? 'rgba(var(--brand-rgb, 16 185 129), 0.12)' : 'var(--surface-1)',
                  border: `1px solid ${isActive ? 'var(--brand-500)' : 'var(--border-subtle)'}`
                }}
              >
                <button
                  type="button"
                  onClick={() => onManageList(list.id)}
                  className="w-full flex items-start gap-3 px-3 py-3 text-left"
                  title="Abrir lista para adicionar ou remover contatos"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: isActive ? 'var(--brand-600)' : 'var(--surface-2)',
                      color: isActive ? '#fff' : 'var(--text-2)'
                    }}
                  >
                    <ListIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                      {list.name}
                    </p>
                    <p className="text-[11px] mt-0.5 tabular-nums" style={{ color: 'var(--text-3)' }}>
                      {count.toLocaleString('pt-BR')} contato{count !== 1 ? 's' : ''}
                    </p>
                  </div>
                </button>
                <div className="flex items-center justify-end gap-1 px-2 pb-2">
                  <button
                    type="button"
                    onClick={() => onDeleteList(list.id, list.name)}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition hover:bg-rose-500/10"
                    style={{ color: '#f43f5e' }}
                    title="Apagar lista"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Apagar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {lists.length > 0 && (
        <p className="text-[10px] leading-relaxed px-1" style={{ color: 'var(--text-3)' }}>
          <Rocket className="w-3 h-3 inline -mt-0.5 mr-0.5" />
          Clique em uma lista para <strong>adicionar ou remover</strong> contatos. Use <strong>Criar campanha</strong> na gestão para disparar só para esse grupo.
        </p>
      )}
    </div>
  );
};
