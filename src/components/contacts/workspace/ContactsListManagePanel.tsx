import React from 'react';
import {
  Search,
  Rocket,
  Download,
  Smartphone,
  UserPlus,
  UserMinus,
  CheckSquare,
  Square
} from 'lucide-react';
import type { Contact, ContactList } from '../../../types';

type SubTab = 'members' | 'add';

type Props = {
  list: ContactList;
  subTab: SubTab;
  onSubTabChange: (tab: SubTab) => void;
  memberSearch: string;
  onMemberSearchChange: (q: string) => void;
  addSearch: string;
  onAddSearchChange: (q: string) => void;
  members: Contact[];
  addPool: Contact[];
  addSelectedIds: string[];
  missingCount: number;
  contactsHasMore: boolean;
  contactsLoadingMore: boolean;
  allAddPoolSelected: boolean;
  onCreateCampaign: () => void;
  onExportXlsx: () => void;
  onExportVcf: () => void;
  onLoadMore?: () => void;
  onEditContact: (c: Contact) => void;
  onRemoveMember: (c: Contact) => void;
  onToggleAddSelect: (id: string) => void;
  onToggleAddSelectAll: () => void;
  onAddSelected: () => void;
};

export const ContactsListManagePanel: React.FC<Props> = ({
  list,
  subTab,
  onSubTabChange,
  memberSearch,
  onMemberSearchChange,
  addSearch,
  onAddSearchChange,
  members,
  addPool,
  addSelectedIds,
  missingCount,
  contactsHasMore,
  contactsLoadingMore,
  allAddPoolSelected,
  onCreateCampaign,
  onExportXlsx,
  onExportVcf,
  onLoadMore,
  onEditContact,
  onRemoveMember,
  onToggleAddSelect,
  onToggleAddSelectAll,
  onAddSelected
}) => {
  const memberCount = list.contactIds?.length || 0;

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col gap-3"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <p className="text-[11px] flex-1 min-w-0" style={{ color: 'var(--text-3)' }}>
          {memberCount.toLocaleString('pt-BR')} contato{memberCount !== 1 ? 's' : ''} na lista
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCreateCampaign}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold text-white"
            style={{ background: 'var(--brand-600)' }}
          >
            <Rocket className="w-3.5 h-3.5" />
            Criar campanha
          </button>
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <button
              type="button"
              onClick={onExportXlsx}
              className="inline-flex items-center gap-1 px-2.5 py-2 text-[11px] font-semibold"
              style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}
            >
              <Download className="w-3.5 h-3.5" />
              XLSX
            </button>
            <button
              type="button"
              onClick={onExportVcf}
              className="inline-flex items-center gap-1 px-2.5 py-2 text-[11px] font-semibold border-l"
              style={{ background: 'var(--surface-1)', color: 'var(--text-2)', borderColor: 'var(--border-subtle)' }}
            >
              <Smartphone className="w-3.5 h-3.5" />
              vCard
            </button>
          </div>
          <div
            className="flex rounded-lg p-0.5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <TabBtn active={subTab === 'members'} onClick={() => onSubTabChange('members')}>
              Na lista
            </TabBtn>
            <TabBtn
              active={subTab === 'add'}
              onClick={() => {
                onSubTabChange('add');
              }}
            >
              Adicionar
            </TabBtn>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        {subTab === 'members' ? (
          <div className="space-y-3">
            {missingCount > 0 && (
              <Banner
                text={`${missingCount.toLocaleString('pt-BR')} contato(s) ainda não carregados (paginação).`}
                action={
                  <button
                    type="button"
                    onClick={() => void onLoadMore?.()}
                    disabled={!contactsHasMore || contactsLoadingMore || !onLoadMore}
                    className="text-[11px] font-bold disabled:opacity-50"
                    style={{ color: 'var(--brand-500)' }}
                  >
                    {contactsLoadingMore ? 'Carregando…' : 'Carregar mais'}
                  </button>
                }
              />
            )}
            <SearchInput
              value={memberSearch}
              onChange={onMemberSearchChange}
              placeholder="Filtrar contatos na lista..."
            />
            <ScrollList empty="Nenhum contato nesta lista. Use a aba Adicionar.">
              {members.map((c) => (
                <Row key={c.id}>
                  <button type="button" onClick={() => onEditContact(c)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{c.name}</p>
                    <p className="text-xs font-mono truncate" style={{ color: 'var(--text-3)' }}>{c.phone}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveMember(c)}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
                    style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}
                  >
                    <UserMinus className="w-3.5 h-3.5" />
                    Remover
                  </button>
                </Row>
              ))}
            </ScrollList>
          </div>
        ) : (
          <div className="space-y-3">
            {contactsHasMore && (
              <Banner
                text="Base carregada parcialmente. Carregue mais para encontrar contatos."
                action={
                  <button
                    type="button"
                    onClick={() => void onLoadMore?.()}
                    disabled={contactsLoadingMore || !onLoadMore}
                    className="text-[11px] font-bold disabled:opacity-50"
                    style={{ color: 'var(--brand-500)' }}
                  >
                    {contactsLoadingMore ? 'Carregando…' : 'Carregar mais'}
                  </button>
                }
              />
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <SearchInput
                value={addSearch}
                onChange={onAddSearchChange}
                placeholder="Buscar na base para adicionar..."
                className="flex-1"
              />
              <button
                type="button"
                disabled={addSelectedIds.length === 0}
                onClick={onAddSelected}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40 shrink-0"
                style={{ background: 'var(--brand-600)' }}
              >
                <UserPlus className="w-4 h-4" />
                Incluir {addSelectedIds.length > 0 ? `(${addSelectedIds.length})` : ''}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
              <button type="button" onClick={onToggleAddSelectAll} className="font-bold" style={{ color: 'var(--brand-500)' }}>
                {allAddPoolSelected ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
              </button>
              <span>·</span>
              <span>{addPool.length} disponíveis (fora da lista)</span>
            </div>
            <ScrollList empty="Todos os contatos válidos já estão nesta lista ou nada encontrado na busca.">
              {addPool.map((c) => {
                const sel = addSelectedIds.includes(c.id);
                return (
                  <Row key={c.id} highlight={sel}>
                    <button
                      type="button"
                      aria-label={sel ? 'Desmarcar' : 'Selecionar'}
                      onClick={() => onToggleAddSelect(c.id)}
                      className="shrink-0 p-1 rounded-md"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {sel ? <CheckSquare className="w-4 h-4 text-emerald-500" /> : <Square className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => onEditContact(c)} className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{c.name}</p>
                      <p className="text-xs font-mono truncate" style={{ color: 'var(--text-3)' }}>{c.phone}</p>
                    </button>
                  </Row>
                );
              })}
            </ScrollList>
          </div>
        )}
      </div>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children
}) => (
  <button
    type="button"
    onClick={onClick}
    className="px-3 py-1.5 rounded-md text-[11px] font-bold transition"
    style={
      active
        ? { background: 'var(--brand-600)', color: '#fff' }
        : { color: 'var(--text-3)' }
    }
  >
    {children}
  </button>
);

const SearchInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}> = ({ value, onChange, placeholder, className = '' }) => (
  <div className={`relative ${className}`}>
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-3)' }} />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-500)]/25"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-1)'
      }}
    />
  </div>
);

const Banner: React.FC<{ text: string; action?: React.ReactNode }> = ({ text, action }) => (
  <div
    className="rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 text-[11px]"
    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: 'var(--text-2)' }}
  >
    <span className="flex-1 min-w-0">{text}</span>
    {action}
  </div>
);

const ScrollList: React.FC<{ empty: string; children: React.ReactNode }> = ({ empty, children }) => {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <div
      className="max-h-[min(58vh,520px)] overflow-y-auto rounded-xl custom-scrollbar"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      {!hasChildren ? (
        <p className="p-6 text-sm text-center" style={{ color: 'var(--text-3)' }}>{empty}</p>
      ) : (
        children
      )}
    </div>
  );
};

const Row: React.FC<{ children: React.ReactNode; highlight?: boolean }> = ({ children, highlight }) => (
  <div
    className="flex items-center gap-2 sm:gap-3 px-3 py-2.5 border-b last:border-b-0"
    style={{
      background: highlight ? 'rgba(16,185,129,0.08)' : undefined,
      borderColor: 'var(--border-subtle)'
    }}
  >
    {children}
  </div>
);
