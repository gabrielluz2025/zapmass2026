import React, { useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CheckSquare, Square, Flame, Sparkles, Snowflake, Clock,
  MoreHorizontal, MessageCircle, Rocket, Edit3, Trash2, Copy,
  AlertCircle, ListPlus, Users, Megaphone, MapPin, Phone, Tag
} from 'lucide-react';
import type { Contact } from '../../../types';
import { formatFollowUpLabel, localStartOfTodayMs, parseFollowUpMs } from '../../../utils/followUp';
import { ContactAvatar } from './ContactAvatar';

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
  loading?: boolean;
}

// Premium temperature badge config
const tempConfig: Record<Temperature, { bg: string; color: string; label: string; icon: React.ReactNode }> = {
  hot:  { bg: 'rgba(239,68,68,0.14)',  color: '#f87171', label: 'Quente',      icon: <Flame     className="w-2.5 h-2.5" /> },
  warm: { bg: 'rgba(245,158,11,0.14)', color: '#fbbf24', label: 'Morno',       icon: <Sparkles  className="w-2.5 h-2.5" /> },
  cold: { bg: 'rgba(6,182,212,0.14)',  color: '#22d3ee', label: 'Frio',        icon: <Snowflake className="w-2.5 h-2.5" /> },
  new:  { bg: 'rgba(100,116,139,0.12)',color: '#94a3b8', label: 'Sem hist.',   icon: <Clock     className="w-2.5 h-2.5" /> },
};

const ROW_HEIGHT = 68;

const formatPhone = (raw: string): string => {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw || '';
};

const DispatchBadge: React.FC<{ contact: Contact }> = ({ contact }) => {
  const p = contact.campaignTablePreview;
  const legacy = contact.campaignMessagesReceived ?? 0;
  if (p?.campaignId) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1 tabular-nums" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>
          <Megaphone className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--crm-dim)', opacity: 0.7 }} />
          {p.sent}/{p.totalStages}
          {p.pending > 0 && (
            <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 800 }}>({p.pending}↑)</span>
          )}
        </div>
        <div className="truncate" style={{ fontSize: 10, color: 'var(--crm-dim)', marginTop: 1 }}>
          {p.campaignName || 'Campanha'}
        </div>
      </div>
    );
  }
  if (legacy > 0) {
    return <span style={{ fontSize: 11, color: 'var(--crm-muted)' }}>{legacy}×</span>;
  }
  return <span style={{ color: 'var(--crm-dim)', opacity: 0.4 }}>—</span>;
};

