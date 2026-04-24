import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Shield, Users, Lock, Unlock, Clock3, Search, RefreshCw, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppConfig } from '../../context/AppConfigContext';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui';

type AdminTab = 'config' | 'access';
type AccessUser = {
  uid: string;
  email: string;
  status: string;
  provider: string;
  plan: string | null;
  blocked: boolean;
  manualGrant: boolean;
  trialEndsAt: string | null;
  accessEndsAt: string | null;
  manualAccessEndsAt: string | null;
  adminNote: string;
  updatedAt: string | null;
};
type AccessAudit = {
  id: string;
  targetUid: string;
  targetEmail: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  note: string;
  createdAt: string | null;
};
type AccessFilter = 'all' | 'manual' | 'blocked' | 'active' | 'trialing' | 'expiring7';
type AccessUserInsights = {
  uid: string;
  email: string;
  accountCreatedAt: string | null;
  lastSignInAt: string | null;
  firstActivityAt: string | null;
  daysSinceFirstActivity: number;
  counts: {
    contactsTotal: number;
    contactsValid: number;
    contactsInvalid: number;
    contactLists: number;
    connectionsTotal: number;
    connectionsConnected: number;
    campaignsTotal: number;
    campaignsRunning: number;
    campaignsCompleted: number;
  };
  campaignTotals: {
    targeted: number;
    processed: number;
    success: number;
    failed: number;
  };
  contactTagsTop: Array<{ tag: string; count: number }>;
  listSegmentsTop: Array<{ listName: string; contacts: number }>;
  recentCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string | null;
    successCount: number;
    failedCount: number;
    totalContacts: number;
  }>;
};

const toPtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

