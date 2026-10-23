import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  History,
  KeyRound,
  LayoutList,
  Lightbulb,
  Link2,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Unlock,
  Users
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { Badge, Button, Card, CardHeader, EmptyState, Modal, SectionHeader, StatCard, TabBar } from '../../ui';
import { apiUrl } from '../../../utils/apiBase';
import {
  type AccessAudit,
  type AccessFilter,
  type AccessUser,
  type AccessUserInsights,
  accessExpirySlices,
  accessHealthStyles,
  computeAccessHealth,
  formatAccessProviderLabel,
  formatAccessStatusLabel,
  formatAppUsageMs,
  statusBadgeVariant,
  toPtDateTime,
  userInitial
} from './adminAccessUtils';

type DetailTab = 'resumo' | 'metricas' | 'acoes';
type GrantModalStep = 'access' | 'credentials' | 'extras';

const ACCESS_SELECTED_UID_KEY = 'zapmass_admin_access_selected_uid';

const GRANT_MODAL_STEPS: Array<{
  id: GrantModalStep;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  { id: 'access', label: 'Acesso', Icon: KeyRound },
  { id: 'credentials', label: 'Credenciais', Icon: Shield },
  { id: 'extras', label: 'Canais extras', Icon: Smartphone }
];

const DETAIL_TABS: Array<{
  id: DetailTab;
  label: string;
  Icon: React.FC<{ className?: string }>;
  activeClass: string;
}> = [
  { id: 'resumo', label: 'Resumo', Icon: LayoutList, activeClass: 'text-sky-600 dark:text-sky-400' },
  { id: 'metricas', label: 'Métricas', Icon: BarChart3, activeClass: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'acoes', label: 'Ações', Icon: SlidersHorizontal, activeClass: 'text-amber-600 dark:text-amber-400' }
];

const SUPPORT_SNIPPETS: Array<{ id: string; title: string; text: string }> = [
  {
    id: 'approved',
    title: 'Pagamento aprovado',
    text: 'Seu pagamento foi aprovado e seu plano já foi atualizado. Se a tela ainda não refletiu, atualize a página em 10-20 segundos.'
  },
  {
    id: 'pending',
    title: 'Pagamento pendente',
    text: 'Seu pagamento está pendente. Assim que for confirmado pelo provedor, os canais são liberados automaticamente.'
  },
  {
    id: 'limit',
    title: 'Limite atingido',
    text: 'Você atingiu o limite de canais do seu plano atual. Abra Minha assinatura e escolha um plano com mais canais.'
  },
  {
    id: 'no-update',
    title: 'Sem atualização após pagamento',
    text: 'Me passe o e-mail da conta e o horário do pagamento para eu verificar o webhook e atualizar manualmente, se necessário.'
  }
];

const copyToClipboard = async (text: string, okMessage = 'Copiado.') => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error('Não foi possível copiar.');
  }
};

const FieldLabel: React.FC<{ htmlFor?: string; children: React.ReactNode; hint?: string }> = ({
  htmlFor,
  children,
  hint
}) => (
  <div className="space-y-1">
    <label htmlFor={htmlFor} className="text-[12px] font-medium block" style={{ color: 'var(--text-2)' }}>
      {children}
    </label>
    {hint ? (
      <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
        {hint}
      </p>
    ) : null}
  </div>
);

const Metric: React.FC<{ label: string; value: number; accent?: string }> = ({ label, value, accent }) => (
  <div
    className="rounded-xl border p-3 transition-transform hover:scale-[1.02]"
    style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
  >
    <p className="text-[10px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </p>
    <p className="text-[20px] font-extrabold leading-tight tabular-nums" style={{ color: accent || 'var(--text-1)' }}>
      {value}
    </p>
  </div>
);

