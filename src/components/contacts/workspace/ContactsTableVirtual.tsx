import React, { useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CheckSquare, Square, Flame, Sparkles, Snowflake, Clock, MapPin, Phone,
  MoreHorizontal, MessageCircle, Rocket, Edit3, Trash2, Copy, AlertCircle,
  ListPlus, Users
} from 'lucide-react';
import type { Contact } from '../../../types';

type Temperature = 'hot' | 'warm' | 'cold' | 'new';
interface TempStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  lastSentTs: number;
  lastReplyTs: number;
  lastReadTs: number;
  temp: Temperature;
  score: number;
}

interface Props {
  rows: Contact[];
  contactTemps: Record<string, TempStats>;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onRowClick: (contact: Contact) => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  onOpenChat: (contact: Contact) => void;
  onCreateCampaign: (contact: Contact) => void;
  onCopyPhone: (contact: Contact) => void;
  onAddToList: (contact: Contact) => void;
  selectedContactId?: string | null;
  heightClass?: string;
  emptyHint?: React.ReactNode;
}

const tempMeta: Record<Temperature, { icon: React.ReactNode; color: string; label: string }> = {
  hot: { icon: <Flame className="w-3 h-3" />, color: 'text-rose-500', label: 'Quente' },
  warm: { icon: <Sparkles className="w-3 h-3" />, color: 'text-amber-500', label: 'Morno' },
  cold: { icon: <Snowflake className="w-3 h-3" />, color: 'text-sky-500', label: 'Frio' },
  new: { icon: <Clock className="w-3 h-3" />, color: 'text-slate-400', label: 'Sem hist.' }
};

const ROW_HEIGHT = 56;

const formatPhone = (raw: string): string => {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw || '';
};

/**
 * Tabela virtualizada de contatos — renderiza apenas as linhas visíveis.
 * Suporta centenas de milhares de contatos sem lag.
 */