export const AdminPanel: React.FC = () => {
  const { user } = useAuth();
  const { config, reload } = useAppConfig();
  const [tab, setTab] = useState<AdminTab>('config');
  const [saving, setSaving] = useState(false);
  const [marketingPriceMonthly, setMarketingPriceMonthly] = useState('');
  const [marketingPriceAnnual, setMarketingPriceAnnual] = useState('');
  const [trialHours, setTrialHours] = useState('1');
  const [landingTrialTitle, setLandingTrialTitle] = useState('');
  const [landingTrialBody, setLandingTrialBody] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [search, setSearch] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantDays, setGrantDays] = useState('30');
  const [grantNote, setGrantNote] = useState('');
  const [filter, setFilter] = useState<AccessFilter>('all');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRows, setAuditRows] = useState<AccessAudit[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState<AccessUserInsights | null>(null);

  useEffect(() => {
    setMarketingPriceMonthly(config.marketingPriceMonthly);
    setMarketingPriceAnnual(config.marketingPriceAnnual);
    setTrialHours(String(config.trialHours));
    setLandingTrialTitle(config.landingTrialTitle);
    setLandingTrialBody(config.landingTrialBody);
  }, [config]);

  const save = async () => {
    if (!user) return;
    const th = Math.max(1, Math.min(168, Math.round(Number(trialHours)) || 1));
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/app-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          marketingPriceMonthly,
          marketingPriceAnnual,
          trialHours: th,
          landingTrialTitle,
          landingTrialBody
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Falha ao salvar.');
        return;
      }
      toast.success('Configuracao publicada. Clientes passam a ver na proxima leitura (ate ~15s no servidor).');
      await reload();
    } catch (e) {
      console.error(e);
      toast.error('Erro de rede.');
    } finally {
      setSaving(false);
    }
  };

  const authHeaders = async () => {
    if (!user) throw new Error('Faça login.');
    const idToken = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    };
  };

  const loadAccessUsers = async (searchTerm: string = '') => {
    if (!user) return;
    setUsersLoading(true);
    try {
      const idToken = await user.getIdToken();
      const qs = searchTerm.trim() ? `?search=${encodeURIComponent(searchTerm.trim())}` : '';
      const res = await fetch(`/api/admin/access-users${qs}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao listar usuários.');
      }
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível carregar acessos.');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'access') return;
    void loadAccessUsers(search);
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const activeCount = useMemo(() => users.filter((u) => !u.blocked).length, [users]);
  const blockedCount = useMemo(() => users.filter((u) => u.blocked).length, [users]);
  const manualCount = useMemo(() => users.filter((u) => u.manualGrant).length, [users]);
  const expiringSoonCount = useMemo(() => {
    const now = Date.now();
    const limit = now + 7 * 24 * 60 * 60 * 1000;
    return users.filter((u) => {
      const candidates = [u.manualAccessEndsAt, u.accessEndsAt, u.trialEndsAt]
        .map((v) => (v ? new Date(v).getTime() : 0))
        .filter((ms) => ms > now && ms <= limit);
      return candidates.length > 0;
    }).length;
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (filter === 'all') return users;
    const now = Date.now();
    const limit = now + 7 * 24 * 60 * 60 * 1000;
    return users.filter((u) => {
      if (filter === 'manual') return u.manualGrant;
      if (filter === 'blocked') return u.blocked;
      if (filter === 'active') return u.status === 'active' && !u.blocked;
      if (filter === 'trialing') return u.status === 'trialing' && !u.blocked;
      if (filter === 'expiring7') {
        const check = [u.manualAccessEndsAt, u.accessEndsAt, u.trialEndsAt]
          .map((v) => (v ? new Date(v).getTime() : 0))
          .filter((ms) => ms > now && ms <= limit);
        return check.length > 0;
      }
      return true;
    });
  }, [users, filter]);

  const updateAccessUser = async (
    payload: Partial<AccessUser> & { uid?: string; email?: string; manualGrant?: boolean; grantDays?: number | null; grantMode?: 'set' | 'extend' }
  ) => {
    const res = await fetch('/api/admin/access-user', {
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

  const loadAudit = async () => {
    if (!user) return;
    setAuditLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/access-audit?limit=80', {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar auditoria.');
      }
      setAuditRows(Array.isArray(data.audit) ? data.audit : []);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível carregar auditoria.');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleGrantByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuário.');
      return;
    }
    const days = Math.max(0, Math.round(Number(grantDays) || 0));
    try {
      const updated = await updateAccessUser({
        email: grantEmail.trim(),
        manualGrant: true,
        grantDays: days > 0 ? days : null,
        adminNote: grantNote.trim()
      });
      setUsers((prev) => [updated, ...prev.filter((u) => u.uid !== updated.uid)]);
      toast.success('Acesso liberado com sucesso.');
      setGrantEmail('');
      setGrantNote('');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível liberar acesso.');
    }
  };

  const toggleBlock = async (u: AccessUser) => {
    try {
      const updated = await updateAccessUser({
        uid: u.uid,
        blocked: !u.blocked
      });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      toast.success(updated.blocked ? 'Usuário bloqueado.' : 'Usuário desbloqueado.');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível atualizar bloqueio.');
    }
  };

  const revokeManual = async (u: AccessUser) => {
    try {
      const updated = await updateAccessUser({
        uid: u.uid,
        manualGrant: false
      });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      toast.success('Liberação manual revogada.');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível revogar liberação.');
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
      toast.success(`Acesso estendido por +${days} dia(s).`);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível estender acesso.');
    }
  };

  const openInsights = async (u: AccessUser) => {
    if (!user) return;
    setInsightsLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/access-user-insights?uid=${encodeURIComponent(u.uid)}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar perfil do usuário.');
      }
      setInsights(data.insights as AccessUserInsights);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível abrir o perfil analítico.');
    } finally {
      setInsightsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-1">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.15))',
            border: '1px solid rgba(16,185,129,0.35)'
          }}
        >
          <Shield className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
            Painel do criador
          </h2>
          <p className="text-[13px] leading-relaxed mt-1" style={{ color: 'var(--text-3)' }}>
            Estes valores ficam em <code className="text-[12px]">appConfig/global</code> no Firestore. Precos abaixo
            alimentam o modal Pro quando preenchidos; vazio usa o fallback do front (Vite). A duracao do teste gratuito
            (horas) e aplicada pelo servidor em <code className="text-[12px]">POST /api/billing/trial/start</code>.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('config')}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold"
          style={{
            background: tab === 'config' ? 'var(--brand-50)' : 'var(--surface-1)',
            color: tab === 'config' ? 'var(--brand-700)' : 'var(--text-2)',
            border: tab === 'config' ? '1px solid color-mix(in srgb, var(--brand-500) 35%, transparent)' : '1px solid var(--border-subtle)'
          }}
        >
          Configuração comercial
        </button>
        <button
          type="button"
          onClick={() => setTab('access')}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5"
          style={{
            background: tab === 'access' ? 'rgba(14,165,233,0.14)' : 'var(--surface-1)',
            color: tab === 'access' ? '#0369a1' : 'var(--text-2)',
            border: tab === 'access' ? '1px solid rgba(14,165,233,0.35)' : '1px solid var(--border-subtle)'
          }}
        >
          <Users className="w-3.5 h-3.5" />
          Controle de acesso
        </button>
      </div>

      {tab === 'config' && (
        <div
          className="rounded-xl border p-5 space-y-4"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
        >
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Preco mensal (texto exibido)
          </label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={marketingPriceMonthly}
            onChange={(e) => setMarketingPriceMonthly(e.target.value)}
            placeholder="Ex.: R$ 49,90 / mes"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Preco anual (texto exibido)
          </label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={marketingPriceAnnual}
            onChange={(e) => setMarketingPriceAnnual(e.target.value)}
            placeholder="Ex.: R$ 479,90 / ano"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Duracao do teste (horas, 1 a 168)
          </label>
          <input
            type="number"
            min={1}
            max={168}
            className="w-full max-w-[200px] rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={trialHours}
            onChange={(e) => setTrialHours(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Titulo do bloco de teste na landing (opcional)
          </label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={landingTrialTitle}
            onChange={(e) => setLandingTrialTitle(e.target.value)}
            placeholder="Vazio = montar automaticamente a partir das horas"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
            Texto do bloco de teste na landing (opcional)
          </label>
          <textarea
            rows={4}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500/30 resize-y min-h-[100px]"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
            value={landingTrialBody}
            onChange={(e) => setLandingTrialBody(e.target.value)}
            placeholder="Vazio = texto padrao da landing (menciona a duracao configurada)"
          />
        </div>

        <Button variant="primary" type="button" disabled={saving} leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} onClick={() => void save()}>
          Salvar e publicar
        </Button>
        </div>
      )}

      {tab === 'access' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
              <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>Ativos</p>
              <p className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{activeCount}</p>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
              <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>Bloqueados</p>
              <p className="text-xl font-bold text-red-500">{blockedCount}</p>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
              <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>Liberação manual</p>
              <p className="text-xl font-bold text-sky-500">{manualCount}</p>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
              <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>Expiram em 7 dias</p>
              <p className="text-xl font-bold text-amber-500">{expiringSoonCount}</p>
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
            <h3 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>Liberar acesso sem contratação</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
                placeholder="E-mail do usuário"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
              />
              <input
                type="number"
                min={0}
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
                placeholder="Período em dias (0 = sem prazo)"
                value={grantDays}
                onChange={(e) => setGrantDays(e.target.value)}
              />
            </div>
            <textarea
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none resize-y"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
              placeholder="Observação administrativa (opcional)"
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
            />
            <Button variant="primary" size="sm" leftIcon={<Clock3 className="w-4 h-4" />} onClick={() => void handleGrantByEmail()}>
              Conceder liberação
            </Button>
          </div>

          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
            <div className="flex flex-wrap gap-2">
              <div className="flex-1 min-w-[220px] relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                <input
                  className="w-full rounded-lg border pl-9 pr-3 py-2 text-[13px] outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
                  placeholder="Buscar por e-mail ou uid"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={() => void loadAccessUsers(search)}>
                Buscar
              </Button>
              <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void loadAccessUsers(search)}>
                Atualizar
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['all', 'Todos'],
                ['manual', 'Manual'],
                ['blocked', 'Bloqueados'],
                ['active', 'Ativos'],
                ['trialing', 'Trial'],
                ['expiring7', 'Expiram em 7 dias']
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id as AccessFilter)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-semibold"
                  style={{
                    background: filter === id ? 'var(--brand-50)' : 'var(--surface-1)',
                    color: filter === id ? 'var(--brand-700)' : 'var(--text-2)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {usersLoading ? (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando usuários...
                </div>
              ) : users.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Nenhum usuário encontrado.</p>
              ) : (
                filteredUsers.map((u) => (
                  <div
                    key={u.uid}
                    className="rounded-xl border p-3"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="text-[13px] font-semibold truncate text-left underline-offset-2 hover:underline"
                          style={{ color: 'var(--text-1)' }}
                          onClick={() => void openInsights(u)}
                          title="Abrir perfil analítico do usuário"
                        >
                          {u.email || u.uid}
                        </button>
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>{u.uid}</p>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                          Status: <strong>{u.status}</strong> • Plano: <strong>{u.plan || '—'}</strong> • Provedor: <strong>{u.provider}</strong>
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          Trial até: <strong>{toPtDateTime(u.trialEndsAt)}</strong> • Pago até: <strong>{toPtDateTime(u.accessEndsAt)}</strong>
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          Manual até: <strong>{toPtDateTime(u.manualAccessEndsAt)}</strong>
                        </p>
                        {u.adminNote ? (
                          <p className="text-[11px] mt-1" style={{ color: 'var(--text-2)' }}>
                            Obs: {u.adminNote}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Button
                          variant={u.blocked ? 'secondary' : 'danger'}
                          size="sm"
                          leftIcon={u.blocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          onClick={() => void toggleBlock(u)}
                        >
                          {u.blocked ? 'Desbloquear' : 'Bloquear'}
                        </Button>
                        {u.manualGrant && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void revokeManual(u)}
                          >
                            Revogar manual
                          </Button>
                        )}
                        <div className="grid grid-cols-3 gap-1">
                          <button
                            type="button"
                            onClick={() => void quickExtend(u, 7)}
                            className="text-[10px] px-1.5 py-1 rounded border"
                            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-2)' }}
                            title="Estender +7 dias"
                          >
                            +7d
                          </button>
                          <button
                            type="button"
                            onClick={() => void quickExtend(u, 30)}
                            className="text-[10px] px-1.5 py-1 rounded border"
                            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-2)' }}
                            title="Estender +30 dias"
                          >
                            +30d
                          </button>
                          <button
                            type="button"
                            onClick={() => void quickExtend(u, 90)}
                            className="text-[10px] px-1.5 py-1 rounded border"
                            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-2)' }}
                            title="Estender +90 dias"
                          >
                            +90d
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-bold inline-flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                <History className="w-4 h-4" />
                Histórico de ações do admin
              </h3>
              <Button variant="secondary" size="sm" onClick={() => void loadAudit()}>
                Atualizar histórico
              </Button>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {auditLoading ? (
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Carregando histórico...</p>
              ) : auditRows.length === 0 ? (
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Sem ações registradas ainda.</p>
              ) : (
                auditRows.map((r) => (
                  <div key={r.id} className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                    <p className="text-[11.5px]" style={{ color: 'var(--text-1)' }}>
                      <strong>{r.action}</strong> em <strong>{r.targetEmail || r.targetUid}</strong>
                    </p>
                    <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                      por {r.adminEmail || r.adminUid} • {toPtDateTime(r.createdAt)}
                    </p>
                    {r.note ? <p className="text-[10.5px]" style={{ color: 'var(--text-2)' }}>Obs: {r.note}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
            <h3 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
              Perfil analítico do usuário
            </h3>
            {insightsLoading ? (
              <div className="text-[12px] inline-flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando métricas do usuário...
              </div>
            ) : !insights ? (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                Clique no nome de um usuário para ver tempo de uso, disparos, conexões, contatos e segmentos.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                    {insights.email || insights.uid}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Tempo de uso: <strong>{insights.daysSinceFirstActivity} dia(s)</strong> desde a primeira atividade.
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Conta criada: <strong>{toPtDateTime(insights.accountCreatedAt)}</strong> • Último login: <strong>{toPtDateTime(insights.lastSignInAt)}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Metric label="Contatos" value={insights.counts.contactsTotal} />
                  <Metric label="Válidos" value={insights.counts.contactsValid} />
                  <Metric label="Inválidos" value={insights.counts.contactsInvalid} />
                  <Metric label="Listas" value={insights.counts.contactLists} />
                  <Metric label="Conexões" value={insights.counts.connectionsTotal} />
                  <Metric label="Online" value={insights.counts.connectionsConnected} />
                  <Metric label="Campanhas" value={insights.counts.campaignsTotal} />
                  <Metric label="Concluídas" value={insights.counts.campaignsCompleted} />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Metric label="Alvo total" value={insights.campaignTotals.targeted} />
                  <Metric label="Processados" value={insights.campaignTotals.processed} />
                  <Metric label="Sucesso" value={insights.campaignTotals.success} />
                  <Metric label="Falhas" value={insights.campaignTotals.failed} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>Segmentos (listas) principais</p>
                    {insights.listSegmentsTop.length === 0 ? (
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Sem listas.</p>
                    ) : insights.listSegmentsTop.map((s) => (
                      <p key={s.listName} className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {s.listName}: <strong>{s.contacts}</strong>
                      </p>
                    ))}
                  </div>
                  <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>Tags mais usadas</p>
                    {insights.contactTagsTop.length === 0 ? (
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Sem tags.</p>
                    ) : insights.contactTagsTop.map((t) => (
                      <p key={t.tag} className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {t.tag}: <strong>{t.count}</strong>
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-2)' }}>Campanhas recentes</p>
                  {insights.recentCampaigns.length === 0 ? (
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Sem campanhas recentes.</p>
                  ) : insights.recentCampaigns.map((c) => (
                    <p key={c.id} className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      {c.name} • {c.status} • alvo {c.totalContacts} • sucesso {c.successCount} • falhas {c.failedCount}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
    <p className="text-[10px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </p>
    <p className="text-[18px] font-extrabold leading-tight" style={{ color: 'var(--text-1)' }}>
      {value}
    </p>
  </div>
);
