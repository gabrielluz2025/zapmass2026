import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  KeyRound,
  LayoutList,
  Link2,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Unlock,
  Users
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../context/AuthContext';
import { Button, Card, CardHeader, Modal, SectionHeader, StatCard, TabBar } from '../../ui';
import { AccessAccountDetailPanel } from './AccessAccountDetailPanel';
import { apiUrl } from '../../../utils/apiBase';
import { apiFetchJson } from '../../../utils/apiFetchAuth';
import { DirectoryAccountList, sortAccessUsers, type DirectorySort } from './DirectoryAccountList';
import {
  type AccessAudit,
  type AccessFilter,
  type AccessUser,
  type AccessUserInsights,
  accessExpirySlices,
  userInitial
} from './adminAccessUtils';

type DetailTab = 'resumo' | 'metricas' | 'acoes';
type GrantModalStep = 'access' | 'credentials' | 'extras';

const ACCESS_SELECTED_UID_KEY = 'zapmass_admin_access_selected_uid';
const SESSION_TOAST_ID = 'admin-access-session';

const toastAccessError = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : fallback;
  const isSession = /sessão expirada/i.test(msg);
  toast.error(msg, { id: isSession ? SESSION_TOAST_ID : undefined });
};

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
  const { user, loading: authLoading } = useAuth();
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AccessFilter>('all');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('resumo');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantDays, setGrantDays] = useState('30');
  const [grantNote, setGrantNote] = useState('');
  const [grantBillingKind, setGrantBillingKind] = useState<'bonus' | 'paid_external'>('bonus');
  const [grantPlan, setGrantPlan] = useState<'monthly' | 'annual' | ''>('');
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
  const [directorySort, setDirectorySort] = useState<DirectorySort>('email');
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(
    async (forceRefresh = false) => {
      if (!user) throw new Error('Faça login.');
      const idToken = await user.getIdToken(forceRefresh);
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      };
    },
    [user]
  );

  const loadAccessUsers = useCallback(
    async (searchTerm = '') => {
      if (!user) return;
      setUsersLoading(true);
      setUsersLoadError(null);
      try {
        const qs = searchTerm.trim() ? `?search=${encodeURIComponent(searchTerm.trim())}` : '';
        const data = await apiFetchJson<{ ok: boolean; users?: AccessUser[]; error?: string }>(
          `/api/admin/access-users${qs}`
        );
        if (!data?.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao listar usuários.');
        }
        setUsers(Array.isArray(data.users) ? data.users : []);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Não foi possível carregar acessos.';
        setUsersLoadError(msg);
        toastAccessError(e, msg);
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
      const data = await apiFetchJson<{ ok: boolean; audit?: AccessAudit[]; error?: string }>(
        '/api/admin/access-audit?limit=80'
      );
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar auditoria.');
      }
      setAuditRows(Array.isArray(data.audit) ? data.audit : []);
    } catch (e: unknown) {
      toastAccessError(e, e instanceof Error ? e.message : 'Auditoria indisponível.');
    } finally {
      setAuditLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadAccessUsers('');
    void loadAudit();
  }, [authLoading, user, loadAccessUsers, loadAudit]);

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
      manualGrantKind?: 'bonus' | 'paid_external';
      plan?: 'monthly' | 'annual' | null;
    }
  ) => {
    const data = await apiFetchJson<{ ok: boolean; user?: AccessUser; error?: string }>('/api/admin/access-user', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (!data?.ok || !data.user) {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao atualizar acesso.');
    }
    return data.user;
  };

  const loadInsightsForUid = async (uid: string) => {
    if (!user) return;
    setInsightsLoading(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; insights?: AccessUserInsights; error?: string }>(
        `/api/admin/access-user-insights?uid=${encodeURIComponent(uid)}`
      );
      if (!data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar perfil.');
      }
      setInsights(data.insights as AccessUserInsights);
    } catch (e: unknown) {
      toastAccessError(e, e instanceof Error ? e.message : 'Perfil indisponível.');
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
    setInsights(null);
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

  const sortedFilteredUsers = useMemo(
    () => sortAccessUsers(filteredUsers, directorySort),
    [filteredUsers, directorySort]
  );

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
        adminNote: grantNote.trim(),
        manualGrantKind: grantBillingKind,
        plan: grantBillingKind === 'paid_external' && grantPlan ? grantPlan : null
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
              <div>
                <FieldLabel htmlFor="grant-billing-kind">Tipo de liberação</FieldLabel>
                <select
                  id="grant-billing-kind"
                  className="ui-input mt-1.5"
                  value={grantBillingKind}
                  onChange={(e) => setGrantBillingKind(e.target.value === 'paid_external' ? 'paid_external' : 'bonus')}
                >
                  <option value="bonus">Cortesia / bônus (não entra no MRR pago)</option>
                  <option value="paid_external">Cobrado fora do MP (PIX, transferência…)</option>
                </select>
              </div>
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
              {grantBillingKind === 'paid_external' ? (
                <div>
                  <FieldLabel htmlFor="grant-plan" hint="Usado na estimativa de MRR manual cobrado no painel Ganhos.">
                    Plano comercial
                  </FieldLabel>
                  <select
                    id="grant-plan"
                    className="ui-input mt-1.5"
                    value={grantPlan}
                    onChange={(e) => {
                      const v = e.target.value;
                      setGrantPlan(v === 'monthly' || v === 'annual' ? v : '');
                    }}
                  >
                    <option value="">Sem plano definido</option>
                    <option value="monthly">Mensal</option>
                    <option value="annual">Anual</option>
                  </select>
                </div>
              ) : null}
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
        <DirectoryAccountList
          usersTotal={users.length}
          filteredUsers={sortedFilteredUsers}
          filterCounts={filterCounts}
          filter={filter}
          onFilterChange={setFilter}
          sort={directorySort}
          onSortChange={setDirectorySort}
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={() => void loadAccessUsers(search)}
          searchInputRef={searchInputRef}
          usersLoading={usersLoading}
          loadError={usersLoadError}
          onRetryLoad={() => {
            void loadAccessUsers(search);
            void loadAudit();
          }}
          selectedUid={selectedUid}
          onSelectUser={selectUser}
        />

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

              <div className="p-4 max-h-[min(62vh,560px)] overflow-y-auto">
                <AccessAccountDetailPanel
                  user={selectedUser}
                  detailTab={detailTab}
                  insights={insights}
                  insightsLoading={insightsLoading}
                  auditLoading={auditLoading}
                  auditRows={filteredAudit}
                  acoesContent={
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
                  }
                />
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
