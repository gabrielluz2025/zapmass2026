import React from 'react';
import {
  ArrowDownAZ,
  CalendarClock,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Smartphone,
  Users
} from 'lucide-react';
import { Button, Card, CardHeader, EmptyState } from '../../ui';
import {
  type AccessFilter,
  type AccessUser,
  accessHealthStyles,
  computeAccessHealth,
  formatAccessProviderLabel,
  formatAccessStatusLabel,
  toPtDateTime,
  userInitial
} from './adminAccessUtils';

export type DirectorySort = 'email' | 'expiry' | 'status';

const FILTER_ITEMS: ReadonlyArray<{ id: AccessFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'manual', label: 'Manual' },
  { id: 'blocked', label: 'Bloq.' },
  { id: 'active', label: 'Ativos' },
  { id: 'trialing', label: 'Trial' },
  { id: 'expiring7', label: '≤7d' }
];

const SORT_LABELS: Record<DirectorySort, string> = {
  email: 'E-mail (A–Z)',
  expiry: 'Vencimento',
  status: 'Status'
};

const statusSortRank = (u: AccessUser): number => {
  if (u.blocked) return 0;
  const s = (u.status || '').toLowerCase();
  if (s === 'active') return 1;
  if (s === 'trialing') return 2;
  if (s === 'past_due') return 3;
  return 4;
};

export function sortAccessUsers(list: AccessUser[], sort: DirectorySort): AccessUser[] {
  const copy = [...list];
  if (sort === 'email') {
    copy.sort((a, b) => (a.email || '').localeCompare(b.email || '', 'pt-BR', { sensitivity: 'base' }));
    return copy;
  }
  if (sort === 'status') {
    copy.sort((a, b) => {
      const d = statusSortRank(a) - statusSortRank(b);
      if (d !== 0) return d;
      return (a.email || '').localeCompare(b.email || '', 'pt-BR', { sensitivity: 'base' });
    });
    return copy;
  }
  copy.sort((a, b) => {
    const ha = computeAccessHealth(a);
    const hb = computeAccessHealth(b);
    const ma = ha.nextAt ? Date.parse(ha.nextAt) : Number.POSITIVE_INFINITY;
    const mb = hb.nextAt ? Date.parse(hb.nextAt) : Number.POSITIVE_INFINITY;
    if (ma !== mb) return ma - mb;
    return (a.email || '').localeCompare(b.email || '', 'pt-BR', { sensitivity: 'base' });
  });
  return copy;
}

const StatusChip: React.FC<{
  dotClass: string;
  label: string;
  tone?: 'neutral' | 'info' | 'danger' | 'success';
}> = ({ dotClass, label, tone = 'neutral' }) => {
  const toneBg =
    tone === 'danger'
      ? 'bg-red-500/12 border-red-500/25 text-red-300'
      : tone === 'success'
        ? 'bg-emerald-500/12 border-emerald-500/25 text-emerald-200'
        : tone === 'info'
          ? 'bg-sky-500/12 border-sky-500/25 text-sky-200'
          : 'bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-2)]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide shrink-0 ${toneBg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} aria-hidden />
      {label}
    </span>
  );
};