export const ContactsTableVirtual: React.FC<Props> = ({
  rows,
  contactTemps,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  onEdit,
  onDelete,
  onOpenChat,
  onCreateCampaign,
  onCopyPhone,
  onAddToList,
  selectedContactId,
  heightClass = 'h-[calc(100vh-230px)]',
  emptyHint
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const allVisible = rows.length > 0 && selectedSet.size === rows.length;

  return (
    <div className="ui-card flex flex-col overflow-hidden">
      {/* Cabeçalho da tabela */}
      <div className="grid grid-cols-[36px_1.8fr_1.2fr_1fr_100px_80px] items-center gap-3 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 shrink-0">
        <button
          onClick={onToggleSelectAll}
          className="flex items-center justify-center text-slate-500 hover:text-[var(--brand-600)] transition"
          title={allVisible ? 'Desmarcar todos' : 'Selecionar todos'}
        >
          {allVisible ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
        </button>
        <span>Contato</span>
        <span>Telefone</span>
        <span className="hidden md:inline">Cidade</span>
        <span className="hidden md:inline">Temp.</span>
        <span className="text-right">Ações</span>
      </div>

      {/* Corpo virtualizado */}
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-10 text-center">
          <div>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-3 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Users className="w-7 h-7" />
            </div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Nenhum contato aqui</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
              {emptyHint || 'Tente outro filtro ou importe novos contatos.'}
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={parentRef}
          className={`${heightClass} overflow-y-auto`}
          style={{ contain: 'strict' }}
        >
          <div style={{ height: `${totalSize}px`, width: '100%', position: 'relative' }}>
            {virtualRows.map((vRow) => {
              const contact = rows[vRow.index];
              if (!contact) return null;
              return (
                <VirtualContactRow
                  key={contact.id}
                  contact={contact}
                  temp={contactTemps[contact.id]?.temp || 'new'}
                  selected={selectedSet.has(contact.id)}
                  highlighted={selectedContactId === contact.id}
                  top={vRow.start}
                  onToggleSelect={onToggleSelect}
                  onRowClick={onRowClick}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onOpenChat={onOpenChat}
                  onCreateCampaign={onCreateCampaign}
                  onCopyPhone={onCopyPhone}
                  onAddToList={onAddToList}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

interface RowProps {
  contact: Contact;
  temp: Temperature;
  selected: boolean;
  highlighted: boolean;
  top: number;
  onToggleSelect: (id: string) => void;
  onRowClick: (contact: Contact) => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  onOpenChat: (contact: Contact) => void;
  onCreateCampaign: (contact: Contact) => void;
  onCopyPhone: (contact: Contact) => void;
  onAddToList: (contact: Contact) => void;
}

const VirtualContactRow: React.FC<RowProps> = React.memo(({
  contact, temp, selected, highlighted, top,
  onToggleSelect, onRowClick, onEdit, onDelete, onOpenChat, onCreateCampaign, onCopyPhone, onAddToList
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tempInfo = tempMeta[temp];

  const initials = useMemo(() => {
    return (contact.name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || '?';
  }, [contact.name]);

  const handleMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((v) => !v);
  }, []);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const runAction = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    fn();
  };

  const cityState = [contact.city, contact.state].filter(Boolean).join(' · ') || '—';

  return (
    <div
      role="row"
      onClick={() => onRowClick(contact)}
      className={`grid grid-cols-[36px_1.8fr_1.2fr_1fr_100px_80px] items-center gap-3 px-4 border-b border-slate-100 dark:border-slate-800/70 cursor-pointer transition group ${
        highlighted
          ? 'bg-[color-mix(in_srgb,var(--brand-500)_8%,transparent)]'
          : selected
            ? 'bg-[color-mix(in_srgb,var(--brand-500)_4%,transparent)] hover:bg-[color-mix(in_srgb,var(--brand-500)_8%,transparent)]'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
      }`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: `${ROW_HEIGHT}px`,
        transform: `translateY(${top}px)`
      }}
    >
      {/* checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelect(contact.id); }}
        className={`flex items-center justify-center transition ${selected ? 'text-[var(--brand-600)]' : 'text-slate-300 dark:text-slate-600 hover:text-slate-500'}`}
      >
        {selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>

      {/* avatar + nome */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
            {contact.name || 'Sem nome'}
            {contact.status === 'INVALID' && (
              <span title="Telefone inválido" className="text-rose-500"><AlertCircle className="w-3.5 h-3.5" /></span>
            )}
          </div>
          {Array.isArray(contact.tags) && contact.tags.length > 0 && (
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {contact.tags.slice(0, 2).join(' · ')}{contact.tags.length > 2 ? ` +${contact.tags.length - 2}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* telefone */}
      <div className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300 min-w-0">
        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="truncate">{formatPhone(contact.phone || '')}</span>
      </div>

      {/* cidade */}
      <div className="hidden md:flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 min-w-0">
        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="truncate">{cityState}</span>
      </div>

      {/* temperatura */}
      <div className="hidden md:flex">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${tempInfo.color}`}>
          {tempInfo.icon}
          {tempInfo.label}
        </span>
      </div>

      {/* ações */}
      <div className="flex items-center justify-end gap-1 relative" ref={menuRef}>
        <button
          onClick={runAction(() => onOpenChat(contact))}
          className="p-1.5 rounded-md text-emerald-500 hover:bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition"
          title="Abrir no chat"
        >
          <MessageCircle className="w-4 h-4" />
        </button>
        <button
          onClick={handleMenuToggle}
          className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition"
          title="Mais ações"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 mt-1 w-48 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 z-10 overflow-hidden">
            <MenuAction icon={<MessageCircle className="w-3.5 h-3.5" />} label="Abrir no chat" onClick={runAction(() => onOpenChat(contact))} />
            <MenuAction icon={<Rocket className="w-3.5 h-3.5" />} label="Nova campanha 1:1" onClick={runAction(() => onCreateCampaign(contact))} />
            <MenuAction icon={<Copy className="w-3.5 h-3.5" />} label="Copiar telefone" onClick={runAction(() => onCopyPhone(contact))} />
            <MenuAction icon={<ListPlus className="w-3.5 h-3.5" />} label="Adicionar a lista…" onClick={runAction(() => onAddToList(contact))} />
            <div className="border-t border-slate-200 dark:border-slate-800" />
            <MenuAction icon={<Edit3 className="w-3.5 h-3.5" />} label="Editar contato" onClick={runAction(() => onEdit(contact))} />
            <MenuAction icon={<Trash2 className="w-3.5 h-3.5" />} label="Remover" onClick={runAction(() => onDelete(contact))} danger />
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  // Re-render apenas se algo realmente relevante mudou pra esta linha.
  return (
    prev.contact === next.contact &&
    prev.temp === next.temp &&
    prev.selected === next.selected &&
    prev.highlighted === next.highlighted &&
    prev.top === next.top
  );
});
VirtualContactRow.displayName = 'VirtualContactRow';

const MenuAction: React.FC<{ icon: React.ReactNode; label: string; onClick: (e: React.MouseEvent) => void; danger?: boolean }> = ({ icon, label, onClick, danger }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition ${
      danger
        ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`}
  >
    {icon}
    {label}
  </button>
);
