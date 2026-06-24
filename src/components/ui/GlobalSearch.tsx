/**
 * GlobalSearch — paleta de busca Cmd+K / Ctrl+K
 *
 * Pesquisa em campanhas, contatos, chips e ações rápidas.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, Send, Users, Smartphone, Zap, MessageCircle,
  ArrowRight, BarChart3, Settings, BookOpen, RefreshCw, Globe2
} from 'lucide-react';
import type { Campaign, Contact, WhatsAppConnection } from '../../types';

// ─── tipos ───────────────────────────────────────────────────────────────────

type ResultKind = 'campaign' | 'contact' | 'chip' | 'action';

interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

// ─── helpers de highlight ─────────────────────────────────────────────────────

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-300/30 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const KIND_LABELS: Record<ResultKind, string> = {
  campaign: 'Campanha',
  contact: 'Contato',
  chip: 'Chip',
  action: 'Ação',
};

const KIND_COLORS: Record<ResultKind, string> = {
  campaign: '#3b82f6',
  contact: '#10b981',
  chip: '#8b5cf6',
  action: '#f59e0b',
};

// ─── props ────────────────────────────────────────────────────────────────────

interface GlobalSearchProps {
  campaigns: Campaign[];
  contacts: Contact[];
  connections: WhatsAppConnection[];
  onNavigate: (view: string) => void;
  onClose: () => void;
}

// ─── componente ──────────────────────────────────────────────────────────────

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  campaigns,
  contacts,
  connections,
  onNavigate,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      // Ações rápidas quando sem query
      return [
        {
          id: 'go-campaigns', kind: 'action',
          title: 'Ver campanhas', subtitle: 'Abrir painel de campanhas',
          icon: <Send className="w-4 h-4" />,
          onSelect: () => { onNavigate('campaigns'); onClose(); },
        },
        {
          id: 'go-contacts', kind: 'action',
          title: 'Ver contatos', subtitle: 'Abrir lista de contatos',
          icon: <Users className="w-4 h-4" />,
          onSelect: () => { onNavigate('contacts'); onClose(); },
        },
        {
          id: 'go-contacts-map', kind: 'action',
          title: 'Mapa dos contatos', subtitle: 'Atlas territorial e campanhas por região',
          icon: <Globe2 className="w-4 h-4" />,
          onSelect: () => { onNavigate('contacts-map'); onClose(); },
        },
        {
          id: 'go-connections', kind: 'action',
          title: 'Ver chips / conexões', subtitle: 'Gerenciar chips WhatsApp',
          icon: <Smartphone className="w-4 h-4" />,
          onSelect: () => { onNavigate('connections'); onClose(); },
        },
        {
          id: 'go-chat', kind: 'action',
          title: 'Abrir chat', subtitle: 'Central de atendimento',
          icon: <MessageCircle className="w-4 h-4" />,
          onSelect: () => { onNavigate('chat'); onClose(); },
        },
        {
          id: 'go-reports', kind: 'action',
          title: 'Relatórios', subtitle: 'Métricas e funil',
          icon: <BarChart3 className="w-4 h-4" />,
          onSelect: () => { onNavigate('reports'); onClose(); },
        },
        {
          id: 'go-settings', kind: 'action',
          title: 'Configurações', subtitle: 'Preferências e integrações',
          icon: <Settings className="w-4 h-4" />,
          onSelect: () => { onNavigate('settings'); onClose(); },
        },
        {
          id: 'go-warmup', kind: 'action',
          title: 'Aquecimento de chip', subtitle: 'Warmup automático',
          icon: <Zap className="w-4 h-4" />,
          onSelect: () => { onNavigate('warmup'); onClose(); },
        },
        {
          id: 'go-help', kind: 'action',
          title: 'Central de ajuda', subtitle: 'Tutoriais e guias',
          icon: <BookOpen className="w-4 h-4" />,
          onSelect: () => { onNavigate('help'); onClose(); },
        },
      ];
    }

    const out: SearchResult[] = [];

    // Campanhas
    for (const c of campaigns) {
      if (
        c.name?.toLowerCase().includes(q) ||
        c.status?.toLowerCase().includes(q)
      ) {
        out.push({
          id: `campaign-${c.id}`,
          kind: 'campaign',
          title: c.name,
          subtitle: `Status: ${c.status} · ${c.totalContacts ?? 0} contatos`,
          icon: <Send className="w-4 h-4" />,
          onSelect: () => { onNavigate('campaigns'); onClose(); },
        });
      }
      if (out.filter((r) => r.kind === 'campaign').length >= 5) break;
    }

    // Contatos
    for (const c of contacts) {
      if (
        c.name?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.tags?.some((t) => t.toLowerCase().includes(q))
      ) {
        out.push({
          id: `contact-${c.id}`,
          kind: 'contact',
          title: c.name,
          subtitle: `${c.phone}${c.city ? ` · ${c.city}` : ''}`,
          icon: <Users className="w-4 h-4" />,
          onSelect: () => { onNavigate('contacts'); onClose(); },
        });
      }
      if (out.filter((r) => r.kind === 'contact').length >= 5) break;
    }

    // Chips / conexões
    for (const conn of connections) {
      const label = conn.name || conn.phoneNumber || conn.id || '';
      if (
        label.toLowerCase().includes(q) ||
        (conn.phoneNumber ?? '').includes(q)
      ) {
        out.push({
          id: `chip-${conn.id}`,
          kind: 'chip',
          title: label,
          subtitle: `${conn.status} · ${conn.phoneNumber ?? 'sem número'}`,
          icon: <Smartphone className="w-4 h-4" />,
          onSelect: () => { onNavigate('connections'); onClose(); },
        });
      }
      if (out.filter((r) => r.kind === 'chip').length >= 5) break;
    }

    // Ações rápidas que batem com a query
    const actions: Array<[string, string, string, React.ReactNode]> = [
      ['campaigns', 'campanhas', 'Ir para campanhas', <Send className="w-4 h-4" />],
      ['contacts', 'contatos', 'Ir para contatos', <Users className="w-4 h-4" />],
      ['connections', 'chips conexões', 'Ver chips', <Smartphone className="w-4 h-4" />],
      ['chat', 'chat atendimento', 'Abrir chat', <MessageCircle className="w-4 h-4" />],
      ['reports', 'relatórios métricas funil', 'Ver relatórios', <BarChart3 className="w-4 h-4" />],
      ['settings', 'configurações', 'Configurações', <Settings className="w-4 h-4" />],
      ['warmup', 'aquecimento warmup chip', 'Aquecimento', <Zap className="w-4 h-4" />],
    ];
    for (const [view, keywords, label, icon] of actions) {
      if (keywords.toLowerCase().includes(q)) {
        out.push({
          id: `action-${view}`,
          kind: 'action',
          title: label,
          icon,
          onSelect: () => { onNavigate(view); onClose(); },
        });
      }
    }

    return out.slice(0, 12);
  }, [query, campaigns, contacts, connections, onNavigate, onClose]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[selected]?.onSelect();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [results, selected, onClose]);

  // Scroll para o item selecionado
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const q = query.trim();

  return (
    <div
      className="fixed inset-0 zm-layer-search flex items-start justify-center pt-[10vh]"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] mx-4 rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: 'var(--surface-0)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Search className="w-4.5 h-4.5 shrink-0" style={{ color: 'var(--brand)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar campanhas, contatos, chips, ações..."
            className="flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:font-normal"
            style={{ color: 'var(--text-1)' }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="rounded-lg p-1 transition-colors hover:bg-[var(--surface-2)]">
              <X className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
            </button>
          )}
          <kbd
            className="hidden sm:flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--text-3)', background: 'var(--surface-1)' }}
          >
            ESC
          </kbd>
        </div>

        {/* Resultados */}
        <div ref={listRef} className="max-h-[min(60vh,460px)] overflow-y-auto">
          {results.length === 0 && q ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <Search className="w-8 h-8 opacity-20" />
              <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
                Nenhum resultado para <strong>"{q}"</strong>
              </p>
            </div>
          ) : (
            <ul className="py-2">
              {results.map((r, idx) => {
                const isActive = idx === selected;
                const color = KIND_COLORS[r.kind];
                return (
                  <li key={r.id} data-idx={idx}>
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                      style={{
                        background: isActive ? 'var(--surface-1)' : 'transparent',
                        borderLeft: isActive ? `2px solid ${color}` : '2px solid transparent',
                      }}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={r.onSelect}
                    >
                      <span
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${color}18`, color }}
                      >
                        {r.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {highlight(r.title, q)}
                        </div>
                        {r.subtitle && (
                          <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                            {highlight(r.subtitle, q)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{ background: `${color}18`, color }}
                        >
                          {KIND_LABELS[r.kind]}
                        </span>
                        {isActive && <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Rodapé */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-t"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
            <span>↑↓ navegar</span>
            <span>↵ abrir</span>
            <span>ESC fechar</span>
          </div>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {results.length} resultado{results.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
};