const AccessTimeline: React.FC<{ user: AccessUser }> = ({ user }) => {
  const now = Date.now();
  const slices = accessExpirySlices(user);
  return (
    <div className="space-y-2">
      {slices.map((s) => {
        const active = s.ms > now;
        const expired = s.ms > 0 && s.ms <= now;
        const open = !s.at && s.key === 'manual' && user.manualGrant;
        return (
          <div
            key={s.key}
            className="flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors"
            style={{
              borderColor: active ? 'color-mix(in srgb, var(--brand-500) 35%, transparent)' : 'var(--border-subtle)',
              background: active ? 'color-mix(in srgb, var(--brand-500) 6%, var(--surface-1))' : 'var(--surface-1)'
            }}
          >
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-emerald-500 animate-pulse' : expired ? 'bg-slate-500' : open ? 'bg-sky-500' : 'bg-slate-600'}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {s.label}
              </p>
              <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
                {open ? 'Sem data de expiração' : toPtDateTime(s.at)}
              </p>
            </div>
            {active && s.ms ? (
              <span className="text-[10px] font-bold tabular-nums text-emerald-500">
                {Math.ceil((s.ms - now) / 86400000)}d
              </span>
            ) : expired ? (
              <span className="text-[10px] text-slate-500">Expirado</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

const ActionSection: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({
  title,
  description,
  children
}) => (
  <div
    className="rounded-xl border p-4 space-y-3.5"
    style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
  >
    <div>
      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
        {title}
      </p>
      {description ? (
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {description}
        </p>
      ) : null}
    </div>
    {children}
  </div>
);

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

  const channelText =
    Number(u.manualExtraChannelSlots) > 0
      ? `${channelBase || '—'} canais +${u.manualExtraChannelSlots} bônus`
      : `${channelBase || '—'} canais`;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={expiryTitle}
      className={`w-full text-left px-3.5 py-2.5 sm:px-4 sm:py-3 transition-colors border-l-[3px] hover:bg-[var(--surface-1)] ${
        selected ? 'border-l-emerald-500 bg-emerald-500/[0.06]' : 'border-l-transparent'
      }`}
    >
      <div className="flex gap-3 items-start">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-semibold text-white text-[13px]"
          style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
        >
          {userInitial(u.email)}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-semibold truncate leading-tight" style={{ color: 'var(--text-1)' }}>
              {u.email || 'Sem e-mail'}
            </span>
            <Badge variant={statusBadgeVariant(u.status, u.blocked)} dot className="!shrink-0">
              {formatAccessStatusLabel(u.status, u.blocked)}
            </Badge>
            {u.manualGrant ? (
              <Badge variant="info" className="!shrink-0">
                Manual
              </Badge>
            ) : null}
          </div>
          <p className="text-[11px] leading-snug line-clamp-2 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: 'var(--text-3)' }}>
            <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${styles.text}`}>
              <CalendarClock className="w-3 h-3 shrink-0 opacity-75" aria-hidden />
              {h.nextLabel}
              {h.daysRemaining != null ? <span className="opacity-80">· {h.daysRemaining}d</span> : null}
            </span>
            <span className="opacity-40" aria-hidden>
              ·
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Smartphone className="w-3 h-3 text-emerald-500/70 shrink-0" aria-hidden />
              {channelText}
            </span>
            {providerLabel ? (
              <>
                <span className="opacity-40" aria-hidden>
                  ·
                </span>
                <span>{providerLabel}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </button>
  );
};

const QuickReplyCard: React.FC<{ title: string; text: string }> = ({ title, text }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="group flex flex-col rounded-xl border p-4 transition-colors hover:border-emerald-500/25"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 brand-soft">
          <MessageSquare className="w-4 h-4 text-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
              {title}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 !h-8"
              leftIcon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => void copyToClipboard(text, `"${title}" copiado.`)}
            >
              Copiar
            </Button>
          </div>
          <p
            className={`text-[12px] mt-2 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}
            style={{ color: 'var(--text-2)' }}
          >
            {text}
          </p>
          {text.length > 120 ? (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500 hover:text-emerald-400"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <>
                  Recolher <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  Ver texto completo <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const AdminAccessTab: React.FC = () => {
  const { user } = useAuth();
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AccessFilter>('all');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('resumo');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantDays, setGrantDays] = useState('30');
  const [grantNote, setGrantNote] = useState('');
  const [grantPassword, setGrantPassword] = useState('');
  const [channelGrantSlots, setChannelGrantSlots] = useState('1');
  const [channelGrantDays, setChannelGrantDays] = useState('30');
  const [channelGrantMonths, setChannelGrantMonths] = useState('0');
  const [includedChannelsGrant, setIncludedChannelsGrant] = useState('5');
  const [selectedNewPassword, setSelectedNewPassword] = useState('');
  const [extraChannelSlots, setExtraChannelSlots] = useState('0');
  const [accessActionBusy, setAccessActionBusy] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRows, setAuditRows] = useState<AccessAudit[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState<AccessUserInsights | null>(null);
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [grantModalStep, setGrantModalStep] = useState<GrantModalStep>('access');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(async () => {
    if (!user) throw new Error('Faça login.');
    const idToken = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    };
  }, [user]);

  const loadAccessUsers = useCallback(
    async (searchTerm = '') => {
      if (!user) return;
      setUsersLoading(true);
      try {
        const idToken = await user.getIdToken();
        const qs = searchTerm.trim() ? `?search=${encodeURIComponent(searchTerm.trim())}` : '';
        const res = await fetch(apiUrl(`/api/admin/access-users${qs}`), {
          headers: { Authorization: `Bearer ${idToken}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao listar usuários.');
        }
        setUsers(Array.isArray(data.users) ? data.users : []);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível carregar acessos.');
      } finally {
        setUsersLoading(false);
      }
    },
    [user]
  );

  const loadAudit = useCallback(async () => {
    if (!user) return;
    setAuditLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/admin/access-audit?limit=80'), {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar auditoria.');
      }
      setAuditRows(Array.isArray(data.audit) ? data.audit : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Auditoria indisponível.');
    } finally {
      setAuditLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadAccessUsers('');
    void loadAudit();
  }, [loadAccessUsers, loadAudit]);

  useEffect(() => {
    if (users.length === 0 || selectedUid) return;
    const stored = sessionStorage.getItem(ACCESS_SELECTED_UID_KEY);
    if (!stored) return;
    const match = users.find((u) => u.uid === stored);
    if (match) {
      setSelectedUid(match.uid);
      setExtraChannelSlots(String(match.manualExtraChannelSlots ?? 0));
      void loadInsightsForUid(match.uid);
    }
  }, [users, selectedUid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setGrantModalOpen(true);
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updateAccessUser = async (
    payload: Partial<AccessUser> & {
      uid?: string;
      email?: string;
      manualGrant?: boolean;
      grantDays?: number | null;
      grantMode?: 'set' | 'extend';
      manualExtraChannelSlots?: number | null;
      channelGrantDays?: number | null;
      channelGrantMonths?: number | null;
      channelGrantMode?: 'set' | 'extend';
      includedChannels?: number | null;
      newPassword?: string;
      adminNote?: string;
    }
  ) => {
    const res = await fetch(apiUrl('/api/admin/access-user'), {
      method: 'PUT',
      headers: await authHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao atualizar acesso.');
    }
    return data.user as AccessUser;
  };

  const loadInsightsForUid = async (uid: string) => {
    if (!user) return;
    setInsightsLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl(`/api/admin/access-user-insights?uid=${encodeURIComponent(uid)}`), {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar perfil.');
      }
      setInsights(data.insights as AccessUserInsights);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Perfil indisponível.');
      setInsights(null);
    } finally {
      setInsightsLoading(false);
    }
  };

  const selectUser = (u: AccessUser) => {
    setSelectedUid(u.uid);
    sessionStorage.setItem(ACCESS_SELECTED_UID_KEY, u.uid);
    setDetailTab('resumo');
    setSelectedNewPassword('');
    setExtraChannelSlots(String(u.manualExtraChannelSlots ?? 0));
    void loadInsightsForUid(u.uid);
  };

  const exportFilteredUsers = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      filter,
      search: search.trim() || null,
      total: filteredUsers.length,
      users: filteredUsers.map((u) => ({
        uid: u.uid,
        email: u.email,
        status: u.status,
        blocked: u.blocked,
        manualGrant: u.manualGrant,
        plan: u.plan,
        includedChannels: u.includedChannels,
        manualExtraChannelSlots: u.manualExtraChannelSlots
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zapmass-acessos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filteredUsers.length} conta(s) exportada(s).`);
  };

  const selectedUser = useMemo(
    () => users.find((u) => u.uid === selectedUid) ?? null,
    [users, selectedUid]
  );

  const filteredUsers = useMemo(() => {
    const now = Date.now();
    const limit = now + 7 * 86400000;
    return users.filter((u) => {
      if (filter === 'all') return true;
      if (filter === 'manual') return u.manualGrant;
      if (filter === 'blocked') return u.blocked;
      if (filter === 'active') return u.status === 'active' && !u.blocked;
      if (filter === 'trialing') return u.status === 'trialing' && !u.blocked;
      if (filter === 'expiring7') {
        return accessExpirySlices(u)
          .map((s) => s.ms)
          .some((ms) => ms > now && ms <= limit);
      }
      return true;
    });
  }, [users, filter]);

  const filterCounts = useMemo(() => {
    const now = Date.now();
    const limit = now + 7 * 86400000;
    return {
      all: users.length,
      manual: users.filter((u) => u.manualGrant).length,
      blocked: users.filter((u) => u.blocked).length,
      active: users.filter((u) => u.status === 'active' && !u.blocked).length,
      trialing: users.filter((u) => u.status === 'trialing' && !u.blocked).length,
      expiring7: users.filter((u) =>
        accessExpirySlices(u)
          .map((s) => s.ms)
          .some((ms) => ms > now && ms <= limit)
      ).length
    };
  }, [users]);

  const filteredAudit = useMemo(() => {
    if (!selectedUid) return auditRows.slice(0, 20);
    return auditRows.filter((r) => r.targetUid === selectedUid).slice(0, 30);
  }, [auditRows, selectedUid]);

  const toggleBlock = async (u: AccessUser) => {
    try {
      const updated = await updateAccessUser({ uid: u.uid, blocked: !u.blocked });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      toast.success(updated.blocked ? 'Usuário bloqueado.' : 'Usuário desbloqueado.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao bloquear.');
    }
  };

  const quickExtend = async (u: AccessUser, days: number) => {
    try {
      const updated = await updateAccessUser({
        uid: u.uid,
        manualGrant: true,
        grantDays: days,
        grantMode: 'extend'
      });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      toast.success(`+${days} dias aplicados.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao estender.');
    }
  };

  const quickExtendChannels = async (u: AccessUser, slots: number, days: number, months = 0) => {
    try {
      const updated = await updateAccessUser({
        uid: u.uid,
        manualExtraChannelSlots: Math.max(1, Math.min(3, Math.floor(slots))),
        channelGrantDays: Math.max(0, Math.floor(days)),
        channelGrantMonths: Math.max(0, Math.floor(months)),
        channelGrantMode: 'extend'
      });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      const suffix = months > 0 ? `+${months}m` : `+${days}d`;
      toast.success(`Canais extras estendidos (${suffix}).`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao estender canais.');
    }
  };

  const revokeExtraChannels = async (u: AccessUser) => {
    try {
      const updated = await updateAccessUser({ uid: u.uid, manualExtraChannelSlots: 0 });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      setExtraChannelSlots('0');
      toast.success('Canais extras manuais revogados.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao revogar canais extras.');
    }
  };

  const handleGrantByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail.');
      return;
    }
    const days = Math.max(0, Math.round(Number(grantDays) || 0));
    const channels = Math.max(1, Math.min(5, Math.floor(Number(includedChannelsGrant) || 5)));
    setAccessActionBusy(true);
    try {
      const updated = await updateAccessUser({
        email: grantEmail.trim(),
        manualGrant: true,
        grantDays: days > 0 ? days : null,
        includedChannels: channels,
        adminNote: grantNote.trim()
      });
      setUsers((prev) => [updated, ...prev.filter((u) => u.uid !== updated.uid)]);
      selectUser(updated);
      toast.success(
        `Acesso liberado com ${channels} canal(is). Peça ao cliente para atualizar a página (Ctrl+F5).`
      );
      setGrantEmail('');
      setGrantNote('');
      setGrantModalOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao liberar.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const handleGrantChannelsByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail.');
      return;
    }
    const slots = Math.max(0, Math.min(3, Math.floor(Number(channelGrantSlots) || 0)));
    const days = Math.max(0, Math.floor(Number(channelGrantDays) || 0));
    const months = Math.max(0, Math.floor(Number(channelGrantMonths) || 0));
    if (slots <= 0) {
      toast.error('Escolha de 1 a 3 canais extras.');
      return;
    }
    setAccessActionBusy(true);
    try {
      const updated = await updateAccessUser({
        email: grantEmail.trim(),
        manualExtraChannelSlots: slots,
        channelGrantDays: days,
        channelGrantMonths: months,
        channelGrantMode: 'set',
        adminNote: grantNote.trim()
      });
      setUsers((prev) => [updated, ...prev.filter((u) => u.uid !== updated.uid)]);
      selectUser(updated);
      toast.success('Canais extras liberados. Peça ao cliente para atualizar a página (Ctrl+F5).');
      setGrantModalOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao liberar canais extras.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const handleSetPasswordByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail.');
      return;
    }
    if (grantPassword.trim().length < 8) {
      toast.error('Senha deve ter ao menos 8 caracteres.');
      return;
    }
    setAccessActionBusy(true);
    try {
      await updateAccessUser({
        email: grantEmail.trim(),
        newPassword: grantPassword.trim(),
        adminNote: grantNote.trim() || 'Senha definida pelo admin (sem e-mail)'
      });
      toast.success('Senha definida. O cliente já pode entrar com ela.');
      setGrantPassword('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao definir senha.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const copyResetLinkForEmail = async (email: string) => {
    if (!email.trim()) {
      toast.error('Informe o e-mail.');
      return;
    }
    setAccessActionBusy(true);
    try {
      const res = await fetch(apiUrl('/api/admin/password-reset-link'), {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ email: email.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || typeof data.resetUrl !== 'string') {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao gerar o link.');
      }
      await navigator.clipboard.writeText(data.resetUrl);
      toast.success(
        data.mailerConfigured
          ? 'Link copiado. Se o e-mail estiver configurado, o cliente também recebe na caixa.'
          : 'Link copiado (válido 1h). Envie no WhatsApp — o e-mail automático ainda está desligado.'
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const grantEmailForOps = () => (grantEmail.trim() || selectedUser?.email || '').trim();

  const grantModalFooter = (
    <>
      <Button variant="secondary" size="sm" onClick={() => setGrantModalOpen(false)}>
        Fechar
      </Button>
      {grantModalStep === 'access' ? (
        <Button variant="primary" size="sm" loading={accessActionBusy} onClick={() => void handleGrantByEmail()}>
          Conceder acesso
        </Button>
      ) : grantModalStep === 'credentials' ? (
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            variant="secondary"
            size="sm"
            loading={accessActionBusy}
            leftIcon={<KeyRound className="w-3.5 h-3.5" />}
            onClick={() => void handleSetPasswordByEmail()}
          >
            Aplicar senha
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={accessActionBusy}
            leftIcon={<Link2 className="w-3.5 h-3.5" />}
            onClick={() => void copyResetLinkForEmail(grantEmailForOps())}
          >
            Copiar link de reset
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          size="sm"
          loading={accessActionBusy}
          leftIcon={<Smartphone className="w-3.5 h-3.5" />}
          onClick={() => void handleGrantChannelsByEmail()}
        >
          Liberar canais extras
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <SectionHeader
        eyebrow="Administração"
        title="Centro de acessos"
        description="Diretório de contas, prazos e ações de suporte. Use a lista para detalhes; liberações ficam no fluxo «Nova liberação»."
        icon={<Shield className="w-5 h-5 text-emerald-500" />}
        actions={
          <>
            <span className="hidden sm:inline text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }} title="Atalhos">
              <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono" style={{ borderColor: 'var(--border-subtle)' }}>
                Ctrl+N
              </kbd>{' '}
              nova ·{' '}
              <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono" style={{ borderColor: 'var(--border-subtle)' }}>
                /
              </kbd>{' '}
              buscar
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={usersLoading || filteredUsers.length === 0}
              leftIcon={<Download className="w-3.5 h-3.5" />}
              onClick={exportFilteredUsers}
            >
              Exportar ({filteredUsers.length})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={usersLoading}
              leftIcon={usersLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => {
                void loadAccessUsers(search);
                void loadAudit();
              }}
            >
              Atualizar
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setGrantModalOpen(true)}>
              Nova liberação
            </Button>
          </>
        }
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard
          label="Contas ativas"
          value={users.filter((u) => !u.blocked).length}
          helper={`${users.length} carregadas · ${filteredUsers.length} na vista atual`}
          icon={<Users className="w-4 h-4 text-emerald-600" />}
          accent="success"
        />
        <StatCard
          label="Bloqueados"
          value={users.filter((u) => u.blocked).length}
          icon={<Lock className="w-4 h-4 text-red-500" />}
          accent="danger"
        />
        <StatCard
          label="Manual"
          value={users.filter((u) => u.manualGrant).length}
          icon={<KeyRound className="w-4 h-4 text-sky-600" />}
          accent="info"
        />
        <StatCard
          label="Expira ≤7d"
          value={filterCounts.expiring7}
          icon={<Clock3 className="w-4 h-4 text-amber-600" />}
          accent="warning"
        />
        <StatCard
          label="Exportável"
          value={filteredUsers.length}
          helper="JSON da lista filtrada"
          icon={<Download className="w-4 h-4 text-emerald-600" />}
          accent="default"
        />
      </div>

      <Modal
        isOpen={grantModalOpen}
        onClose={() => setGrantModalOpen(false)}
        size="lg"
        title="Nova liberação"
        subtitle="Conceda acesso, credenciais ou canais extras sem poluir a tela principal."
        icon={<KeyRound className="w-5 h-5 text-emerald-500" />}
        footer={grantModalFooter}
      >
        <div className="space-y-5">
          <div>
            <FieldLabel htmlFor="grant-email-modal" hint="Conta existente ou nova — o backend cria/atualiza conforme o e-mail.">
              E-mail do cliente
            </FieldLabel>
            <input
              id="grant-email-modal"
              className="ui-input mt-1.5"
              placeholder="cliente@empresa.com"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              autoFocus
            />
          </div>
          <TabBar
            items={GRANT_MODAL_STEPS.map(({ id, label, Icon }) => ({
              id,
              label,
              Icon,
              activeClass: 'text-emerald-600 dark:text-emerald-400'
            }))}
            activeId={grantModalStep}
            onChange={(id) => setGrantModalStep(id as GrantModalStep)}
            ariaLabel="Etapas da nova liberação"
            className="!px-0"
          />
          {grantModalStep === 'access' ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel htmlFor="grant-days">Dias de acesso manual</FieldLabel>
                  <input
                    id="grant-days"
                    className="ui-input mt-1.5"
                    type="number"
                    min={0}
                    value={grantDays}
                    onChange={(e) => setGrantDays(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="grant-channels" hint="1–5 canais incluídos no plano.">
                    Canais do plano
                  </FieldLabel>
                  <input
                    id="grant-channels"
                    className="ui-input mt-1.5"
                    type="number"
                    min={1}
                    max={5}
                    value={includedChannelsGrant}
                    onChange={(e) => setIncludedChannelsGrant(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="grant-note">Nota de auditoria</FieldLabel>
                <textarea
                  id="grant-note"
                  className="ui-input resize-y min-h-[88px] mt-1.5"
                  rows={3}
                  placeholder="Opcional — visível no histórico admin"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                />
              </div>
            </div>
          ) : grantModalStep === 'credentials' ? (
            <div className="space-y-4">
              <FieldLabel htmlFor="grant-password" hint="Mínimo 8 caracteres — não envia e-mail automaticamente.">
                Definir senha administrativa
              </FieldLabel>
              <input
                id="grant-password"
                className="ui-input mt-1.5"
                type="password"
                autoComplete="new-password"
                placeholder="Nova senha"
                value={grantPassword}
                onChange={(e) => setGrantPassword(e.target.value)}
              />
              <p className="text-[12px] rounded-lg px-3 py-2.5 border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-3)' }}>
                O link de reset usa o e-mail acima ou, se vazio, o da conta selecionada na lista.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                Add-on manual temporário (até 3 slots). Preencha prazo em dias e/ou meses.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <FieldLabel htmlFor="ch-slots">Slots</FieldLabel>
                  <input
                    id="ch-slots"
                    className="ui-input mt-1.5"
                    type="number"
                    min={1}
                    max={3}
                    value={channelGrantSlots}
                    onChange={(e) => setChannelGrantSlots(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="ch-days">Dias</FieldLabel>
                  <input
                    id="ch-days"
                    className="ui-input mt-1.5"
                    type="number"
                    min={0}
                    value={channelGrantDays}
                    onChange={(e) => setChannelGrantDays(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="ch-months">Meses</FieldLabel>
                  <input
                    id="ch-months"
                    className="ui-input mt-1.5"
                    type="number"
                    min={0}
                    value={channelGrantMonths}
                    onChange={(e) => setChannelGrantMonths(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] items-start">
        <Card className="overflow-hidden !p-0">
          <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <CardHeader
              title="Diretório de contas"
              subtitle={`${filteredUsers.length} de ${users.length} contas · filtros locais sobre a lista carregada`}
              icon={<Users className="w-4 h-4 text-sky-500" />}
              className="!mb-0"
            />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  className="ui-input pl-10"
                  placeholder="Buscar e-mail ou UID… ( / )"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void loadAccessUsers(search)}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={() => void loadAccessUsers(search)}>
                Buscar
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', 'Todos'],
                  ['manual', 'Manual'],
                  ['blocked', 'Bloq.'],
                  ['active', 'Ativos'],
                  ['trialing', 'Trial'],
                  ['expiring7', '≤7d']
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                    filter === id
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'border-[var(--border-subtle)] text-[var(--text-2)] hover:border-slate-500'
                  }`}
                >
                  {label} <span className="opacity-60 tabular-nums">{filterCounts[id]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[min(62vh,560px)] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {usersLoading ? (
              <div className="py-14 flex flex-col items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
                <Loader2 className="w-5 h-5 animate-spin" />
                Carregando contas…
              </div>
            ) : filteredUsers.length === 0 ? (
              <EmptyState
                icon={<Users className="w-7 h-7 text-sky-500/70" />}
                title="Nenhuma conta encontrada"
                description="Ajuste os filtros ou busque outro e-mail/UID. Use «Buscar» para consultar o servidor."
                className="!py-12"
              />
            ) : (
              filteredUsers.map((u) => (
                <DirectoryAccountRow
                  key={u.uid}
                  user={u}
                  selected={selectedUid === u.uid}
                  onSelect={() => selectUser(u)}
                />
              ))
            )}
          </div>
        </Card>

        <Card className="lg:sticky lg:top-3 overflow-hidden !p-0">
          {!selectedUser ? (
            <div className="p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center brand-soft">
                <BarChart3 className="w-7 h-7 text-sky-500/70" />
              </div>
              <p className="text-[13px] leading-relaxed max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
                Selecione uma conta à esquerda para ver <strong className="text-[var(--text-2)]">prazos, métricas de uso e ações</strong>{' '}
                de suporte.
              </p>
              {user ? (
                <Button variant="secondary" size="sm" onClick={() => void loadInsightsForUid(user.uid)}>
                  Ver métricas do meu login
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-white text-sm"
                    style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
                  >
                    {userInitial(selectedUser.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                      {selectedUser.email}
                    </p>
                    <button
                      type="button"
                      className="text-[10px] font-mono truncate mt-0.5 inline-flex items-center gap-1 opacity-70 hover:opacity-100"
                      style={{ color: 'var(--text-3)' }}
                      onClick={() => void copyToClipboard(selectedUser.uid, 'UID copiado.')}
                    >
                      {selectedUser.uid.slice(0, 12)}…
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <TabBar
                  items={DETAIL_TABS}
                  activeId={detailTab}
                  onChange={(id) => setDetailTab(id as DetailTab)}
                  ariaLabel="Detalhes da conta selecionada"
                  className="!px-0 !pb-0"
                />
              </div>

              <div className="p-4 max-h-[min(62vh,560px)] overflow-y-auto space-y-4">
                {detailTab === 'resumo' && (
                  <>
                    <div
                      className="rounded-xl border p-4 space-y-3"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                    >
                      <p className="ui-eyebrow">Linha do tempo</p>
                      <AccessTimeline user={selectedUser} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                      <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                        <span className="ui-eyebrow block mb-1">Plano</span>
                        <p className="font-semibold text-[14px]" style={{ color: 'var(--text-1)' }}>
                          {selectedUser.plan || '—'}
                        </p>
                      </div>
                      <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                        <span className="ui-eyebrow block mb-1">Provedor de login</span>
                        <p className="font-semibold text-[14px] capitalize" style={{ color: 'var(--text-1)' }}>
                          {selectedUser.provider}
                        </p>
                      </div>
                    </div>
                    {selectedUser.adminNote ? (
                      <p className="text-[11px] p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-200/90">
                        <Lightbulb className="w-3 h-3 inline mr-1" />
                        {selectedUser.adminNote}
                      </p>
                    ) : null}
                    <div
                      className="rounded-xl border p-4"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                    >
                      <p className="ui-eyebrow mb-3 flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5" /> Auditoria recente
                      </p>
                      {auditLoading ? (
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          Carregando…
                        </p>
                      ) : filteredAudit.length === 0 ? (
                        <EmptyState
                          title="Sem registros"
                          description="Ações admin nesta conta aparecerão aqui."
                          className="!py-6 !px-2"
                        />
                      ) : (
                        <ul className="space-y-2">
                          {filteredAudit.map((r) => (
                            <li key={r.id} className="text-[11px] border-l-2 border-cyan-500/40 pl-2.5 py-0.5">
                              <span className="text-cyan-400 font-medium">{r.action}</span>
                              <span className="text-slate-500"> · {toPtDateTime(r.createdAt)}</span>
                              {r.note ? <p className="italic text-slate-400 mt-0.5">“{r.note}”</p> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}

                {detailTab === 'metricas' && (
                  <>
                    {insightsLoading ? (
                      <div className="py-10 flex justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                      </div>
                    ) : !insights || insights.uid !== selectedUser.uid ? (
                      <EmptyState title="Métricas indisponíveis" description="Tente selecionar a conta novamente." className="!py-8" />
                    ) : (
                      <>
                        <div
                          className="rounded-xl border p-3"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                        >
                          <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--text-3)' }}>
                            Uso estimado no app
                          </p>
                          <p className="text-2xl font-extrabold tabular-nums">{formatAppUsageMs(insights.usage?.totalActiveMs ?? 0)}</p>
                          <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                            Última atividade: {toPtDateTime(insights.usage?.lastActiveAt)}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Metric label="Contatos" value={insights.counts.contactsTotal} />
                          <Metric label="Válidos" value={insights.counts.contactsValid} accent="#34d399" />
                          <Metric label="Campanhas" value={insights.counts.campaignsTotal} />
                          <Metric label="Conexões" value={insights.counts.connectionsTotal} accent="#38bdf8" />
                          <Metric label="Online" value={insights.counts.connectionsConnected} accent="#34d399" />
                          <Metric label="Listas" value={insights.counts.contactLists} />
                        </div>
                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                          <p className="text-[10px] uppercase font-bold mb-2" style={{ color: 'var(--text-3)' }}>
                            Entrega campanhas
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
                            <span>
                              Alvo <strong>{insights.campaignTotals.targeted}</strong>
                            </span>
                            <span className="text-emerald-400">
                              OK <strong>{insights.campaignTotals.success}</strong>
                            </span>
                            <span className="text-red-400">
                              Falhas <strong>{insights.campaignTotals.failed}</strong>
                            </span>
                            <span>
                              Proc. <strong>{insights.campaignTotals.processed}</strong>
                            </span>
                          </div>
                          {insights.campaignTotals.targeted > 0 && (
                            <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                                style={{
                                  width: `${Math.min(100, Math.round((100 * insights.campaignTotals.success) / Math.max(1, insights.campaignTotals.targeted)))}%`
                                }}
                              />
                            </div>
                          )}
                        </div>
                        {insights.recentCampaigns.length > 0 && (
                          <ul className="space-y-1.5">
                            {insights.recentCampaigns.map((c) => (
                              <li key={c.id} className="text-[11px] flex justify-between gap-2 border-b border-slate-800/50 pb-1">
                                <span className="truncate font-medium">{c.name}</span>
                                <span className="text-slate-500 shrink-0">{c.status}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </>
                )}

                {detailTab === 'acoes' && (
                  <div className="space-y-4">
                    <ActionSection title="Status da conta" description="Bloqueio impede login imediato; revogar manual remove liberação administrativa.">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={selectedUser.blocked ? 'secondary' : 'danger'}
                          size="sm"
                          leftIcon={selectedUser.blocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          onClick={() => void toggleBlock(selectedUser)}
                        >
                          {selectedUser.blocked ? 'Desbloquear' : 'Bloquear'}
                        </Button>
                        {selectedUser.manualGrant && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                              try {
                                const updated = await updateAccessUser({ uid: selectedUser.uid, manualGrant: false });
                                setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
                                toast.success('Manual revogado.');
                              } catch (e: unknown) {
                                toast.error(e instanceof Error ? e.message : 'Erro.');
                              }
                            }}
                          >
                            Revogar manual
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" leftIcon={<Copy className="w-3.5 h-3.5" />} onClick={() => void copyToClipboard(selectedUser.uid, 'UID copiado.')}>
                          Copiar UID
                        </Button>
                      </div>
                    </ActionSection>

                    <ActionSection title="Prazo de acesso manual" description="Estende a liberação administrativa a partir de hoje.">
                      <div className="grid grid-cols-3 gap-1.5">
                        {[7, 30, 90].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => void quickExtend(selectedUser, d)}
                            className="py-2 rounded-lg border border-emerald-500/30 text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/10 transition-colors"
                          >
                            +{d} dias
                          </button>
                        ))}
                      </div>
                    </ActionSection>

                    <ActionSection title="Senha e recuperação">
                      <FieldLabel htmlFor="selected-password">Nova senha (admin)</FieldLabel>
                      <input
                        id="selected-password"
                        className="ui-input"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Mínimo 8 caracteres"
                        value={selectedNewPassword}
                        onChange={(e) => setSelectedNewPassword(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          leftIcon={<KeyRound className="w-3.5 h-3.5" />}
                          onClick={async () => {
                            if (selectedNewPassword.trim().length < 8) {
                              toast.error('Senha deve ter ao menos 8 caracteres.');
                              return;
                            }
                            try {
                              await updateAccessUser({
                                uid: selectedUser.uid,
                                email: selectedUser.email,
                                newPassword: selectedNewPassword.trim(),
                                adminNote: 'Senha definida pelo admin (sem e-mail)'
                              });
                              toast.success('Senha definida.');
                              setSelectedNewPassword('');
                            } catch (e: unknown) {
                              toast.error(e instanceof Error ? e.message : 'Erro.');
                            }
                          }}
                        >
                          Definir senha
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<Mail className="w-3.5 h-3.5" />}
                          onClick={() => void copyResetLinkForEmail(selectedUser.email)}
                        >
                          Link de reset
                        </Button>
                      </div>
                    </ActionSection>

                    <ActionSection title="Canais do plano" description="Limite base incluído no plano (1–20).">
                      <div className="flex gap-2 items-end">
                        <div className="w-24">
                          <FieldLabel htmlFor="plan-channels">Qtd.</FieldLabel>
                          <input
                            id="plan-channels"
                            type="number"
                            min={1}
                            max={20}
                            className="ui-input mt-1"
                            value={includedChannelsGrant}
                            onChange={(e) => setIncludedChannelsGrant(e.target.value)}
                          />
                        </div>
                        <Button
                          variant="primary"
                          size="sm"
                          leftIcon={<Smartphone className="w-3.5 h-3.5" />}
                          onClick={async () => {
                            try {
                              const n = Math.max(1, Math.min(20, Math.floor(Number(includedChannelsGrant) || 5)));
                              const updated = await updateAccessUser({ uid: selectedUser.uid, includedChannels: n });
                              setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
                              toast.success(`${n} canal(is) aplicados.`);
                            } catch (e: unknown) {
                              toast.error(e instanceof Error ? e.message : 'Erro.');
                            }
                          }}
                        >
                          Aplicar
                        </Button>
                      </div>
                    </ActionSection>

                    <ActionSection title="Canais bônus" description="Slots extras manuais (0–18) e extensão rápida de add-on.">
                      <div className="flex gap-2 items-end flex-wrap">
                        <div className="w-24">
                          <FieldLabel htmlFor="extra-slots">Slots</FieldLabel>
                          <input
                            id="extra-slots"
                            type="number"
                            min={0}
                            max={18}
                            className="ui-input mt-1"
                            value={extraChannelSlots}
                            onChange={(e) => setExtraChannelSlots(e.target.value)}
                          />
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            try {
                              const slots = Math.max(0, Math.min(18, Math.floor(Number(extraChannelSlots) || 0)));
                              const updated = await updateAccessUser({ uid: selectedUser.uid, manualExtraChannelSlots: slots });
                              setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
                              toast.success(slots > 0 ? `+${slots} canais bônus aplicados.` : 'Canais bônus removidos.');
                            } catch (e: unknown) {
                              toast.error(e instanceof Error ? e.message : 'Erro.');
                            }
                          }}
                        >
                          Aplicar bônus
                        </Button>
                        {Number(selectedUser.manualExtraChannelSlots) > 0 ? (
                          <Button variant="danger" size="sm" onClick={() => void revokeExtraChannels(selectedUser)}>
                            Revogar extras
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => void quickExtendChannels(selectedUser, 1, 30)}
                          className="py-2 rounded-lg border border-sky-500/30 text-sky-400 text-[11px] font-bold hover:bg-sky-500/10"
                        >
                          +1 slot · 30d
                        </button>
                        <button
                          type="button"
                          onClick={() => void quickExtendChannels(selectedUser, 2, 0, 1)}
                          className="py-2 rounded-lg border border-sky-500/30 text-sky-400 text-[11px] font-bold hover:bg-sky-500/10"
                        >
                          +2 slots · 1m
                        </button>
                      </div>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        Total efetivo: até{' '}
                        {Math.min(20, (Number(selectedUser.includedChannels) || 2) + (Number(selectedUser.manualExtraChannelSlots) || 0))}{' '}
                        canais
                      </p>
                    </ActionSection>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="p-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <CardHeader
            title="Respostas rápidas"
            subtitle="Modelos prontos para WhatsApp ou e-mail — copie ou expanda o texto antes de enviar."
            icon={<MessageSquare className="w-4 h-4 text-emerald-500" />}
            className="!mb-0"
          />
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          {SUPPORT_SNIPPETS.map((s) => (
            <QuickReplyCard key={s.id} title={s.title} text={s.text} />
          ))}
        </div>
      </Card>
    </div>
  );
};