const DirectoryAccountRow: React.FC<{
  user: AccessUser;
  selected: boolean;
  onSelect: () => void;
}> = ({ user: u, selected, onSelect }) => {
  const h = computeAccessHealth(u);
  const styles = accessHealthStyles[h.health];
  const channelBase = Math.max(0, Math.min(5, Math.floor(Number(u.includedChannels) || 0)));
  const providerLabel = formatAccessProviderLabel(u.provider);
  const expiryTitle =
    h.nextAt != null
      ? `${h.nextLabel} · ${toPtDateTime(h.nextAt)}${h.daysRemaining != null ? ` · ${h.daysRemaining}d` : ''}`
      : h.nextLabel;

  const channelShort =
    Number(u.manualExtraChannelSlots) > 0 ? `${channelBase || 0}+${u.manualExtraChannelSlots}` : `${channelBase || '—'}`;

  const statusLabel = formatAccessStatusLabel(u.status, u.blocked);
  const statusTone = u.blocked ? 'danger' : u.status === 'active' ? 'success' : u.status === 'trialing' ? 'info' : 'neutral';
  const statusDot =
    u.blocked ? 'bg-red-500' : u.status === 'active' ? 'bg-emerald-500' : u.status === 'trialing' ? 'bg-sky-400' : 'bg-slate-500';

  return (
    <button
      type="button"
      onClick={onSelect}
      title={expiryTitle}
      className={`group relative w-full text-left rounded-xl border px-3 py-3 sm:px-4 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
        selected
          ? 'border-emerald-500/35 bg-gradient-to-r from-emerald-500/[0.12] via-emerald-500/[0.04] to-transparent shadow-[0_0_24px_-4px_rgba(16,185,129,0.35)]'
          : 'border-[var(--border-subtle)] bg-[var(--surface-1)]/80 hover:border-emerald-500/20 hover:bg-[var(--surface-1)] hover:shadow-md hover:shadow-black/20'
      }`}
    >
      {selected ? (
        <span
          className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-teal-600"
          aria-hidden
        />
      ) : null}

      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`relative w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-[13px] text-white ring-2 ring-offset-2 ring-offset-[var(--surface-0)] ${styles.ring}`}
          style={{
            background: selected
              ? 'linear-gradient(145deg, #10b981 0%, #059669 45%, #0d9488 100%)'
              : 'linear-gradient(145deg, #047857 0%, #059669 55%, #14b8a6 100%)'
          }}
        >
          {userInitial(u.email)}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold truncate leading-tight" style={{ color: 'var(--text-1)' }}>
            {u.email || 'Sem e-mail'}
          </p>
          <p className="text-[11px] mt-1 truncate flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
            <CalendarClock className={`w-3 h-3 shrink-0 ${styles.text}`} aria-hidden />
            <span className={`font-medium ${styles.text}`}>{h.nextLabel}</span>
            {h.daysRemaining != null ? (
              <span className="tabular-nums opacity-80">· {h.daysRemaining}d</span>
            ) : null}
            {providerLabel ? (
              <>
                <span className="opacity-35" aria-hidden>
                  ·
                </span>
                <Shield className="w-3 h-3 shrink-0 opacity-60" aria-hidden />
                <span>{providerLabel}</span>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <StatusChip dotClass={statusDot} label={statusLabel} tone={statusTone} />
            {u.manualGrant ? <StatusChip dotClass="bg-sky-400" label="Manual" tone="info" /> : null}
            {h.health === 'critical' || h.health === 'warning' ? (
              <StatusChip
                dotClass={styles.dot}
                label={h.health === 'critical' ? 'Vence em breve' : 'Atenção prazo'}
                tone={h.health === 'critical' ? 'danger' : 'neutral'}
              />
            ) : null}
          </div>
        </div>

        <div
          className="shrink-0 flex flex-col items-end gap-1 pl-1"
          title={Number(u.manualExtraChannelSlots) > 0 ? `Canais +${u.manualExtraChannelSlots} bônus` : 'Canais do plano'}
        >
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold tabular-nums border border-[var(--border-subtle)] bg-black/20 text-[var(--text-2)]">
            <Smartphone className="w-3.5 h-3.5 text-emerald-500/80" aria-hidden />
            {channelShort}
          </span>
        </div>
      </div>
    </button>
  );
};

const DirectorySkeleton: React.FC = () => (
  <div className="p-2 space-y-2 animate-pulse" aria-hidden>
    {Array.from({ length: 6 }).map((_, i) => (
      <div
        key={i}
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)]/50 px-4 py-3 flex gap-3"
      >
        <div className="w-10 h-10 rounded-full bg-slate-700/60" />
        <div className="flex-1 space-y-2 py-0.5">
          <div className="h-3.5 w-[62%] rounded-md bg-slate-700/50" />
          <div className="h-2.5 w-[45%] rounded-md bg-slate-800/60" />
          <div className="flex gap-2 pt-1">
            <div className="h-5 w-16 rounded-full bg-slate-800/50" />
            <div className="h-5 w-14 rounded-full bg-slate-800/40" />
          </div>
        </div>
        <div className="h-7 w-12 rounded-full bg-slate-800/50" />
      </div>
    ))}
  </div>
);

export type DirectoryAccountListProps = {
  usersTotal: number;
  filteredUsers: AccessUser[];
  filterCounts: Record<AccessFilter, number>;
  filter: AccessFilter;
  onFilterChange: (f: AccessFilter) => void;
  sort: DirectorySort;
  onSortChange: (s: DirectorySort) => void;
  search: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  usersLoading: boolean;
  loadError: string | null;
  onRetryLoad: () => void;
  selectedUid: string | null;
  onSelectUser: (u: AccessUser) => void;
};

