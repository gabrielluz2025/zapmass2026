import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, Shield, Users, Lock, Unlock, Clock3, Search, RefreshCw, History, Sparkles,
  TrendingUp, KeyRound, Copy, BarChart3, Lightbulb, Send, Mail, MessageCircle, CheckCircle2, XCircle, Megaphone,
  CircleDollarSign, Smartphone
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppConfig } from '../../context/AppConfigContext';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, CardHeader, Badge, StatCard, SectionHeader, EmptyState, Modal, Textarea, CompactPageHeader, TabBar } from '../ui';
import { AdminAnnouncementsTab } from './AdminAnnouncementsTab';
import { AdminAccessTab } from './access/AdminAccessTab';
import {
  LANDING_TRIAL_BODY_MAX_CHARS,
  LANDING_TRIAL_TITLE_MAX_CHARS
} from '../../constants/landingTrialLimits';
import { resolveLandingTrialCopy } from '../../utils/landingTrialResolved';
import { apiUrl } from '../../utils/apiBase';

type AdminTab = 'config' | 'revenue' | 'access' | 'suggestions' | 'announcements';

function suggestionCategoryPt(code: string | undefined): string {
  const m: Record<string, string> = {
    usability: 'Telas / usabilidade',
    campaigns: 'Campanhas',
    reports: 'Relatórios',
    integrations: 'Integrações',
    other: 'Outro'
  };
  if (!code) return '';
  return m[code] || code;
}

type ProductSuggestion = {
  id: string;
  uid: string;
  text: string;
  userEmail: string;
  screen: string;
  category?: string;
  createdAt: string | null;
};

type SuggestionReply = {
  id: string;
  text: string;
  adminEmail: string;
  adminUid: string;
  emailSent: boolean;
  /** Motivo quando emailSent=false (texto da API ou servidor). */
  emailError?: string;
  createdAt: string | null;
};
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
  includedChannels: number;
  manualExtraChannelSlots: number;
  manualExtraChannelSlotsEndsAt: string | null;
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
  usage: {
    totalActiveMs: number;
    lastActiveAt: string | null;
  } | null;
};

