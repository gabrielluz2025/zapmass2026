import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, Shield, Users, Lock, Unlock, Clock3, Search, RefreshCw, History, Sparkles,
  TrendingUp, KeyRound, Copy, BarChart3, Lightbulb
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppConfig } from '../../context/AppConfigContext';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, CardHeader, Badge, StatCard, SectionHeader, EmptyState } from '../ui';

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

const copyToClipboard = async (text: string, okMessage = 'Copiado para a área de transferência.') => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error('Não foi possível copiar.');
  }
};

const userInitial = (email: string): string => {
  const s = (email || '?').trim();
  return s ? s[0].toUpperCase() : '?';
};

const statusBadgeVariant = (status: string, blocked: boolean): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (blocked) return 'danger';
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'trialing') return 'info';
  return 'neutral';
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

  const filterCounts = useMemo(() => {
    const now = Date.now();
    const limit = now + 7 * 24 * 60 * 60 * 1000;
    const exp7 = users.filter((u) => {
      const check = [u.manualAccessEndsAt, u.accessEndsAt, u.trialEndsAt]
        .map((v) => (v ? new Date(v).getTime() : 0))
        .filter((ms) => ms > now && ms <= limit);
      return check.length > 0;
    }).length;
    return {
      all: users.length,
      manual: users.filter((u) => u.manualGrant).length,
      blocked: users.filter((u) => u.blocked).length,
      active: users.filter((u) => u.status === 'active' && !u.blocked).length,
      trialing: users.filter((u) => u.status === 'trialing' && !u.blocked).length,
      expiring7: exp7
    };
  }, [users]);

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
    <div className="max-w-5xl mx-auto px-2 sm:px-0 pb-10 space-y-8">
      <Card variant="premium" className="overflow-hidden !p-0 border border-slate-200/80 dark:border-slate-700/80 shadow-lg shadow-slate-900/5 dark:shadow-none">
        <div
          className="relative p-6 sm:p-8 bg-gradient-to-br from-[var(--surface-0)] via-[var(--surface-0)] to-emerald-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/40"
        >
          <div className="absolute right-0 top-0 w-64 h-64 bg-gradient-to-br from-emerald-400/10 to-transparent rounded-full blur-3xl pointer-events-none" />
          <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="flex gap-4 min-w-0">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ring-2 ring-emerald-500/20"
                style={{
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.1))',
                  boxShadow: '0 0 0 1px color-mix(in srgb, var(--brand-500) 30%, transparent)'
                }}
              >
                <Shield className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
                  Painel do criador
                </h2>
                <p className="text-sm mt-2 max-w-2xl leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Ajuste preços, duração do teste e textos exibidos aos clientes; na aba <strong className="text-[var(--text-2)]">Acesso</strong> você
                  libera planos, bloqueia abusos e acompanha métricas. Dados vivem no Firestore (
                  <code className="text-xs px-1 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80" style={{ color: 'var(--text-2)' }}>
                    appConfig/global
                  </code>
                  , assinaturas).
                </p>
              </div>
            </div>
            <div className="flex p-1 rounded-xl shrink-0 bg-slate-100/80 dark:bg-slate-800/60 ring-1 ring-slate-200/80 dark:ring-slate-700/80">
              <button
                type="button"
                onClick={() => setTab('config')}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all ${
                  tab === 'config'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm ring-1 ring-slate-200/90 dark:ring-slate-600'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Comercial
              </button>
              <button
                type="button"
                onClick={() => setTab('access')}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all ${
                  tab === 'access'
                    ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-sm ring-1 ring-slate-200/90 dark:ring-slate-600'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Acesso
              </button>
            </div>
          </div>
        </div>
      </Card>

      {tab === 'config' && (
        <div className="space-y-6">
          <SectionHeader
            title="Exibição comercial e trial"
            description="Estes textos e números alimentam modais, landing e API de teste. Publicação leva alguns segundos para replicar."
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Preços (marketing)"
                subtitle="O que o cliente lê no upgrade. Vazio cai no fallback do front."
                icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
              />
              <div className="mt-4 space-y-3">
                <div>
                  <label className="ui-eyebrow text-[10px]">Mensal (texto livre)</label>
                  <input
                    className="ui-input mt-1"
                    value={marketingPriceMonthly}
                    onChange={(e) => setMarketingPriceMonthly(e.target.value)}
                    placeholder="Ex.: R$ 49,90 / mês"
                  />
                </div>
                <div>
                  <label className="ui-eyebrow text-[10px]">Anual (texto livre)</label>
                  <input
                    className="ui-input mt-1"
                    value={marketingPriceAnnual}
                    onChange={(e) => setMarketingPriceAnnual(e.target.value)}
                    placeholder="Ex.: R$ 479,90 / ano"
                  />
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Janela de teste"
                subtitle="1–168 h. Aplicada em POST /api/billing/trial/start."
                icon={<Clock3 className="w-4 h-4 text-sky-600" />}
              />
              <div className="mt-4">
                <label className="ui-eyebrow text-[10px]">Duração (horas)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  className="ui-input mt-1 max-w-[200px]"
                  value={trialHours}
                  onChange={(e) => setTrialHours(e.target.value)}
                />
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader
              title="Landing — bloco de teste grátis"
              subtitle="Título e corpo opcionais na página inicial."
              icon={<Sparkles className="w-4 h-4 text-amber-600" />}
            />
            <div className="mt-4 space-y-3">
              <div>
                <label className="ui-eyebrow text-[10px]">Título</label>
                <input
                  className="ui-input mt-1"
                  value={landingTrialTitle}
                  onChange={(e) => setLandingTrialTitle(e.target.value)}
                  placeholder="Vazio = título automático a partir das horas"
                />
              </div>
              <div>
                <label className="ui-eyebrow text-[10px]">Texto</label>
                <textarea
                  rows={4}
                  className="ui-input mt-1 resize-y min-h-[100px]"
                  value={landingTrialBody}
                  onChange={(e) => setLandingTrialBody(e.target.value)}
                  placeholder="Vazio = texto padrão da landing"
                />
              </div>
            </div>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              type="button"
              disabled={saving}
              leftIcon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              onClick={() => void save()}
            >
              Salvar e publicar
            </Button>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Recomenda-se validar o modal Pro e a landing após publicar.
            </p>
          </div>
        </div>
      )}

      {tab === 'access' && (
        <div className="space-y-8">
          <SectionHeader
            title="Comando de acessos"
            description="KPIs em tempo quase real, busca, filtros com contagem, liberação manual e trilha de auditoria. No desktop o painel analítico acompanha a rolagem (fixo à direita)."
          />

          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Contas (não bloqueadas)"
              value={activeCount}
              icon={<Users className="w-4 h-4 text-emerald-600" />}
              helper="Inclui trial, manual e ativos"
              accent="default"
            />
            <StatCard
              label="Bloqueados"
              value={blockedCount}
              icon={<Lock className="w-4 h-4 text-red-500" />}
              helper="Não acessam o app"
              accent="danger"
            />
            <StatCard
              label="Liberação manual"
              value={manualCount}
              icon={<KeyRound className="w-4 h-4 text-sky-600" />}
              helper="Acesso concedido por você"
              accent="info"
            />
            <StatCard
              label="Expira em 7 dias"
              value={expiringSoonCount}
              icon={<Clock3 className="w-4 h-4 text-amber-600" />}
              helper="Trial, pago ou manual"
              accent="warning"
            />
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            {[
              {
                t: 'Bloqueio',
                d: 'Use para cortar acesso imediato (ex.: fraude, chargeback). O usuário vê tela de bloqueio no login.',
                i: <Lock className="w-4 h-4" />
              },
              {
                t: 'Extensão rápida',
                d: '+7d, +30d e +90d somam ao prazo de liberação manual (modo extensão) sem sobrescrever tudo.',
                i: <Clock3 className="w-4 h-4" />
              },
              {
                t: 'Perfil analítico',
                d: 'Clique no e-mail e veja contatos, campanhas, conexões e listas. Ideal para suporte e cobrança.',
                i: <BarChart3 className="w-4 h-4" />
              }
            ].map((tip) => (
              <div
                key={tip.t}
                className="flex gap-3 p-4 rounded-xl border text-left"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 brand-soft text-emerald-600">{tip.i}</div>
                <div>
                  <p className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>{tip.t}</p>
                  <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>{tip.d}</p>
                </div>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader
              title="Liberar acesso sem contratação"
              subtitle="Concede acesso pago (manualGrant) por e-mail, com prazo ou sem prazo (0 = indefinido, conforme regras do servidor)."
              icon={<KeyRound className="w-4 h-4 text-emerald-600" />}
            />
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <div>
                <label className="ui-eyebrow text-[10px]">E-mail do usuário</label>
                <input
                  className="ui-input mt-1"
                  placeholder="exemplo@email.com"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="ui-eyebrow text-[10px]">Dias (0 = ver servidor)</label>
                <input
                  type="number"
                  min={0}
                  className="ui-input mt-1"
                  placeholder="30"
                  value={grantDays}
                  onChange={(e) => setGrantDays(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="ui-eyebrow text-[10px]">Observação (auditoria)</label>
              <textarea
                rows={2}
                className="ui-input mt-1 resize-y"
                placeholder="Opcional: motivo, ticket interno, etc."
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
              />
            </div>
            <div className="mt-4">
              <Button variant="primary" size="sm" leftIcon={<Clock3 className="w-4 h-4" />} onClick={() => void handleGrantByEmail()}>
                Conceder liberação
              </Button>
            </div>
          </Card>

          <div className="lg:grid lg:grid-cols-[1fr_400px] gap-6 items-start">
            <div className="space-y-6 min-w-0">
              <div className="rounded-xl border p-4 sm:p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                      <Search className="w-4 h-4 text-emerald-500" />
                      Base de assinaturas
                    </h3>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {usersLoading ? 'Carregando…' : `Exibindo ${filteredUsers.length} de ${users.length} usuário(s) nesta busca.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void loadAccessUsers(search)}>
                      Buscar
                    </Button>
                    <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void loadAccessUsers(search)}>
                      Atualizar
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="ui-input pl-10"
                    placeholder="E-mail, parte do e-mail ou UID…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void loadAccessUsers(search)}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['all', 'Todos', 'all'] as const,
                      ['manual', 'Manual', 'manual'] as const,
                      ['blocked', 'Bloqueados', 'blocked'] as const,
                      ['active', 'Ativos', 'active'] as const,
                      ['trialing', 'Trial', 'trialing'] as const,
                      ['expiring7', '7 dias', 'expiring7'] as const
                    ] as const
                  ).map(([id, label, countKey]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id as AccessFilter)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
                        filter === id
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                          : 'bg-[var(--surface-1)] text-[var(--text-2)] border-[var(--border-subtle)] hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {label}
                      <span className="tabular-nums text-[10px] opacity-70">{filterCounts[countKey]}</span>
                    </button>
                  ))}
                </div>
                <div className="space-y-2 max-h-[min(56vh,520px)] overflow-y-auto pr-1 -mr-1">
                  {usersLoading ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--text-3)' }}>
                      <Loader2 className="w-4 h-4 animate-spin" /> Carregando usuários…
                    </div>
                  ) : users.length === 0 ? (
                    <EmptyState
                      icon={<Users className="w-7 h-7" />}
                      title="Nenhum registro"
                      description="Ajuste a busca ou importe/acesse com outro filtro. Administradores podem não aparecer nesta lista."
                    />
                  ) : filteredUsers.length === 0 ? (
                    <p className="text-center text-sm py-8" style={{ color: 'var(--text-3)' }}>
                      Nenhum usuário com este filtro. Tente <strong className="text-[var(--text-2)]">Todos</strong>.
                    </p>
                  ) : (
                    filteredUsers.map((u) => (
                      <div
                        key={u.uid}
                        className="group rounded-xl border p-3 sm:p-4 transition-shadow hover:shadow-md"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                      >
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-start sm:justify-between">
                          <div className="flex gap-3 min-w-0">
                            <div
                              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 text-sm font-bold text-white shadow-inner"
                              style={{
                                background: 'linear-gradient(135deg, #059669, #0d9488)',
                                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)'
                              }}
                            >
                              {userInitial(u.email || u.uid)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="text-[14px] font-semibold truncate text-left hover:underline"
                                  style={{ color: 'var(--text-1)' }}
                                  onClick={() => void openInsights(u)}
                                >
                                  {u.email || 'Sem e-mail'}
                                </button>
                                <Badge variant={statusBadgeVariant(u.status, u.blocked)} dot>
                                  {u.blocked ? 'Bloqueado' : u.status}
                                </Badge>
                                {u.manualGrant ? <Badge variant="info">Manual</Badge> : null}
                              </div>
                              <div className="flex items-center gap-1 mt-1">
                                <p className="text-[10px] font-mono truncate" style={{ color: 'var(--text-3)' }} title={u.uid}>
                                  {u.uid}
                                </p>
                                <button
                                  type="button"
                                  className="p-0.5 rounded hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                                  title="Copiar UID"
                                  onClick={() => void copyToClipboard(u.uid)}
                                >
                                  <Copy className="w-3 h-3 text-slate-400" />
                                </button>
                              </div>
                              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                                <span>Plano: <strong style={{ color: 'var(--text-2)' }}>{u.plan || '—'}</strong></span>
                                  <span>Provedor: <strong style={{ color: 'var(--text-2)' }}>{u.provider}</strong></span>
                                <span>Trial: <strong style={{ color: 'var(--text-2)' }}>{toPtDateTime(u.trialEndsAt)}</strong></span>
                                <span>Pago: <strong style={{ color: 'var(--text-2)' }}>{toPtDateTime(u.accessEndsAt)}</strong></span>
                                <span className="sm:col-span-2">Manual: <strong style={{ color: 'var(--text-2)' }}>{toPtDateTime(u.manualAccessEndsAt)}</strong></span>
                              </div>
                              {u.adminNote ? (
                                <p className="text-[11px] mt-2 p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/30 dark:border-amber-800/30" style={{ color: 'var(--text-2)' }}>
                                  <Lightbulb className="w-3 h-3 inline mr-1 text-amber-600" />
                                  {u.adminNote}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 sm:items-end shrink-0 w-full sm:w-auto">
                            <div className="flex flex-wrap gap-1.5 sm:justify-end">
                              <Button
                                variant={u.blocked ? 'secondary' : 'danger'}
                                size="sm"
                                leftIcon={u.blocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                                onClick={() => void toggleBlock(u)}
                              >
                                {u.blocked ? 'Desbloquear' : 'Bloquear'}
                              </Button>
                              {u.manualGrant && (
                                <Button variant="secondary" size="sm" onClick={() => void revokeManual(u)}>
                                  Revogar manual
                                </Button>
                              )}
                            </div>
                            <p className="text-[9px] uppercase font-bold text-slate-400 text-right w-full sm:w-auto">Extensão manual</p>
                            <div className="grid grid-cols-3 gap-1 w-full sm:w-[168px]">
                              {[7, 30, 90].map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => void quickExtend(u, d)}
                                  className="text-[10px] font-semibold px-1.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:border-emerald-300"
                                  title={`+${d} dias`}
                                >
                                  +{d}d
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border p-4 sm:p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-bold inline-flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                    <History className="w-4 h-4 text-violet-500" />
                    Trilha de auditoria
                  </h3>
                  <Button variant="secondary" size="sm" onClick={() => void loadAudit()}>
                    Atualizar
                  </Button>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Registro de bloqueios, liberações e ajustes feitos por administradores.
                </p>
                <div className="relative pl-2 space-y-0 max-h-[280px] overflow-y-auto pr-1">
                  <div className="absolute left-2 top-2 bottom-2 w-px bg-gradient-to-b from-violet-400/50 via-slate-300/40 to-transparent dark:from-violet-500/40" />
                  {auditLoading ? (
                    <p className="text-[12px] pl-4" style={{ color: 'var(--text-3)' }}>Carregando…</p>
                  ) : auditRows.length === 0 ? (
                    <p className="text-[12px] pl-4" style={{ color: 'var(--text-3)' }}>Nenhuma ação registrada ainda.</p>
                  ) : (
                    auditRows.map((r) => (
                      <div key={r.id} className="relative pl-6 pb-3 last:pb-0">
                        <div className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-violet-500 ring-2 ring-white dark:ring-slate-900" />
                        <p className="text-[12px] font-medium" style={{ color: 'var(--text-1)' }}>
                          <span className="text-violet-600 dark:text-violet-400">{r.action}</span>
                          {' · '}
                          <span>{r.targetEmail || r.targetUid}</span>
                        </p>
                        <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {r.adminEmail || r.adminUid} · {toPtDateTime(r.createdAt)}
                        </p>
                        {r.note ? <p className="text-[10.5px] mt-1 italic" style={{ color: 'var(--text-2)' }}>“{r.note}”</p> : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <aside className="space-y-4 lg:sticky lg:top-4 self-start w-full min-w-0">
              <div className="rounded-xl border p-4 sm:p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-bold inline-flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                    <BarChart3 className="w-4 h-4 text-sky-500" />
                    Perfil analítico
                  </h3>
                  {insights && (
                    <Button variant="ghost" size="sm" onClick={() => setInsights(null)}>
                      Limpar
                    </Button>
                  )}
                </div>
                {insightsLoading ? (
                  <div className="text-[12px] flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--text-3)' }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando…
                  </div>
                ) : !insights ? (
                  <div className="text-center py-6 px-2">
                    <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center brand-soft">
                      <BarChart3 className="w-6 h-6 text-sky-500 opacity-60" />
                    </div>
                    <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                      Selecione um <strong className="text-[var(--text-2)]">e-mail</strong> na lista para ver contatos, campanhas, conexões e listas.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                      <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>{insights.email || insights.uid}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                        <strong className="text-[var(--text-2)]">{insights.daysSinceFirstActivity}</strong> dia(s) desde a primeira atividade
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        Conta: {toPtDateTime(insights.accountCreatedAt)} · Login: {toPtDateTime(insights.lastSignInAt)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Metric label="Contatos" value={insights.counts.contactsTotal} />
                      <Metric label="Válidos" value={insights.counts.contactsValid} />
                      <Metric label="Listas" value={insights.counts.contactLists} />
                      <Metric label="Campanhas" value={insights.counts.campaignsTotal} />
                    </div>
                    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                      <p className="text-[10px] uppercase font-bold tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Entrega de campanhas</p>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <span style={{ color: 'var(--text-3)' }}>Alvo <strong className="text-[var(--text-1)]">{insights.campaignTotals.targeted}</strong></span>
                        <span style={{ color: 'var(--text-3)' }}>Sucesso <strong className="text-emerald-600">{insights.campaignTotals.success}</strong></span>
                        <span style={{ color: 'var(--text-3)' }}>Falhas <strong className="text-red-500">{insights.campaignTotals.failed}</strong></span>
                        <span style={{ color: 'var(--text-3)' }}>Processados <strong className="text-[var(--text-1)]">{insights.campaignTotals.processed}</strong></span>
                      </div>
                      {insights.campaignTotals.targeted > 0 && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                              style={{
                                width: `${Math.min(100, Math.round((100 * insights.campaignTotals.success) / Math.max(1, insights.campaignTotals.targeted)))}%`
                              }}
                            />
                          </div>
                          <p className="text-[10px] mt-1 text-slate-500">
                            ≈{Math.round((100 * insights.campaignTotals.success) / Math.max(1, insights.campaignTotals.targeted))}% do alvo com envio OK
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                        <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-3)' }}>Listas (top)</p>
                        {insights.listSegmentsTop.length === 0 ? (
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Nenhuma.</p>
                        ) : (
                          insights.listSegmentsTop.map((s) => (
                            <div key={s.listName} className="flex justify-between text-[11px] py-0.5" style={{ color: 'var(--text-2)' }}>
                              <span className="truncate pr-2">{s.listName}</span>
                              <span className="font-semibold text-emerald-600">{s.contacts}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                        <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-3)' }}>Tags (top)</p>
                        {insights.contactTagsTop.length === 0 ? (
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Nenhuma.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {insights.contactTagsTop.map((t) => (
                              <span key={t.tag} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800" style={{ color: 'var(--text-2)' }}>
                                {t.tag} <strong className="text-emerald-600">{t.count}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>Campanhas recentes</p>
                      {insights.recentCampaigns.length === 0 ? (
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Nenhuma.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {insights.recentCampaigns.map((c) => (
                            <li key={c.id} className="text-[11px] border-l-2 border-sky-400/50 pl-2" style={{ color: 'var(--text-2)' }}>
                              <span className="font-medium" style={{ color: 'var(--text-1)' }}>{c.name}</span>
                              <span className="text-slate-400"> · {c.status}</span>
                              <br />
                              <span className="text-[10px] text-slate-500">Alvo {c.totalContacts} · ✓{c.successCount} · ✗{c.failedCount}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </aside>
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