export const DirectoryAccountList: React.FC<DirectoryAccountListProps> = ({
  usersTotal,
  filteredUsers,
  filterCounts,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  onSearchSubmit,
  searchInputRef,
  usersLoading,
  loadError,
  onRetryLoad,
  selectedUid,
  onSelectUser
}) => (
  <Card className="overflow-hidden !p-0 relative">
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.35]"
      style={{
        background:
          'radial-gradient(ellipse 80% 50% at 50% -20%, color-mix(in srgb, var(--brand-500) 18%, transparent), transparent 70%)'
      }}
      aria-hidden
    />

    <div
      className="sticky top-0 z-10 border-b backdrop-blur-md supports-[backdrop-filter]:bg-[var(--surface-0)]/85"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div className="p-4 pb-3 space-y-3">
        <CardHeader
          title="Diretório de contas"
          subtitle={`${filteredUsers.length} na vista · ${usersTotal} carregadas`}
          icon={<Users className="w-4 h-4 text-emerald-400" />}
          className="!mb-0"
        />

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500/50" />
            <input
              ref={searchInputRef}
              className="ui-input pl-10 !bg-[var(--surface-1)]/90 border-[var(--border-subtle)] focus:border-emerald-500/40"
              placeholder="Buscar e-mail ou UID… ( / )"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <div className="relative min-w-[148px]">
              <ArrowDownAZ className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-3)]" />
              <select
                className="ui-input pl-8 pr-8 appearance-none cursor-pointer text-[12px] !bg-[var(--surface-1)]/90"
                value={sort}
                onChange={(e) => onSortChange(e.target.value as DirectorySort)}
                aria-label="Ordenar lista"
              >
                {(Object.keys(SORT_LABELS) as DirectorySort[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-3)]" />
            </div>
            <Button variant="secondary" size="sm" onClick={onSearchSubmit}>
              Buscar
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTER_ITEMS.map(({ id, label }) => {
            const active = filter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onFilterChange(id)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all duration-200 ${
                  active
                    ? 'border-emerald-400/50 text-emerald-100 bg-gradient-to-b from-emerald-500/25 to-emerald-600/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-emerald-500/30'
                    : 'border-[var(--border-subtle)] text-[var(--text-2)] bg-[var(--surface-1)]/60 hover:border-emerald-500/25 hover:text-[var(--text-1)]'
                }`}
              >
                {label}{' '}
                <span className={`tabular-nums ${active ? 'text-emerald-200/90' : 'opacity-55'}`}>
                  {filterCounts[id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>

    <div className="max-h-[min(62vh,560px)] overflow-y-auto p-2 space-y-1.5">
      {usersLoading ? (
        <DirectorySkeleton />
      ) : loadError ? (
        <div className="py-12 px-4 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-red-500/10 border border-red-500/25">
            <RefreshCw className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>
              Não foi possível carregar o diretório
            </p>
            <p className="text-[12px] mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-3)' }}>
              {loadError}
            </p>
          </div>
          <Button variant="primary" size="sm" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRetryLoad}>
            Tentar novamente
          </Button>
        </div>
      ) : filteredUsers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-7 h-7 text-emerald-500/60" />}
          title={usersTotal === 0 ? 'Nenhuma conta no servidor' : 'Nenhuma conta neste filtro'}
          description={
            usersTotal === 0
              ? 'Confirme sua sessão de admin e use «Atualizar». Se o problema persistir, entre novamente.'
              : 'Ajuste os filtros ou busque outro e-mail/UID. Use «Buscar» para consultar o servidor.'
          }
          className="!py-12"
        />
      ) : (
        filteredUsers.map((u) => (
          <DirectoryAccountRow
            key={u.uid}
            user={u}
            selected={selectedUid === u.uid}
            onSelect={() => onSelectUser(u)}
          />
        ))
      )}
    </div>

    {usersLoading ? (
      <div
        className="absolute bottom-3 right-3 flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] border backdrop-blur-sm"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)/90', color: 'var(--text-3)' }}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
        Sincronizando…
      </div>
    ) : null}
  </Card>
);