type PlatformStats = {
  generatedAt: string;
  users: { total: number; newLast7Days: number; newLast30Days: number };
  subscriptions: {
    active: number;
    trialing: number;
    manualGrant: number;
    blocked: number;
    none: number;
  };
  connections: { total: number; connected: number; tenantsWithConnection: number };
  revenue: {
    priceMonthlyBrl: number;
    priceAnnualBrl: number;
    estimatedMrrBrl: number;
    activeMonthlyPlans: number;
    activeAnnualPlans: number;
    channelAddonSlots: number;
  };
  recentSignups: Array<{
    uid: string;
    email: string;
    createdAt: string | null;
    status: string;
    plan: string | null;
    connectionsConnected: number;
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

const formatBrl = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

/** Duração legível a partir de ms (tempo no app). */
const formatAppUsageMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 60_000) return `≈ ${Math.max(1, Math.round(ms / 1000))} s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
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
    id: 'rejected',
    title: 'Pagamento recusado',
    text: 'O pagamento foi recusado pelo emissor. Você pode tentar outro cartão ou Pix para concluir o upgrade.'
  },
  {
    id: 'limit',
    title: 'Limite atingido',
    text: 'Você atingiu o limite de canais do seu plano atual. Abra Minha assinatura e escolha um plano com mais canais.'
  },
  {
    id: 'prorata',
    title: 'Upgrade pró-rata',
    text: 'No upgrade durante ciclo ativo, cobramos só a diferença proporcional ao período restante (pró-rata).'
  },
  {
    id: 'no-update',
    title: 'Sem atualização após pagamento',
    text: 'Me passe o e-mail da conta e o horário do pagamento para eu verificar o webhook e atualizar manualmente, se necessário.'
  }
];

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
  const [grantPassword, setGrantPassword] = useState('');
  const [channelGrantSlots, setChannelGrantSlots] = useState('1');
  const [channelGrantDays, setChannelGrantDays] = useState('30');
  const [channelGrantMonths, setChannelGrantMonths] = useState('0');
  const [includedChannelsGrant, setIncludedChannelsGrant] = useState('5');
  const [accessActionBusy, setAccessActionBusy] = useState(false);
  const [filter, setFilter] = useState<AccessFilter>('all');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRows, setAuditRows] = useState<AccessAudit[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState<AccessUserInsights | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [productSuggestions, setProductSuggestions] = useState<ProductSuggestion[]>([]);
  const [replyTarget, setReplyTarget] = useState<ProductSuggestion | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [repliesByKey, setRepliesByKey] = useState<Record<string, SuggestionReply[]>>({});
  const [repliesLoadingKey, setRepliesLoadingKey] = useState<string | null>(null);
  const [repliesOpenKey, setRepliesOpenKey] = useState<string | null>(null);
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [platformStatsLoading, setPlatformStatsLoading] = useState(false);

  useEffect(() => {
    setMarketingPriceMonthly(config.marketingPriceMonthly);
    setMarketingPriceAnnual(config.marketingPriceAnnual);
    setTrialHours(String(config.trialHours));
    setLandingTrialTitle(config.landingTrialTitle);
    setLandingTrialBody(config.landingTrialBody);
  }, [config]);

  const landingTrialPreview = useMemo(() => {
    let th = Math.round(Number.parseFloat(String(trialHours).trim()));
    if (!Number.isFinite(th)) th = 1;
    th = Math.max(1, Math.min(168, th));
    return resolveLandingTrialCopy({
      trialHours: th,
      landingTrialTitle,
      landingTrialBody
    });
  }, [trialHours, landingTrialTitle, landingTrialBody]);

  const save = async () => {
    if (!user) return;
    const th = Math.max(1, Math.min(168, Math.round(Number(trialHours)) || 1));
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/admin/app-config'), {
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
      const res = await fetch(apiUrl(`/api/admin/access-users${qs}`), {
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

  const loadPlatformStats = async () => {
    if (!user) return;
    setPlatformStatsLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/admin/platform-stats'), {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar ganhos.');
      }
      setPlatformStats(data.stats as PlatformStats);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível carregar estatísticas.');
    } finally {
      setPlatformStatsLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'revenue') return;
    void loadPlatformStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const loadProductSuggestions = async () => {
    if (!user) return;
    setSuggestionsLoading(true);
    try {
      const h = await authHeaders();
      const res = await fetch(apiUrl('/api/admin/product-suggestions?limit=120'), {
        headers: { Authorization: h.Authorization || '' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar sugestões.');
      }
      setProductSuggestions(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar sugestões.');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'suggestions') return;
    void loadProductSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const replyKey = (s: { uid: string; id: string }) => `${s.uid}__${s.id}`;

  const loadRepliesFor = async (s: ProductSuggestion) => {
    if (!user) return;
    const k = replyKey(s);
    setRepliesLoadingKey(k);
    try {
      const h = await authHeaders();
      const res = await fetch(
        apiUrl(
          `/api/admin/product-suggestions/${encodeURIComponent(s.uid)}/${encodeURIComponent(s.id)}/replies`
        ),
        { headers: { Authorization: h.Authorization || '' } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar histórico.');
      }
      setRepliesByKey((prev) => ({ ...prev, [k]: Array.isArray(data.items) ? data.items : [] }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar histórico.');
    } finally {
      setRepliesLoadingKey(null);
    }
  };

  const toggleRepliesPanel = (s: ProductSuggestion) => {
    const k = replyKey(s);
    if (repliesOpenKey === k) {
      setRepliesOpenKey(null);
      return;
    }
    setRepliesOpenKey(k);
    if (!repliesByKey[k]) void loadRepliesFor(s);
  };

  const openReplyModal = (s: ProductSuggestion) => {
    setReplyTarget(s);
    setReplyText('');
  };

  const closeReplyModal = () => {
    if (replySending) return;
    setReplyTarget(null);
    setReplyText('');
  };

  const submitReply = async () => {
    if (!user || !replyTarget) return;
    const trimmed = replyText.trim();
    if (trimmed.length < 1) {
      toast.error('Escreva a resposta antes de enviar.');
      return;
    }
    setReplySending(true);
    try {
      const h = await authHeaders();
      const res = await fetch(
        apiUrl(
          `/api/admin/product-suggestions/${encodeURIComponent(replyTarget.uid)}/${encodeURIComponent(replyTarget.id)}/reply`
        ),
        {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ text: trimmed })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao enviar resposta.');
      }
      const emailSent = data.emailSent === true;
      const recipient: string = typeof data.recipient === 'string' ? data.recipient : '';
      const emailErr = typeof data.emailError === 'string' ? data.emailError.trim() : '';
      if (emailSent && recipient) {
        toast.success(`Resposta enviada por email para ${recipient}.`);
      } else if (recipient) {
        const detail =
          emailErr.length > 0
            ? emailErr
            : 'Sem detalhe — verifique RESEND_API_KEY e EMAIL_FROM no servidor (Docker/.env) e os logs do Node.';
        toast(`Resposta registrada. ${detail}`, { icon: '⚠️', duration: 12000, style: { maxWidth: 560 } });
      } else {
        toast('Resposta registrada — o cliente não tem email vinculado, então só o histórico ficou salvo.', {
          icon: 'ℹ️',
          duration: 6000
        });
      }
      const k = replyKey(replyTarget);
      // Recarrega o histórico para refletir o novo item.
      await loadRepliesFor(replyTarget);
      setRepliesOpenKey(k);
      setReplyTarget(null);
      setReplyText('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao enviar resposta.');
    } finally {
      setReplySending(false);
    }
  };

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

  const loadAudit = async () => {
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
      toast.success(
        `Acesso liberado com ${channels} canal(is). Peça ao cliente para atualizar a página (Ctrl+F5).`
      );
      setGrantEmail('');
      setGrantNote('');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível liberar acesso.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const handleGrantChannelsByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuário.');
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
      toast.success('Canais extras liberados. Peça ao cliente para atualizar a página (Ctrl+F5).');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível liberar canais extras.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const handleSetIncludedChannelsByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuário.');
      return;
    }
    const n = Math.max(1, Math.min(5, Math.floor(Number(includedChannelsGrant) || 0)));
    setAccessActionBusy(true);
    try {
      const updated = await updateAccessUser({
        email: grantEmail.trim(),
        includedChannels: n,
        adminNote: grantNote.trim() || `Canais do plano definidos para ${n}`
      });
      setUsers((prev) => [updated, ...prev.filter((u) => u.uid !== updated.uid)]);
      toast.success(`Plano atualizado para ${n} canal(is). Peça ao cliente para atualizar a página (Ctrl+F5).`);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível definir os canais do plano.');
    } finally {
      setAccessActionBusy(false);
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

  const handleSetPasswordByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuário.');
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
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível definir a senha.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const copyResetLinkForEmail = async (email: string) => {
    if (!email.trim()) {
      toast.error('Informe o e-mail do usuário.');
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
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível gerar o link.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const setPasswordForUser = async (u: AccessUser) => {
    const pw = window.prompt(`Nova senha para ${u.email} (mínimo 8 caracteres):`);
    if (pw == null) return;
    if (pw.trim().length < 8) {
      toast.error('Senha deve ter ao menos 8 caracteres.');
      return;
    }
    try {
      await updateAccessUser({
        uid: u.uid,
        email: u.email,
        newPassword: pw.trim(),
        adminNote: 'Senha definida pelo admin (sem e-mail)'
      });
      toast.success('Senha definida. O cliente já pode entrar.');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível definir a senha.');
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
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível estender canais extras.');
    }
  };

  const revokeExtraChannels = async (u: AccessUser) => {
    try {
      const updated = await updateAccessUser({
        uid: u.uid,
        manualExtraChannelSlots: 0
      });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      toast.success('Canais extras manuais revogados.');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível revogar canais extras.');
    }
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
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar perfil do usuário.');
      }
      setInsights(data.insights as AccessUserInsights);
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível abrir o perfil analítico.');
    } finally {
      setInsightsLoading(false);
    }
  };

  const openInsights = (u: AccessUser) => {
    void loadInsightsForUid(u.uid);
  };

  const openMyLoginInsights = () => {
    if (user) void loadInsightsForUid(user.uid);
  };

  const creatorTabs: Array<{
    id: AdminTab;
    label: string;
    Icon: React.FC<{ className?: string }>;
    activeClass: string;
  }> = [
    { id: 'config', label: 'Comercial', Icon: TrendingUp, activeClass: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'revenue', label: 'Ganhos', Icon: CircleDollarSign, activeClass: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'access', label: 'Acesso', Icon: Users, activeClass: 'text-sky-600 dark:text-sky-400' },
    { id: 'announcements', label: 'Comunicados', Icon: Megaphone, activeClass: 'text-[var(--accent)]' },
    { id: 'suggestions', label: 'Sugestões', Icon: Lightbulb, activeClass: 'text-amber-600 dark:text-amber-400' }
  ];

  return (
    <div className="max-w-5xl mx-auto px-2 sm:px-0 pb-10 space-y-6">
      <CompactPageHeader
        icon={<Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
        title="Painel do criador"
        subtitle="Comercial, ganhos, acessos, comunicados e feedback dos usuários — alinhado ao tema escuro do app."
        footer={
          <TabBar
            items={creatorTabs}
            activeId={tab}
            onChange={(id) => setTab(id as AdminTab)}
            ariaLabel="Seções do painel do criador"
          />
        }
      />

      {tab === 'announcements' && <AdminAnnouncementsTab />}

      {tab === 'revenue' && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              title="Ganhos e crescimento"
              description="MRR estimado com base nos planos ativos no Mercado Pago, cadastros recentes e canais WhatsApp conectados na plataforma."
            />
            <Button
              variant="secondary"
              type="button"
              disabled={platformStatsLoading}
              leftIcon={
                platformStatsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )
              }
              onClick={() => void loadPlatformStats()}
            >
              Atualizar
            </Button>
          </div>

          {platformStatsLoading && !platformStats ? (
            <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--text-3)' }}>
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando estatísticas…
            </div>
          ) : platformStats ? (
            <>
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                  label="MRR estimado"
                  value={formatBrl(platformStats.revenue.estimatedMrrBrl)}
                  icon={<CircleDollarSign className="w-4 h-4 text-emerald-600" />}
                  helper={`${platformStats.revenue.activeMonthlyPlans} mensais · ${platformStats.revenue.activeAnnualPlans} anuais`}
                  accent="default"
                />
                <StatCard
                  label="Contas na plataforma"
                  value={platformStats.users.total}
                  icon={<Users className="w-4 h-4 text-sky-600" />}
                  helper={`+${platformStats.users.newLast7Days} (7d) · +${platformStats.users.newLast30Days} (30d)`}
                  accent="info"
                />
                <StatCard
                  label="Assinaturas ativas"
                  value={platformStats.subscriptions.active}
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  helper={`${platformStats.subscriptions.trialing} em trial · ${platformStats.subscriptions.manualGrant} manual`}
                  accent="default"
                />
                <StatCard
                  label="Canais conectados"
                  value={platformStats.connections.connected}
                  icon={<Smartphone className="w-4 h-4 text-cyan-600" />}
                  helper={`${platformStats.connections.tenantsWithConnection} contas com WhatsApp · ${platformStats.connections.total} total`}
                  accent="warning"
                />
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader
                    title="Preços configurados (Mercado Pago)"
                    subtitle="Valores usados no cálculo do MRR estimado."
                    icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
                  />
                  <div className="mt-4 space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
                    <p>
                      Plano mensal: <strong>{formatBrl(platformStats.revenue.priceMonthlyBrl)}</strong>
                    </p>
                    <p>
                      Plano anual: <strong>{formatBrl(platformStats.revenue.priceAnnualBrl)}</strong>{' '}
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        (÷12 no MRR)
                      </span>
                    </p>
                    <p>
                      Add-ons de canal pagos: <strong>{platformStats.revenue.channelAddonSlots}</strong> slot(s)
                    </p>
                    <p className="text-xs pt-2" style={{ color: 'var(--text-3)' }}>
                      Atualizado em {toPtDateTime(platformStats.generatedAt)}. O MRR é estimativa — confira também o painel do Mercado Pago.
                    </p>
                  </div>
                </Card>
                <Card>
                  <CardHeader
                    title="Resumo de assinaturas"
                    subtitle="Distribuição de status em todas as contas."
                    icon={<BarChart3 className="w-4 h-4 text-sky-600" />}
                  />
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Ativas', platformStats.subscriptions.active],
                      ['Trial', platformStats.subscriptions.trialing],
                      ['Manual', platformStats.subscriptions.manualGrant],
                      ['Bloqueadas', platformStats.subscriptions.blocked],
                      ['Sem plano', platformStats.subscriptions.none]
                    ].map(([label, count]) => (
                      <div
                        key={String(label)}
                        className="rounded-lg border px-3 py-2"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                      >
                        <p className="text-[10px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>
                          {label}
                        </p>
                        <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>
                          {count}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Cadastros recentes"
                  subtitle="—altimas 25 contas criadas — com plano e canais conectados."
                  icon={<Users className="w-4 h-4 text-emerald-600" />}
                />
                {platformStats.recentSignups.length === 0 ? (
                  <EmptyState title="Nenhum cadastro ainda" description="Novos registros aparecerão aqui." />
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-[12.5px]">
                      <thead>
                        <tr className="border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-3)' }}>
                          <th className="py-2 pr-3 font-semibold">E-mail</th>
                          <th className="py-2 pr-3 font-semibold">Cadastro</th>
                          <th className="py-2 pr-3 font-semibold">Plano</th>
                          <th className="py-2 pr-3 font-semibold">Canais</th>
                          <th className="py-2 font-semibold">UID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {platformStats.recentSignups.map((row) => (
                          <tr
                            key={row.uid}
                            className="border-b last:border-0"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            <td className="py-2.5 pr-3 font-medium" style={{ color: 'var(--text-1)' }}>
                              {row.email || '—'}
                            </td>
                            <td className="py-2.5 pr-3" style={{ color: 'var(--text-2)' }}>
                              {toPtDateTime(row.createdAt)}
                            </td>
                            <td className="py-2.5 pr-3">
                              <Badge variant={statusBadgeVariant(row.status, false)}>
                                {row.status === 'active'
                                  ? row.plan === 'annual'
                                    ? 'Anual'
                                    : 'Mensal'
                                  : row.status === 'trialing'
                                    ? 'Trial'
                                    : row.status === 'none'
                                      ? 'Sem plano'
                                      : row.status}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-3" style={{ color: 'var(--text-2)' }}>
                              {row.connectionsConnected > 0 ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <Smartphone className="w-3.5 h-3.5" />
                                  {row.connectionsConnected}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2.5">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-[11px] font-mono opacity-80 hover:opacity-100"
                                style={{ color: 'var(--text-3)' }}
                                onClick={() => void copyToClipboard(row.uid, 'UID copiado.')}
                              >
                                {row.uid.slice(0, 8)}…
                                <Copy className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                Novos cadastros e assinaturas também chegam no sino de notificações (categoria admin) e por e-mail, se{' '}
                <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80">RESEND_API_KEY</code> estiver configurado.
              </p>
            </>
          ) : (
            <EmptyState
              title="Sem dados"
              description="Não foi possível carregar as estatísticas. Clique em Atualizar."
            />
          )}
        </div>
      )}

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
                subtitle="1—168 h. Aplicada em POST /api/billing/trial/start."
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
              subtitle={`Opcional; máximo ${LANDING_TRIAL_TITLE_MAX_CHARS} caracteres no título e ${LANDING_TRIAL_BODY_MAX_CHARS} no texto. Eventos para GA4/GTM (com VITE_GA_MEASUREMENT_ID ou snippet próprio): landing_cta_click, landing_login_click, login_success, trial_started.`}
              icon={<Sparkles className="w-4 h-4 text-amber-600" />}
            />
            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="ui-eyebrow text-[10px]">Título</label>
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {landingTrialTitle.length}/{LANDING_TRIAL_TITLE_MAX_CHARS}
                  </span>
                </div>
                <input
                  className="ui-input mt-1"
                  value={landingTrialTitle}
                  maxLength={LANDING_TRIAL_TITLE_MAX_CHARS}
                  onChange={(e) => setLandingTrialTitle(e.target.value)}
                  placeholder="Vazio = título automático a partir das horas"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="ui-eyebrow text-[10px]">Texto</label>
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {landingTrialBody.length}/{LANDING_TRIAL_BODY_MAX_CHARS}
                  </span>
                </div>
                <textarea
                  rows={4}
                  maxLength={LANDING_TRIAL_BODY_MAX_CHARS}
                  className="ui-input mt-1 resize-y min-h-[100px]"
                  value={landingTrialBody}
                  onChange={(e) => setLandingTrialBody(e.target.value)}
                  placeholder="Vazio = texto padrão da landing"
                />
              </div>
              <div
                className="rounded-xl border p-4 space-y-2"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  Pré-visualização (como na landing)
                </p>
                <p className="text-[13px] font-bold leading-snug" style={{ color: 'var(--text-1)' }}>
                  {landingTrialPreview.title}
                </p>
                <p className="text-[12px] leading-relaxed font-medium" style={{ color: 'var(--text-2)' }}>
                  {landingTrialPreview.body}
                </p>
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

      {tab === 'access' && <AdminAccessTab />}


      {tab === 'suggestions' && (
        <div className="space-y-6">
          <SectionHeader
            title="Sugestões dos usuários"
            description="Envios feitos pelo botão «Sugestões» na barra superior. No Firestore: cada conta em «users», subcoleção «suggestions»."
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              type="button"
              disabled={suggestionsLoading}
              leftIcon={suggestionsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              onClick={() => void loadProductSuggestions()}
            >
              Atualizar lista
            </Button>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              Mostrando as {productSuggestions.length} mais recentes (até 120 pedidas à API).
            </span>
          </div>

          {suggestionsLoading && productSuggestions.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-3 py-14 rounded-xl border"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}
            >
              <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                Carregando sugestões…
              </p>
            </div>
          ) : productSuggestions.length === 0 ? (
            <EmptyState
              icon={<Lightbulb className="w-7 h-7 text-amber-500" />}
              title="Ainda sem sugestões"
              description="Quando usuários enviarem ideias pelo botão «Sugestões» na barra superior, elas aparecem aqui para triagem e resposta."
              className="!py-14"
            />
          ) : (
            <div className="space-y-3">
              {productSuggestions.map((row) => {
                const k = replyKey(row);
                const open = repliesOpenKey === k;
                const replies = repliesByKey[k] || [];
                const repliesLoading = repliesLoadingKey === k;
                const hasEmail = !!row.userEmail && /@/.test(row.userEmail);
                return (
                  <Card key={`${row.uid}-${row.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant="warning">{toPtDateTime(row.createdAt)}</Badge>
                          {row.category ? (
                            <Badge variant="info">{suggestionCategoryPt(row.category)}</Badge>
                          ) : null}
                          {row.screen ? (
                            <Badge variant="neutral">{row.screen}</Badge>
                          ) : null}
                        </div>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                          {row.text || '—'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        type="button"
                        leftIcon={<Send className="w-3.5 h-3.5" />}
                        disabled={!hasEmail}
                        title={
                          hasEmail
                            ? 'Enviar uma resposta por email para o cliente'
                            : 'Cliente sem email vinculado — não é possível responder por email'
                        }
                        onClick={() => openReplyModal(row)}
                      >
                        Responder
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        leftIcon={<MessageCircle className="w-3.5 h-3.5" />}
                        onClick={() => toggleRepliesPanel(row)}
                      >
                        {open ? 'Ocultar histórico' : 'Ver histórico'}
                      </Button>
                      {hasEmail ? (
                        <a
                          href={`mailto:${row.userEmail}?subject=${encodeURIComponent(
                            'Sobre a sua sugestão no ZapMass'
                          )}`}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                          title="Abrir no cliente de email instalado (Outlook, Mail, etc.)"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          mailto
                        </a>
                      ) : null}
                    </div>

                    {open ? (
                      <div
                        className="mt-3 rounded-lg border p-3"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                      >
                        {repliesLoading ? (
                          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Carregando histórico…
                          </div>
                        ) : replies.length === 0 ? (
                          <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                            Nenhuma resposta enviada ainda.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {replies.map((rep) => (
                              <li
                                key={rep.id}
                                className="rounded-md p-2.5 text-[12.5px]"
                                style={{
                                  background: 'var(--surface-0)',
                                  border: '1px solid var(--border-subtle)'
                                }}
                              >
                                <div className="flex flex-wrap items-center gap-2 mb-1 text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                                  <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                                    {rep.adminEmail || rep.adminUid || 'admin'}
                                  </span>
                                  <span>·</span>
                                  <span>{toPtDateTime(rep.createdAt)}</span>
                                  <span>·</span>
                                  {rep.emailSent ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="w-3 h-3" /> email enviado
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                      <XCircle className="w-3 h-3" /> só registrado (sem email)
                                    </span>
                                  )}
                                </div>
                                <p className="whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                                  {rep.text}
                                </p>
                                {!rep.emailSent && rep.emailError ? (
                                  <p
                                    className="mt-2 text-[10px] leading-snug rounded px-2 py-1.5"
                                    style={{
                                      color: 'var(--text-3)',
                                      background: 'rgba(245,158,11,0.08)',
                                      border: '1px solid rgba(245,158,11,0.25)'
                                    }}
                                  >
                                    <strong style={{ color: 'var(--text-2)' }}>Motivo:</strong> {rep.emailError}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}

                    <div
                      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] pt-3 border-t"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-3)' }}
                    >
                      <span>
                        <strong style={{ color: 'var(--text-2)' }}>E-mail:</strong> {row.userEmail || '—'}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono">
                        <strong style={{ color: 'var(--text-2)' }}>UID:</strong> {row.uid || '—'}
                        {row.uid ? (
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                            title="Copiar UID"
                            onClick={() => void copyToClipboard(row.uid, 'UID copiado.')}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={replyTarget !== null}
        onClose={closeReplyModal}
        title="Responder ao cliente"
        subtitle={
          replyTarget?.userEmail
            ? `Vai por email para ${replyTarget.userEmail}. Quando ele responder, chega no seu Reply-To.`
            : 'O cliente desta sugestão não tem email vinculado.'
        }
        icon={<Send className="w-5 h-5 text-emerald-500" />}
        size="lg"
        closeOnBackdrop={!replySending}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button variant="ghost" disabled={replySending} onClick={closeReplyModal}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={replySending || replyText.trim().length < 1 || !replyTarget?.userEmail}
              leftIcon={<Send className="w-4 h-4" />}
              onClick={() => void submitReply()}
            >
              {replySending ? 'Enviando…' : 'Enviar resposta por email'}
            </Button>
          </div>
        }
      >
        {replyTarget ? (
          <div className="space-y-4">
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
            >
              <p className="text-[10.5px] uppercase font-bold tracking-wide mb-1" style={{ color: 'var(--text-3)' }}>
                Sugestão original
              </p>
              <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                {replyTarget.text || '—'}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
                <span>{toPtDateTime(replyTarget.createdAt)}</span>
                {replyTarget.category ? <span>· {suggestionCategoryPt(replyTarget.category)}</span> : null}
                {replyTarget.screen ? <span>· {replyTarget.screen}</span> : null}
              </div>
            </div>

            <div>
              <label className="text-[12.5px] font-semibold flex items-center gap-2 mb-1.5" style={{ color: 'var(--text-1)' }}>
                Sua resposta
                <span className="text-[10.5px] font-normal font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                  {replyText.length}/8000
                </span>
              </label>
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value.slice(0, 8000))}
                placeholder="Escreva uma resposta direta. Pode dizer o status (em estudo, planejado, já feito), perguntar mais detalhes ou agradecer…"
                style={{ minHeight: '160px', fontSize: '13.5px', lineHeight: 1.55 }}
                disabled={replySending}
                autoFocus
              />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                Quando o cliente responder, vai cair direto no seu email ({user?.email || '—'}).
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
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