export const ContactsTableVirtual: React.FC<Props> = ({
  rows, contactTemps, selectedIds,
  onToggleSelect, onToggleSelectAll, onRowClick,
  onEdit, onDelete, onOpenChat, onCreateCampaign, onCopyPhone,
  loading = false, onAddToList, selectedContactId,
  heightClass = 'h-[calc(100vh-230px)]', emptyHint
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const allVisible = rows.length > 0 && selectedSet.size === rows.length;

  return (
    <div className="crm-table-shell flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="shrink-0"
        style={{
          display: 'grid',
          gridTemplateColumns: '36px minmax(0,1.8fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,120px) 100px 84px',
          gap: '0.5rem',
          alignItems: 'center',
          padding: '0 1rem',
          height: 36,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-3, #64748b)',
          background: 'var(--surface-0)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <button
          onClick={onToggleSelectAll}
          className="flex items-center justify-center transition"
          style={{ color: allVisible ? 'var(--brand-500)' : 'var(--crm-dim)' }}
          title={allVisible ? 'Desmarcar todos' : 'Selecionar todos'}
        >
          {allVisible ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        </button>
        <span>Contato</span>
        <span>Telefone</span>
        <span className="hidden md:inline">Cidade</span>
        <span className="hidden lg:inline">Disparos</span>
        <span className="hidden md:inline">Temperatura</span>
        <span className="text-right">Ações</span>
      </div>

      {rows.length === 0 ? (
        <div className="crm-table-empty">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--surface-0)', border: '1px solid var(--border)', color: 'var(--text-3, #94a3b8)' }}
          >
            <Users className="w-8 h-8" />
          </div>
          <p className="text-base font-bold mb-1" style={{ color: 'var(--text-1)' }}>
            {loading ? 'Sincronizando contatos…' : 'Nenhum contato encontrado'}
          </p>
          <p className="text-sm max-w-xs mx-auto" style={{ color: 'var(--text-2, #64748b)' }}>
            {loading
              ? 'Os contatos aparecerão assim que estiverem disponíveis.'
              : (emptyHint || 'Tente ajustar o filtro ou a busca.')}
          </p>
        </div>
      ) : (
        <div ref={parentRef} className={`${heightClass} overflow-y-auto`} style={{ contain: 'strict' }}>
          <div style={{ height: `${totalSize}px`, width: '100%', position: 'relative' }}>
            {virtualRows.map((vRow) => {
              const contact = rows[vRow.index];
              if (!contact) return null;
              return (
                <ContactRow
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

const ContactRow: React.FC<RowProps> = React.memo(({
  contact, temp, selected, highlighted, top,
  onToggleSelect, onRowClick, onEdit, onDelete,
  onOpenChat, onCreateCampaign, onCopyPhone, onAddToList
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tc = tempConfig[temp];

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

  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    fn();
  };

  const cityLabel = [contact.city, contact.state].filter(Boolean).join(' · ') || '—';
  const followMs = parseFollowUpMs(contact.followUpAt);
  const followOverdue = followMs != null && followMs < localStartOfTodayMs();
  const tags = contact.tags?.slice(0, 2) ?? [];

  const rowBg = highlighted
    ? 'var(--crm-row-highlight, rgba(16,185,129,0.07))'
    : selected
    ? 'var(--crm-row-selected, rgba(16,185,129,0.05))'
    : 'transparent';

  return (
    <div
      role="row"
      onClick={() => onRowClick(contact)}
      onDoubleClick={(e) => { e.preventDefault(); onOpenChat(contact); }}
      title="Duplo clique — abrir conversa"
      className="crm-contact-row group"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        transform: `translateY(${top}px)`,
        display: 'grid',
        gridTemplateColumns: '36px minmax(0,1.8fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,120px) 100px 84px',
        gap: '0.5rem',
        alignItems: 'center',
        padding: '0 1rem',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: rowBg,
        transition: 'background 0.12s',
        ...(highlighted ? { boxShadow: 'inset 3px 0 0 #10b981' } : {}),
      }}
      onMouseEnter={(e) => {
        if (!selected && !highlighted) e.currentTarget.style.background = 'var(--crm-row-hover, rgba(255,255,255,0.03))';
      }}
      onMouseLeave={(e) => {
        if (!selected && !highlighted) e.currentTarget.style.background = 'transparent';
      }}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelect(contact.id); }}
        className="flex items-center justify-center transition"
        style={{ color: selected ? 'var(--brand-500)' : 'var(--crm-dim)', opacity: selected ? 1 : 0.5 }}
      >
        {selected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
      </button>

      {/* Avatar + nome */}
      <div className="flex items-center gap-3 min-w-0">
        <ContactAvatar name={contact.name || '?'} profilePicUrl={contact.profilePicUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <div
            className="truncate flex items-center gap-1.5"
            style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.3 }}
          >
            <span className="truncate">{contact.name || 'Sem nome'}</span>
            {contact.status === 'INVALID' && (
              <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
            )}
          </div>

          {/* Tags como pills */}
          {tags.length > 0 ? (
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {tags.map((t) => (
                <span
                  key={t}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2,
                    background: 'rgba(99,102,241,0.1)', color: '#a5b4fc',
                    borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700,
                    maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  <Tag className="w-2 h-2 shrink-0" />
                  {t}
                </span>
              ))}
              {(contact.tags?.length ?? 0) > 2 && (
                <span style={{ fontSize: 9, color: 'var(--crm-dim)' }}>
                  +{(contact.tags?.length ?? 0) - 2}
                </span>
              )}
            </div>
          ) : followMs != null ? (
            <div
              className="flex items-center gap-1 mt-0.5"
              style={{ fontSize: 10, color: followOverdue ? '#f87171' : 'var(--crm-dim)', fontWeight: followOverdue ? 600 : 400 }}
            >
              <Clock className="w-2.5 h-2.5 shrink-0" />
              Retorno {formatFollowUpLabel(contact.followUpAt)}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--crm-dim)', opacity: 0.5, marginTop: 1 }}>
              Importado · vCard
            </div>
          )}
        </div>
      </div>

      {/* Telefone */}
      <div className="flex items-center gap-1.5 min-w-0" style={{ fontSize: 12.5, color: 'var(--crm-muted)' }}>
        <Phone className="w-3 h-3 shrink-0" style={{ color: 'var(--crm-dim)', opacity: 0.6 }} />
        <span className="truncate font-mono">{formatPhone(contact.phone || '')}</span>
      </div>

      {/* Cidade */}
      <div className="hidden md:flex items-center gap-1.5 min-w-0" style={{ fontSize: 12, color: 'var(--crm-muted)' }}>
        <MapPin className="w-3 h-3 shrink-0" style={{ color: 'var(--crm-dim)', opacity: 0.6 }} />
        <span className="truncate">{cityLabel}</span>
      </div>

      {/* Disparos */}
      <div className="hidden lg:flex flex-col justify-center min-w-0">
        <DispatchBadge contact={contact} />
      </div>

      {/* Temperatura — badge com fundo sólido */}
      <div className="hidden md:flex items-center">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: tc.bg,
            color: tc.color,
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            border: `1px solid ${tc.color}25`,
          }}
        >
          {tc.icon}
          {tc.label}
        </span>
      </div>

      {/* Ações */}
      <div className="flex items-center justify-end gap-1 relative" ref={menuRef}>
        {/* Editar — visível no hover */}
        <button
          onClick={act(() => onEdit(contact))}
          className="p-1.5 rounded-md transition opacity-0 group-hover:opacity-100"
          style={{ color: 'var(--crm-dim)', background: 'transparent' }}
          title="Editar contato"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2, rgba(255,255,255,0.06))')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>

        {/* Chat */}
        <button
          onClick={act(() => onOpenChat(contact))}
          className="p-1.5 rounded-md transition"
          style={{ color: '#10b981', background: 'rgba(16,185,129,0.1)' }}
          title="Abrir no Atendimento"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(16,185,129,0.2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(16,185,129,0.1)')}
        >
          <MessageCircle className="w-3.5 h-3.5" />
        </button>

        {/* Menu ... */}
        <button
          onClick={handleMenuToggle}
          className="p-1.5 rounded-md transition"
          style={{ color: 'var(--crm-dim)' }}
          title="Mais ações"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2, rgba(255,255,255,0.06))')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div
            className="absolute top-full right-0 mt-1 z-20 overflow-hidden"
            style={{
              width: 176,
              borderRadius: 12,
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              boxShadow: '0 16px 40px -8px rgba(0,0,0,0.5)',
            }}
          >
            <Action icon={<MessageCircle className="w-3.5 h-3.5" />} label="Abrir no chat"      onClick={act(() => onOpenChat(contact))} />
            <Action icon={<Rocket        className="w-3.5 h-3.5" />} label="Nova campanha 1:1" onClick={act(() => onCreateCampaign(contact))} />
            <Action icon={<Copy         className="w-3.5 h-3.5" />} label="Copiar telefone"   onClick={act(() => onCopyPhone(contact))} />
            <Action icon={<ListPlus     className="w-3.5 h-3.5" />} label="Adicionar a lista…"onClick={act(() => onAddToList(contact))} />
            <div style={{ borderTop: '1px solid var(--border)', margin: '2px 0' }} />
            <Action icon={<Edit3        className="w-3.5 h-3.5" />} label="Editar contato"    onClick={act(() => onEdit(contact))} />
            <Action icon={<Trash2       className="w-3.5 h-3.5" />} label="Remover"           onClick={act(() => onDelete(contact))} danger />
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.contact === next.contact &&
  prev.temp === next.temp &&
  prev.selected === next.selected &&
  prev.highlighted === next.highlighted &&
  prev.top === next.top
);
ContactRow.displayName = 'ContactRow';

const Action: React.FC<{ icon: React.ReactNode; label: string; onClick: (e: React.MouseEvent) => void; danger?: boolean }> = ({
  icon, label, onClick, danger
}) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-2.5 px-3 py-2 transition"
    style={{
      fontSize: 12,
      fontWeight: 500,
      color: danger ? '#f87171' : 'var(--text-2)',
      background: 'transparent',
      textAlign: 'left',
    }}
    onMouseEnter={(e) => (e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.08)' : 'var(--surface-0)')}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
  >
    {icon}
    {label}
  </button>
);
