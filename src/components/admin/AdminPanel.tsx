import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, Shield, Users, Lock, Unlock, Clock3, Search, RefreshCw, History, Sparkles,
  TrendingUp, KeyRound, Copy, BarChart3, Lightbulb, Send, Mail, MessageCircle, CheckCircle2, XCircle, Megaphone,
  CircleDollarSign, Smartphone
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppConfig } from '../../context/AppConfigContext';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, CardHeader, Badge, StatCard, SectionHeader, EmptyState, Modal, Textarea } from '../ui';
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
    reports: 'RelatÃ³rios',
    integrations: 'IntegraÃ§Ãµes',
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
  if (!iso) return 'â€”';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return 'â€”';
  }
};

const formatBrl = (value: number): string => {
  if (!Number.isFinite(value)) return 'â€”';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

/** DuraÃ§Ã£o legÃ­vel a partir de ms (tempo no app). */
const formatAppUsageMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return 'â€”';
  if (ms < 60_000) return `â‰ˆ ${Math.max(1, Math.round(ms / 1000))} s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
};

const copyToClipboard = async (text: string, okMessage = 'Copiado para a Ã¡rea de transferÃªncia.') => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error('NÃ£o foi possÃ­vel copiar.');
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
    text: 'Seu pagamento foi aprovado e seu plano jÃ¡ foi atualizado. Se a tela ainda nÃ£o refletiu, atualize a pÃ¡gina em 10-20 segundos.'
  },
  {
    id: 'pending',
    title: 'Pagamento pendente',
    text: 'Seu pagamento estÃ¡ pendente. Assim que for confirmado pelo provedor, os canais sÃ£o liberados automaticamente.'
  },
  {
    id: 'rejected',
    title: 'Pagamento recusado',
    text: 'O pagamento foi recusado pelo emissor. VocÃª pode tentar outro cartÃ£o ou Pix para concluir o upgrade.'
  },
  {
    id: 'limit',
    title: 'Limite atingido',
    text: 'VocÃª atingiu o limite de canais do seu plano atual. Abra Minha assinatura e escolha um plano com mais canais.'
  },
  {
    id: 'prorata',
    title: 'Upgrade prÃ³-rata',
    text: 'No upgrade durante ciclo ativo, cobramos sÃ³ a diferenÃ§a proporcional ao perÃ­odo restante (prÃ³-rata).'
  },
  {
    id: 'no-update',
    title: 'Sem atualizaÃ§Ã£o apÃ³s pagamento',
    text: 'Me passe o e-mail da conta e o horÃ¡rio do pagamento para eu verificar o webhook e atualizar manualmente, se necessÃ¡rio.'
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
    if (!user) throw new Error('FaÃ§a login.');
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
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao listar usuÃ¡rios.');
      }
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel carregar acessos.');
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
      toast.error(e instanceof Error ? e.message : 'NÃ£o foi possÃ­vel carregar estatÃ­sticas.');
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
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar sugestÃµes.');
      }
      setProductSuggestions(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar sugestÃµes.');
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
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar histÃ³rico.');
      }
      setRepliesByKey((prev) => ({ ...prev, [k]: Array.isArray(data.items) ? data.items : [] }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar histÃ³rico.');
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
            : 'Sem detalhe â€” verifique RESEND_API_KEY e EMAIL_FROM no servidor (Docker/.env) e os logs do Node.';
        toast(`Resposta registada. ${detail}`, { icon: 'âš ï¸', duration: 12000, style: { maxWidth: 560 } });
      } else {
        toast(
          'Resposta registada â€” o cliente nÃ£o tem email vinculado, entÃ£o sÃ³ o histÃ³rico ficou guardado.',
          { icon: 'â„¹ï¸', duration: 6000 }
        );
      }
      const k = replyKey(replyTarget);
      // Recarrega o histÃ³rico para refletir o novo item.
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
      toast.error(e?.message || 'NÃ£o foi possÃ­vel carregar auditoria.');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleGrantByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuÃ¡rio.');
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
        `Acesso liberado com ${channels} canal(is). PeÃ§a ao cliente para atualizar a pÃ¡gina (Ctrl+F5).`
      );
      setGrantEmail('');
      setGrantNote('');
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel liberar acesso.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const handleGrantChannelsByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuÃ¡rio.');
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
      toast.success('Canais extras liberados. PeÃ§a ao cliente para atualizar a pÃ¡gina (Ctrl+F5).');
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel liberar canais extras.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const handleSetIncludedChannelsByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuÃ¡rio.');
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
      toast.success(`Plano atualizado para ${n} canal(is). PeÃ§a ao cliente para atualizar a pÃ¡gina (Ctrl+F5).`);
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel definir os canais do plano.');
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
      toast.success(updated.blocked ? 'UsuÃ¡rio bloqueado.' : 'UsuÃ¡rio desbloqueado.');
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel atualizar bloqueio.');
    }
  };

  const handleSetPasswordByEmail = async () => {
    if (!grantEmail.trim()) {
      toast.error('Informe o e-mail do usuÃ¡rio.');
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
      toast.success('Senha definida. O cliente jÃ¡ pode entrar com ela.');
      setGrantPassword('');
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel definir a senha.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const copyResetLinkForEmail = async (email: string) => {
    if (!email.trim()) {
      toast.error('Informe o e-mail do usuÃ¡rio.');
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
          ? 'Link copiado. Se o e-mail estiver configurado, o cliente tambÃ©m recebe na caixa.'
          : 'Link copiado (vÃ¡lido 1h). Envie no WhatsApp â€” o e-mail automÃ¡tico ainda estÃ¡ desligado.'
      );
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel gerar o link.');
    } finally {
      setAccessActionBusy(false);
    }
  };

  const setPasswordForUser = async (u: AccessUser) => {
    const pw = window.prompt(`Nova senha para ${u.email} (mÃ­nimo 8 caracteres):`);
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
      toast.success('Senha definida. O cliente jÃ¡ pode entrar.');
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel definir a senha.');
    }
  };

  const revokeManual = async (u: AccessUser) => {
    try {
      const updated = await updateAccessUser({
        uid: u.uid,
        manualGrant: false
      });
      setUsers((prev) => prev.map((x) => (x.uid === updated.uid ? updated : x)));
      toast.success('LiberaÃ§Ã£o manual revogada.');
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel revogar liberaÃ§Ã£o.');
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
      toast.error(e?.message || 'NÃ£o foi possÃ­vel estender acesso.');
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
      toast.error(e?.message || 'NÃ£o foi possÃ­vel estender canais extras.');
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
      toast.error(e?.message || 'NÃ£o foi possÃ­vel revogar canais extras.');
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
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar perfil do usuÃ¡rio.');
      }
      setInsights(data.insights as AccessUserInsights);
    } catch (e: any) {
      toast.error(e?.message || 'NÃ£o foi possÃ­vel abrir o perfil analÃ­tico.');
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
                  Ajuste preÃ§os e trial na aba <strong className="text-[var(--text-2)]">Comercial</strong>; em{' '}
                  <strong className="text-[var(--text-2)]">Ganhos</strong> acompanhe MRR, cadastros e canais; em{' '}
                  <strong className="text-[var(--text-2)]">Acesso</strong> libere planos e bloqueie abusos.
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
                onClick={() => setTab('revenue')}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all ${
                  tab === 'revenue'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm ring-1 ring-slate-200/90 dark:ring-slate-600'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <CircleDollarSign className="w-3.5 h-3.5" />
                Ganhos
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
              <button
                type="button"
                onClick={() => setTab('announcements')}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all ${
                  tab === 'announcements'
                    ? 'bg-[rgba(16,185,129,0.10)] text-[var(--accent)] shadow-sm ring-1 ring-[var(--accent)]/20'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Megaphone className="w-3.5 h-3.5" />
                Comunicados
              </button>
              <button
                type="button"
                onClick={() => setTab('suggestions')}
                className={`px-4 py-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all ${
                  tab === 'suggestions'
                    ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-sm ring-1 ring-slate-200/90 dark:ring-slate-600'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" />
                SugestÃµes
              </button>
            </div>
          </div>
        </div>
      </Card>

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
              A carregar estatÃ­sticasâ€¦
            </div>
          ) : platformStats ? (
            <>
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                  label="MRR estimado"
                  value={formatBrl(platformStats.revenue.estimatedMrrBrl)}
                  icon={<CircleDollarSign className="w-4 h-4 text-emerald-600" />}
                  helper={`${platformStats.revenue.activeMonthlyPlans} mensais Â· ${platformStats.revenue.activeAnnualPlans} anuais`}
                  accent="default"
                />
                <StatCard
                  label="Contas na plataforma"
                  value={platformStats.users.total}
                  icon={<Users className="w-4 h-4 text-sky-600" />}
                  helper={`+${platformStats.users.newLast7Days} (7d) Â· +${platformStats.users.newLast30Days} (30d)`}
                  accent="info"
                />
                <StatCard
                  label="Assinaturas ativas"
                  value={platformStats.subscriptions.active}
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  helper={`${platformStats.subscriptions.trialing} em trial Â· ${platformStats.subscriptions.manualGrant} manual`}
                  accent="default"
                />
                <StatCard
                  label="Canais conectados"
                  value={platformStats.connections.connected}
                  icon={<Smartphone className="w-4 h-4 text-cyan-600" />}
                  helper={`${platformStats.connections.tenantsWithConnection} contas com WhatsApp Â· ${platformStats.connections.total} total`}
                  accent="warning"
                />
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader
                    title="PreÃ§os configurados (Mercado Pago)"
                    subtitle="Valores usados no cÃ¡lculo do MRR estimado."
                    icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
                  />
                  <div className="mt-4 space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
                    <p>
                      Plano mensal: <strong>{formatBrl(platformStats.revenue.priceMonthlyBrl)}</strong>
                    </p>
                    <p>
                      Plano anual: <strong>{formatBrl(platformStats.revenue.priceAnnualBrl)}</strong>{' '}
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        (Ã·12 no MRR)
                      </span>
                    </p>
                    <p>
                      Add-ons de canal pagos: <strong>{platformStats.revenue.channelAddonSlots}</strong> slot(s)
                    </p>
                    <p className="text-xs pt-2" style={{ color: 'var(--text-3)' }}>
                      Atualizado em {toPtDateTime(platformStats.generatedAt)}. O MRR Ã© estimativa â€” confira tambÃ©m o painel do Mercado Pago.
                    </p>
                  </div>
                </Card>
                <Card>
                  <CardHeader
                    title="Resumo de assinaturas"
                    subtitle="DistribuiÃ§Ã£o de status em todas as contas."
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
                  subtitle="Ãšltimas 25 contas criadas â€” com plano e canais conectados."
                  icon={<Users className="w-4 h-4 text-emerald-600" />}
                />
                {platformStats.recentSignups.length === 0 ? (
                  <EmptyState title="Nenhum cadastro ainda" description="Novos registos aparecerÃ£o aqui." />
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
                              {row.email || 'â€”'}
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
                                'â€”'
                              )}
                            </td>
                            <td className="py-2.5">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-[11px] font-mono opacity-80 hover:opacity-100"
                                style={{ color: 'var(--text-3)' }}
                                onClick={() => void copyToClipboard(row.uid, 'UID copiado.')}
                              >
                                {row.uid.slice(0, 8)}â€¦
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
                Novos cadastros e assinaturas tambÃ©m chegam no sino de notificaÃ§Ãµes (categoria admin) e por e-mail, se{' '}
                <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80">RESEND_API_KEY</code> estiver configurado.
              </p>
            </>
          ) : (
            <EmptyState
              title="Sem dados"
              description="NÃ£o foi possÃ­vel carregar as estatÃ­sticas. Clique em Atualizar."
            />
          )}
        </div>
      )}

      {tab === 'config' && (
        <div className="space-y-6">
          <SectionHeader
            title="ExibiÃ§Ã£o comercial e trial"
            description="Estes textos e nÃºmeros alimentam modais, landing e API de teste. PublicaÃ§Ã£o leva alguns segundos para replicar."
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="PreÃ§os (marketing)"
                subtitle="O que o cliente lÃª no upgrade. Vazio cai no fallback do front."
                icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
              />
              <div className="mt-4 space-y-3">
                <div>
                  <label className="ui-eyebrow text-[10px]">Mensal (texto livre)</label>
                  <input
                    className="ui-input mt-1"
                    value={marketingPriceMonthly}
                    onChange={(e) => setMarketingPriceMonthly(e.target.value)}
                    placeholder="Ex.: R$ 49,90 / mÃªs"
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
                subtitle="1â€“168 h. Aplicada em POST /api/billing/trial/start."
                icon={<Clock3 className="w-4 h-4 text-sky-600" />}
              />
              <div className="mt-4">
                <label className="ui-eyebrow text-[10px]">DuraÃ§Ã£o (horas)</label>
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
              title="Landing â€” bloco de teste grÃ¡tis"
              subtitle={`Opcional; mÃ¡ximo ${LANDING_TRIAL_TITLE_MAX_CHARS} caracteres no tÃ­tulo e ${LANDING_TRIAL_BODY_MAX_CHARS} no texto. Eventos para GA4/GTM (com VITE_GA_MEASUREMENT_ID ou snippet prÃ³prio): landing_cta_click, landing_login_click, login_success, trial_started.`}
              icon={<Sparkles className="w-4 h-4 text-amber-600" />}
            />
            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="ui-eyebrow text-[10px]">TÃ­tulo</label>
                  <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {landingTrialTitle.length}/{LANDING_TRIAL_TITLE_MAX_CHARS}
                  </span>
                </div>
                <input
                  className="ui-input mt-1"
                  value={landingTrialTitle}
                  maxLength={LANDING_TRIAL_TITLE_MAX_CHARS}
                  onChange={(e) => setLandingTrialTitle(e.target.value)}
                  placeholder="Vazio = tÃ­tulo automÃ¡tico a partir das horas"
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
                  placeholder="Vazio = texto padrÃ£o da landing"
                />
              </div>
              <div
                className="rounded-xl border p-4 space-y-2"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                  PrÃ©-visualizaÃ§Ã£o (como na landing)
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
              Recomenda-se validar o modal Pro e a landing apÃ³s publicar.
            </p>
          </div>
        </div>
      )}

      {tab === 'access' && <AdminAccessTab />}


      {tab === 'suggestions' && (
        <div className="space-y-6">
          <SectionHeader
            title="SugestÃµes dos utilizadores"
            description="Envios feitos pelo botÃ£o Â«SugestÃ£oÂ» na barra superior. No Firestore: cada conta em Â«usersÂ», subcoleÃ§Ã£o Â«suggestionsÂ»."
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
              Mostrando as {productSuggestions.length} mais recentes (atÃ© 120 pedidas Ã  API).
            </span>
          </div>

          {suggestionsLoading && productSuggestions.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 py-10 justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              </div>
            </Card>
          ) : productSuggestions.length === 0 ? (
            <EmptyState
              title="Ainda sem sugestÃµes"
              description="Quando utilizadores enviarem texto pelo botÃ£o de sugestÃµes, aparecem aqui."
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
                          {row.text || 'â€”'}
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
                            : 'Cliente sem email vinculado â€” nÃ£o Ã© possÃ­vel responder por email'
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
                        {open ? 'Ocultar histÃ³rico' : 'Ver histÃ³rico'}
                      </Button>
                      {hasEmail ? (
                        <a
                          href={`mailto:${row.userEmail}?subject=${encodeURIComponent(
                            'Sobre a sua sugestÃ£o no ZapMass'
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
                            A carregar histÃ³ricoâ€¦
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
                                  <span>Â·</span>
                                  <span>{toPtDateTime(rep.createdAt)}</span>
                                  <span>Â·</span>
                                  {rep.emailSent ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="w-3 h-3" /> email enviado
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                      <XCircle className="w-3 h-3" /> sÃ³ registado (sem email)
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
                        <strong style={{ color: 'var(--text-2)' }}>E-mail:</strong> {row.userEmail || 'â€”'}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono">
                        <strong style={{ color: 'var(--text-2)' }}>UID:</strong> {row.uid || 'â€”'}
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
            : 'O cliente desta sugestÃ£o nÃ£o tem email vinculado.'
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
              {replySending ? 'A enviarâ€¦' : 'Enviar resposta por email'}
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
                SugestÃ£o original
              </p>
              <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-1)' }}>
                {replyTarget.text || 'â€”'}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mt-2" style={{ color: 'var(--text-3)' }}>
                <span>{toPtDateTime(replyTarget.createdAt)}</span>
                {replyTarget.category ? <span>Â· {suggestionCategoryPt(replyTarget.category)}</span> : null}
                {replyTarget.screen ? <span>Â· {replyTarget.screen}</span> : null}
              </div>
            </div>

            <div>
              <label className="text-[12.5px] font-semibold flex items-center gap-2 mb-1.5" style={{ color: 'var(--text-1)' }}>
                A sua resposta
                <span className="text-[10.5px] font-normal font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                  {replyText.length}/8000
                </span>
              </label>
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value.slice(0, 8000))}
                placeholder="Escreva uma resposta direta. Pode dizer o status (em estudo, planejado, jÃ¡ feito), perguntar mais detalhes ou agradecerâ€¦"
                style={{ minHeight: '160px', fontSize: '13.5px', lineHeight: 1.55 }}
                disabled={replySending}
                autoFocus
              />
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                Quando o cliente responder, vai cair direto no seu email ({user?.email || 'â€”'}).
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
