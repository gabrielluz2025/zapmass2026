import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Clock3,
  Copy,
  History,
  KeyRound,
  LayoutList,
  Lightbulb,
  Link2,
  Loader2,
  Lock,
  Mail,
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
import { Badge, Button, Card, CardHeader, EmptyState, SectionHeader, StatCard, TabBar } from '../../ui';
import { apiUrl } from '../../../utils/apiBase';
import {
  type AccessAudit,
  type AccessFilter,
  type AccessUser,
  type AccessUserInsights,
  accessExpirySlices,
  accessHealthStyles,
  computeAccessHealth,
  formatAppUsageMs,
  statusBadgeVariant,
  toPtDateTime,
  userInitial
} from './adminAccessUtils';

type DetailTab = 'resumo' | 'metricas' | 'acoes';

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
    <label htmlFor={htmlFor} className="ui-eyebrow text-[10px] block">
      {children}
    </label>
    {hint ? (
      <p className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
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
    className="rounded-xl border p-3.5 space-y-3"
    style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
  >
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
        {title}
      </p>
      {description ? (
        <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {description}
        </p>
      ) : null}
    </div>
    {children}
  </div>
);

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
    setDetailTab('resumo');
    setSelectedNewPassword('');
    setExtraChannelSlots(String(u.manualExtraChannelSlots ?? 0));
    void loadInsightsForUid(u.uid);
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

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <SectionHeader
        title="Centro de acessos"
        description="Gerencie contas, prazos, credenciais e canais. Selecione um usuário na lista para ver detalhes e aplicar ações."
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="Contas ativas"
          value={users.filter((u) => !u.blocked).length}
          icon={<Users className="w-4 h-4 text-emerald-600" />}
          accent="default"
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Liberação por e-mail"
            subtitle="Concede acesso manual, canais do plano e nota de auditoria."
            icon={<KeyRound className="w-4 h-4 text-emerald-500" />}
          />
          <div className="mt-4 space-y-3">
            <FieldLabel htmlFor="grant-email" hint="Conta existente ou nova — o backend cria/atualiza conforme o e-mail.">
              E-mail do cliente
            </FieldLabel>
            <input
              id="grant-email"
              className="ui-input"
              placeholder="cliente@empresa.com"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="grant-days">Dias de acesso</FieldLabel>
                <input
                  id="grant-days"
                  className="ui-input mt-1"
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
                  className="ui-input mt-1"
                  type="number"
                  min={1}
                  max={5}
                  value={includedChannelsGrant}
                  onChange={(e) => setIncludedChannelsGrant(e.target.value)}
                />
              </div>
            </div>
            <FieldLabel htmlFor="grant-note">Nota de auditoria</FieldLabel>
            <textarea
              id="grant-note"
              className="ui-input resize-y min-h-[72px]"
              rows={2}
              placeholder="Opcional — visível no histórico admin"
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
            />
            <Button variant="primary" size="sm" loading={accessActionBusy} onClick={() => void handleGrantByEmail()}>
              Conceder acesso
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Credenciais e canais extras"
            subtitle="Senha administrativa, link de recuperação e slots temporários."
            icon={<Shield className="w-4 h-4 text-sky-500" />}
          />
          <div className="mt-4 space-y-3">
            <FieldLabel htmlFor="grant-password" hint="Mínimo 8 caracteres — não envia e-mail automaticamente.">
              Definir senha
            </FieldLabel>
            <input
              id="grant-password"
              className="ui-input"
              type="password"
              autoComplete="new-password"
              placeholder="Nova senha"
              value={grantPassword}
              onChange={(e) => setGrantPassword(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
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
                variant="secondary"
                size="sm"
                loading={accessActionBusy}
                leftIcon={<Link2 className="w-3.5 h-3.5" />}
                onClick={() => void copyResetLinkForEmail(grantEmailForOps())}
              >
                Copiar link de reset
              </Button>
            </div>
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>
                Canais extras (add-on manual)
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <FieldLabel htmlFor="ch-slots">Slots</FieldLabel>
                  <input
                    id="ch-slots"
                    className="ui-input mt-1"
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
                    className="ui-input mt-1"
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
                    className="ui-input mt-1"
                    type="number"
                    min={0}
                    value={channelGrantMonths}
                    onChange={(e) => setChannelGrantMonths(e.target.value)}
                  />
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                loading={accessActionBusy}
                leftIcon={<Smartphone className="w-3.5 h-3.5" />}
                onClick={() => void handleGrantChannelsByEmail()}
              >
                Liberar canais extras
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
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
          Atualizar lista e auditoria
        </Button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] gap-5 items-start">
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
                  className="ui-input pl-10"
                  placeholder="Buscar e-mail ou UID…"
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
              filteredUsers.map((u) => {
                const h = computeAccessHealth(u);
                const styles = accessHealthStyles[h.health];
                const selected = selectedUid === u.uid;
                return (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => selectUser(u)}
                    className={`w-full text-left p-3 sm:p-4 transition-all hover:bg-[var(--surface-1)] ${selected ? `ring-2 ring-inset ${styles.ring} bg-[var(--surface-1)]` : ''}`}
                  >
                    <div className="flex gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-white"
                        style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
                      >
                        {userInitial(u.email)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                            {u.email || 'Sem e-mail'}
                          </span>
                          <Badge variant={statusBadgeVariant(u.status, u.blocked)} dot>
                            {u.blocked ? 'Bloq.' : u.status}
                          </Badge>
                          {u.manualGrant ? <Badge variant="info">Manual</Badge> : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${styles.bg} ${styles.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
                            {h.nextLabel}
                            {h.daysRemaining != null ? ` · ${h.daysRemaining}d` : ''}
                          </span>
                          <span className="text-slate-500 tabular-nums">
                            {Math.max(0, Math.min(5, Math.floor(Number(u.includedChannels) || 0))) || '—'} canais
                            {Number(u.manualExtraChannelSlots) > 0 ? ` +${u.manualExtraChannelSlots}` : ''}
                          </span>
                          <span className="text-slate-600 capitalize">{u.provider}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
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
                    <div>
                      <p className="text-[10px] uppercase font-bold mb-2" style={{ color: 'var(--text-3)' }}>
                        Linha do tempo de acesso
                      </p>
                      <AccessTimeline user={selectedUser} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                        <span className="text-slate-500 block text-[10px]">Plano</span>
                        <p className="font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>
                          {selectedUser.plan || '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                        <span className="text-slate-500 block text-[10px]">Provedor de login</span>
                        <p className="font-semibold mt-0.5 capitalize" style={{ color: 'var(--text-1)' }}>
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
                    <div>
                      <p className="text-[10px] uppercase font-bold mb-2 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
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

      <Card>
        <CardHeader title="Respostas rápidas" subtitle="Copie para WhatsApp ou e-mail de suporte." icon={<Copy className="w-4 h-4" />} />
        <div className="mt-3 grid sm:grid-cols-2 gap-2">
          {SUPPORT_SNIPPETS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void copyToClipboard(s.text, `"${s.title}" copiado.`)}
              className="text-left p-3 rounded-xl border hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                {s.title}
              </p>
              <p className="text-[10px] mt-1 line-clamp-2" style={{ color: 'var(--text-3)' }}>
                {s.text}
              </p>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
};
