import React, { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Send,
  CheckCheck,
  Reply,
  Cake,
  Calendar,
  Heart,
  User,
  Smartphone,
  ChevronDown,
  TrendingUp,
  Clock,
  Zap,
  BarChart3,
  Cpu,
  MessageCircle,
  Sparkles,
  RotateCcw,
  Users,
  Flame,
  FolderInput,
  Rocket,
  ArrowRight,
  Plus,
  Server,
  Wifi,
  WifiOff,
  AlertTriangle,
  BookOpen,
  UserPlus,
  MapPin,
  Download
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ConnectionStatus } from '../types';
import { useZapMassCore, useZapMassConversations, useZapMassUiSnapshot } from '../context/ZapMassContext';
import { useAppView } from '../context/AppViewContext';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useAppProfile } from '../context/AppProfileContext';
import { getSegmentExperience } from '../constants/segmentExperience';
import { isPlatformAdminUser } from '../utils/adminAccess';
import {
  daysUntilWeddingAnniversary,
  parseWeddingDayMonth,
  weddingNextOccurrence,
  yearsCelebratingAtNextAnniversary
} from '../utils/weddingAnniversary';
import { campaignRecipientNameVars } from '../utils/contactNameNormalize';
import { campaignClockVars } from '../utils/campaignClockVars';
import { DDDPulseMap } from './dashboard/DDDPulseMap';
import { ContactAddressMap } from './dashboard/ContactAddressMap';
import { CommercialIntelligenceMap } from './dashboard/CommercialIntelligenceMap';
import { usePastoralVisits } from '../hooks/usePastoralVisits';
import { openChatNavigate } from '../utils/openChatByPhoneNav';
import { downloadPastoralVisitIcs } from '../utils/pastoralVisitIcs';
import {
  getMaxConnectionSlotsForUser,
  countAccountScopedConnections,
  BASE_CHANNEL_SLOTS,
  MAX_CHANNELS_TOTAL
} from '../utils/connectionLimitPolicy';
import { Card, CardHeader, Button, Badge, Modal, Textarea, Select } from './ui';
import { PerformanceFunnel } from './PerformanceFunnel';
import { DashboardIntelPanel } from './dashboard/DashboardIntelPanel';
import { Sparkline } from './Sparkline';
import {
  buildChannelSpotlightRows,
  computeAccountDashboardSummary,
  computeAdminOpsSnapshot
} from '../utils/dashboardAccountSummary';
import { BrazilCampaignMap, GeoLayer } from './dashboard/BrazilCampaignMap';
// Contato de aniversariante ja enriquecido com dias restantes e idade
interface UpcomingBirthday {
  id: string;
  name: string;
  phone: string;
  birthday: string;
  birthdayLabel: string;
  daysRemaining: number;
  age: number | null;
  profilePicUrl?: string;
}

interface UpcomingWedding {
  id: string;
  name: string;
  phone: string;
  spouseName: string;
  nextLabel: string;
  daysRemaining: number;
  yearsCelebrating: number | null;
}

/**
 * Conta de N→target em `duration`ms.
 *
 * Estratégia anti-CPU:
 *  - Anima a partir do valor atual (e não do zero) — o painel não regride visualmente a cada `metrics-update`.
 *  - Pula a animação se a variação for irrisória (≤ 2 unidades ou ≤ 1%) — evita reanimar a 60fps a cada socket.
 *  - Cancela animação anterior antes de iniciar nova; para mudanças grandes a animação ainda acontece, mas
 *    deltas pequenos (caso comum em rajadas de socket) não disparam loop de `requestAnimationFrame` algum.
 */
const useCountUp = (target: number, duration = 1100) => {
  const [val, setVal] = useState(target);
  const valRef = useRef(target);
  useEffect(() => {
    const from = valRef.current;
    const to = target;
    const delta = Math.abs(to - from);
    // Sem mudança ou mudança trivial — atualiza direto, sem RAF.
    if (delta === 0) return;
    const trivial = delta <= 2 || (from > 0 && delta / Math.max(from, to) < 0.01);
    if (trivial) {
      valRef.current = to;
      setVal(to);
      return;
    }
    let startTs: number | null = null;
    let raf: number;
    const step = (ts: number) => {
      if (!startTs) startTs = ts;
      const p = Math.min((ts - startTs) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (to - from) * ease);
      valRef.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
};

const DEFAULT_BIRTHDAY_TEMPLATE = `Ola {nome}! 🎉🎂\n\nParabens pelo seu dia! Que esse novo ciclo seja repleto de alegrias, saude e conquistas.\n\nVoce e especial para nos!`;

const WEDDING_BULK_DEFAULT = `Ola {nome}! 💍\n\nParabens pelo aniversario de casamento! Que Deus abencoe voce e {conjuge}.\n{anos_line}\n\nFeliz bodas!`;

const BIRTHDAY_RANGE_DAYS = 30;
/** Quantos itens das listas do hero (aniversariantes/casamentos/visitas) renderizam por padrão; o restante carrega sob demanda. */
const DASHBOARD_LIST_PAGE = 10;

const parseBirthdayDate = (raw: string): Date | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  // ISO: 1990-03-15
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  // BR: 15/03/1990 ou 15/03
  const br = /^(\d{2})\/(\d{2})(?:\/(\d{4}))?/.exec(trimmed);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]) - 1;
    const year = br[3] ? Number(br[3]) : 1970;
    return new Date(year, month, day);
  }
  const tryDate = new Date(trimmed);
  if (!isNaN(tryDate.getTime())) return tryDate;
  return null;
};

/**
 * Stat card — anel SVG circular (gauge de cockpit) + valor grande.
 */
const DashboardStat: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
  gradient: [string, string];
  helper?: React.ReactNode;
  progress?: number;
  onClick?: () => void;
}> = ({ label, value, icon, gradient, helper, progress, onClick }) => {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(2, Math.min(100, progress ?? 0));
  const offset = circ - (pct / 100) * circ;
  const uid = label.replace(/\s/g, '');
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`zm-stat-card relative flex flex-col items-center p-5 rounded-2xl group w-full text-left border-0 ${
        onClick
          ? 'zm-stat-card--clickable cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2'
          : ''
      }`}
      style={{
        ['--zm-stat-accent' as string]: gradient[0],
        background: `linear-gradient(145deg, color-mix(in srgb, ${gradient[0]} 7%, var(--surface-1)) 0%, var(--surface-0) 100%)`,
        border: `1px solid color-mix(in srgb, ${gradient[0]} 24%, var(--border))`,
        boxShadow: `0 6px 30px -14px ${gradient[0]}44`
      }}
    >
      {/* Glow orb */}
      <div
        className="absolute -top-8 -right-8 w-32 h-32 rounded-full pointer-events-none opacity-20"
        style={{ background: `radial-gradient(circle, ${gradient[0]}, transparent 70%)`, filter: 'blur(16px)' }}
        aria-hidden
      />
      {/* Ring gauge */}
      <div className="zm-stat-ring relative w-[88px] h-[88px] mb-3">
        <svg className="w-full h-full" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
          <defs>
            <linearGradient id={`sg-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r={r} fill="none" stroke={`${gradient[0]}1a`} strokeWidth="7" />
          <circle
            cx="40" cy="40" r={r} fill="none"
            stroke={`url(#sg-${uid})`} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-white" style={{ color: gradient[0] }}>{icon}</span>
          {progress != null && (
            <span className="text-[11px] font-extrabold leading-none tabular-nums" style={{ color: gradient[0] }}>
              {Math.round(progress)}%
            </span>
          )}
        </div>
      </div>
      <p className="text-[28px] sm:text-[32px] font-black leading-none tabular-nums tracking-tight" style={{ color: 'var(--text-1)' }}>
        {value}
      </p>
      <p className="text-[9.5px] font-bold uppercase tracking-widest mt-2" style={{ color: gradient[0], opacity: 0.9 }}>
        {label}
      </p>
      {helper && (
        <p className="text-[11px] mt-1.5 text-center leading-snug" style={{ color: 'var(--text-3)' }}>
          {helper}
        </p>
      )}
    </Tag>
  );
};

/**
 * Atalho rápido: pill/botão horizontal com ícone + rótulo + seta — alinha em dock horizontal.
 */
const QuickAction: React.FC<{
  label: string;
  hint: string;
  icon: React.ReactNode;
  gradient: [string, string];
  onClick: () => void;
}> = ({ label, hint, icon, gradient, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={hint}
    className="zm-quick-tile group relative flex flex-col items-center gap-2.5 px-4 py-4 rounded-2xl focus:outline-none focus-visible:ring-2 w-full"
    style={{
      ['--zm-tile-accent' as string]: gradient[0],
      background: 'var(--surface-0)',
      border: `1px solid color-mix(in srgb, ${gradient[0]} 22%, var(--border))`,
    }}
  >
    <div
      className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
      style={{ background: `linear-gradient(145deg, ${gradient[0]}10, transparent 70%)` }}
      aria-hidden
    />
    <div
      className="relative w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0"
      style={{
        background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
        boxShadow: `0 8px 24px -8px ${gradient[0]}cc`
      }}
    >
      {icon}
    </div>
    <span className="relative text-[12.5px] font-bold leading-tight text-center" style={{ color: 'var(--text-1)' }}>
      {label}
    </span>
    <ArrowRight
      className="absolute top-3 right-3 w-3 h-3 opacity-0 group-hover:opacity-60 transition-all duration-200 group-hover:translate-x-0.5"
      style={{ color: gradient[0] }}
    />
  </button>
);

export const DashboardTab: React.FC = () => {
  const conversations = useZapMassConversations();
  /** Conversas defer-iadas: usadas só nas agregações pesadas (best window, etc.) — evita recalcular a cada socket. */
  const deferredConversations = useDeferredValue(conversations);
  const {
    connections,
    sendMessage,
    campaigns,
    contacts,
    socket,
    startCampaign,
    funnelStats,
    clearFunnelStats,
    isBackendConnected,
    systemLogs,
    circuitBreakerOpenConnectionIds,
    campaignGeo,
    warmupChipStats
  } = useZapMassCore();
  const { systemMetrics } = useZapMassUiSnapshot();
  const [geoLayer, setGeoLayer] = useState<GeoLayer>('delivered');
  const { setCurrentView } = useAppView();
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const { segment } = useAppProfile();
  const segmentXp = useMemo(() => getSegmentExperience(segment), [segment]);
  const { visits: pastoralVisits, loading: pastoralLoading } = usePastoralVisits({
    enabled: segment === 'religious'
  });
  const upcomingPastoralVisits = useMemo(() => {
    const margin = 15 * 60 * 1000;
    const t = Date.now();
    return pastoralVisits
      .filter((v) => v.status === 'scheduled' && v.scheduledEndMs >= t - margin)
      .sort((a, b) => a.scheduledStartMs - b.scheduledStartMs)
      .slice(0, 6);
  }, [pastoralVisits]);
  const isAdmin = isPlatformAdminUser(user);
  const maxPlanChannelSlots = useMemo(
    () => getMaxConnectionSlotsForUser(subscription, isAdmin),
    [subscription, isAdmin]
  );
  const planScopedCount = useMemo(
    () => countAccountScopedConnections(connections, user?.uid ?? null),
    [connections, user?.uid]
  );
  const atPlanChannelLimit = !isAdmin && planScopedCount >= maxPlanChannelSlots;
  const planUsagePct =
    isAdmin || maxPlanChannelSlots <= 0
      ? 0
      : Math.min(100, Math.round((planScopedCount / maxPlanChannelSlots) * 100));
  const firstName = useMemo(() => {
    const raw = user?.displayName || user?.email?.split('@')[0] || '';
    const clean = raw.trim().split(/\s+/)[0] || '';
    if (!clean) return 'por aqui';
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }, [user?.displayName, user?.email]);

  // Melhor horario para disparos — calculado a partir das respostas recebidas
  // (mensagens inbound das ultimas 4 semanas). Mostramos em faixa de 90 min
  // em volta da hora mais ativa.
  const bestWindow = useMemo(() => {
    const cutoff = Date.now() - 28 * 86_400_000;
    const byHour = new Array(24).fill(0);
    let total = 0;
    deferredConversations.forEach((conv) => {
      conv.messages?.forEach((m) => {
        const ts = m.timestampMs || (m.timestamp ? new Date(m.timestamp).getTime() : 0);
        if (!ts || ts < cutoff) return;
        if (m.sender !== 'them') return;
        byHour[new Date(ts).getHours()] += 1;
        total += 1;
      });
    });
    if (total < 5) return null;
    const peak = byHour.indexOf(Math.max(...byHour));
    const start = Math.max(0, peak);
    const endH = Math.min(23, peak + 1);
    return {
      label: `${String(start).padStart(2, '0')}h–${String(endH).padStart(2, '0')}h30`,
      count: byHour[peak]
    };
  }, [deferredConversations]);

  const [confirmClearFunnel, setConfirmClearFunnel] = useState(false);

  const [selectedContact, setSelectedContact] = useState<UpcomingBirthday | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingConnectionId, setSendingConnectionId] = useState<string>('');
  const [showChannelSelector, setShowChannelSelector] = useState(false);

  const [bulkBirthdayOpen, setBulkBirthdayOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState<'compose' | 'preview'>('compose');
  const [bulkTemplate, setBulkTemplate] = useState<string>(DEFAULT_BIRTHDAY_TEMPLATE);
  const [bulkConnectionId, setBulkConnectionId] = useState<string>('');
  const [bulkDaysRange, setBulkDaysRange] = useState<number>(7);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkPreviewIndex, setBulkPreviewIndex] = useState(0);

  const [selectedWedding, setSelectedWedding] = useState<UpcomingWedding | null>(null);
  const [weddingMessageText, setWeddingMessageText] = useState('');
  const [weddingBulkOpen, setWeddingBulkOpen] = useState(false);
  const [weddingBulkTemplate, setWeddingBulkTemplate] = useState(WEDDING_BULK_DEFAULT);
  const [weddingBulkSubmitting, setWeddingBulkSubmitting] = useState(false);

  useEffect(() => {
    if ((selectedContact || selectedWedding) && connections.length > 0) {
      const firstOnline = connections.find((c) => c.status === ConnectionStatus.CONNECTED);
      setSendingConnectionId(firstOnline ? firstOnline.id : connections[0]?.id || '');
    }
  }, [selectedContact, selectedWedding, connections]);

  useEffect(() => {
    if (bulkBirthdayOpen && !bulkConnectionId) {
      const firstOnline = connections.find((c) => c.status === ConnectionStatus.CONNECTED);
      if (firstOnline) setBulkConnectionId(firstOnline.id);
    }
  }, [bulkBirthdayOpen, connections, bulkConnectionId]);

  useEffect(() => {
    if (weddingBulkOpen && !bulkConnectionId) {
      const firstOnline = connections.find((c) => c.status === ConnectionStatus.CONNECTED);
      if (firstOnline) setBulkConnectionId(firstOnline.id);
    }
  }, [weddingBulkOpen, connections, bulkConnectionId]);

  const onlineCount = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
  // --- ANIVERSARIANTES (derivado de contacts) ---
  const upcomingBirthdays = useMemo<UpcomingBirthday[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: UpcomingBirthday[] = [];

    for (const c of contacts) {
      if (!c.birthday) continue;
      const parsed = parseBirthdayDate(c.birthday);
      if (!parsed) continue;
      const birthMonth = parsed.getMonth();
      const birthDay = parsed.getDate();
      const birthYear = parsed.getFullYear();

      // Proxima ocorrencia do aniversario
      let next = new Date(today.getFullYear(), birthMonth, birthDay);
      if (next < today) {
        next = new Date(today.getFullYear() + 1, birthMonth, birthDay);
      }
      const diffMs = next.getTime() - today.getTime();
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (days > BIRTHDAY_RANGE_DAYS) continue;

      const ageNow = birthYear > 1900 && birthYear < today.getFullYear()
        ? next.getFullYear() - birthYear
        : null;

      const cleanPhone = (c.phone || '').replace(/\D/g, '');
      if (cleanPhone.length < 10) continue;

      result.push({
        id: c.id,
        name: c.name,
        phone: cleanPhone,
        birthday: c.birthday,
        birthdayLabel: new Date(today.getFullYear(), birthMonth, birthDay).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit'
        }),
        daysRemaining: days,
        age: ageNow
      });
    }

    return result.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [contacts]);

  const upcomingWeddings = useMemo<UpcomingWedding[]>(() => {
    if (segment !== 'religious') return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: UpcomingWedding[] = [];
    for (const c of contacts) {
      const md = parseWeddingDayMonth(c.religiousMemberProfile?.weddingDate);
      if (!md) continue;
      const days = daysUntilWeddingAnniversary(md, today);
      if (days > BIRTHDAY_RANGE_DAYS) continue;
      const cleanPhone = (c.phone || '').replace(/\D/g, '');
      if (cleanPhone.length < 10) continue;
      const spouse = (c.religiousMemberProfile?.spouseName || '').trim();
      const next = weddingNextOccurrence(md, today);
      const nextLabel = next.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const yearsCelebrating = yearsCelebratingAtNextAnniversary(md, today);
      result.push({
        id: c.id,
        name: c.name,
        phone: cleanPhone,
        spouseName: spouse || '—',
        nextLabel,
        daysRemaining: days,
        yearsCelebrating
      });
    }
    return result.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [contacts, segment]);

  useEffect(() => {
    if (segment === 'religious') return;
    setSelectedWedding(null);
    setWeddingBulkOpen(false);
    setWeddingMessageText('');
  }, [segment]);

  const todaysBirthdays = upcomingBirthdays.filter((b) => b.daysRemaining === 0);
  const weekBirthdays = upcomingBirthdays.filter((b) => b.daysRemaining <= 7);
  const todaysWeddings = upcomingWeddings.filter((w) => w.daysRemaining === 0);
  const weekWeddings = upcomingWeddings.filter((w) => w.daysRemaining <= 7);

  /**
   * Paginação progressiva nos hero-cards do Dashboard — sem isto, em bases grandes (centenas de
   * aniversariantes nos próximos 30 dias) o painel sozinho monta milhares de nós no DOM.
   */
  const [birthdaysVisible, setBirthdaysVisible] = useState(DASHBOARD_LIST_PAGE);
  const [weddingsVisible, setWeddingsVisible] = useState(DASHBOARD_LIST_PAGE);
  const [pastoralVisible, setPastoralVisible] = useState(DASHBOARD_LIST_PAGE);
  useEffect(() => setBirthdaysVisible(DASHBOARD_LIST_PAGE), [upcomingBirthdays]);
  useEffect(() => setWeddingsVisible(DASHBOARD_LIST_PAGE), [upcomingWeddings]);
  const upcomingBirthdaysVisible = useMemo(
    () => upcomingBirthdays.slice(0, birthdaysVisible),
    [upcomingBirthdays, birthdaysVisible]
  );
  const upcomingWeddingsVisible = useMemo(
    () => upcomingWeddings.slice(0, weddingsVisible),
    [upcomingWeddings, weddingsVisible]
  );

  const bulkCandidates = useMemo(
    () => upcomingBirthdays.filter((b) => b.daysRemaining <= bulkDaysRange),
    [upcomingBirthdays, bulkDaysRange]
  );

  const allBulkSelected =
    bulkCandidates.length > 0 && bulkCandidates.every((b) => bulkSelectedIds.has(b.id));

  const toggleBulkSelect = (id: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBulkSelectAll = () => {
    setBulkSelectedIds((prev) => {
      if (bulkCandidates.every((b) => prev.has(b.id))) {
        return new Set(Array.from(prev).filter((id) => !bulkCandidates.some((b) => b.id === id)));
      }
      const next = new Set(prev);
      bulkCandidates.forEach((b) => next.add(b.id));
      return next;
    });
  };

  const openBulkBirthday = () => {
    setWeddingBulkOpen(false);
    setBulkBirthdayOpen(true);
    setBulkStep('compose');
    setBulkPreviewIndex(0);
    setBulkTemplate(DEFAULT_BIRTHDAY_TEMPLATE);
    setBulkDaysRange(7);
    setBulkSelectedIds(new Set(upcomingBirthdays.filter((b) => b.daysRemaining <= 7).map((b) => b.id)));
  };

  // Substitui variaveis {nome}, {idade}, etc. igual ao backend
  const renderTemplate = (tpl: string, b: UpcomingBirthday): string => {
    const nv = campaignRecipientNameVars(b.name || '');
    const clock = campaignClockVars();
    const vars: Record<string, string> = {
      ...clock,
      nome: nv.nome,
      nome_completo: nv.nome_completo,
      telefone: b.phone,
      aniversario: b.birthdayLabel,
      idade: b.age != null ? String(b.age) : ''
    };
    return tpl.replace(/\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g, (match, key) => {
      const v = vars[String(key).toLowerCase()];
      return v !== undefined ? v : match;
    });
  };

  const bulkSelectedList = useMemo(
    () => bulkCandidates.filter((b) => bulkSelectedIds.has(b.id)),
    [bulkCandidates, bulkSelectedIds]
  );

  const goToPreview = () => {
    if (!bulkConnectionId) {
      toast.error('Selecione um canal online para disparar.');
      return;
    }
    if (bulkSelectedIds.size === 0) {
      toast.error('Selecione pelo menos um aniversariante.');
      return;
    }
    if (!bulkTemplate.trim()) {
      toast.error('Escreva a mensagem que sera enviada.');
      return;
    }
    setBulkPreviewIndex(0);
    setBulkStep('preview');
  };

  const handleBulkBirthdaySubmit = async () => {
    if (!bulkConnectionId || bulkSelectedList.length === 0 || !bulkTemplate.trim()) return;

    const recipients = bulkSelectedList.map((b) => {
      const nv = campaignRecipientNameVars(b.name || '');
      return {
        phone: b.phone,
        vars: {
          nome: nv.nome,
          nome_completo: nv.nome_completo,
          telefone: b.phone,
          aniversario: b.birthdayLabel,
          idade: b.age != null ? String(b.age) : ''
        }
      };
    });

    const numbers = recipients.map((r) => r.phone);
    setBulkSubmitting(true);
    try {
      await startCampaign(
        bulkConnectionId,
        numbers,
        bulkTemplate.trim(),
        [bulkConnectionId],
        { id: undefined, name: `Aniversariantes (${bulkSelectedList.length})` },
        `Parabens automatico - ${new Date().toLocaleDateString('pt-BR')}`,
        { delaySeconds: 10, recipients }
      );
      toast.success(`Disparo de parabens iniciado para ${bulkSelectedList.length} contatos.`);
      setBulkBirthdayOpen(false);
      setBulkSelectedIds(new Set());
      setBulkStep('compose');
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao iniciar disparo de aniversariantes.');
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleOpenChat = (contact: UpcomingBirthday) => {
    setSelectedWedding(null);
    setSelectedContact(contact);
    const firstName = campaignRecipientNameVars(contact.name || '').nome || 'amigo(a)';
    const ageLine = contact.age ? `\n\nParabens pelos seus ${contact.age} anos!` : '';
    const whenLabel = contact.daysRemaining === 0 ? 'hoje' : `em ${contact.daysRemaining} dia${contact.daysRemaining > 1 ? 's' : ''}`;
    setMessageText(
      `Ola ${firstName}! 🎉🎂\n\nSeu aniversario e ${whenLabel} (${contact.birthdayLabel}) e quero te desejar muita saude, alegria e conquistas!${ageLine}\n\nFeliz aniversario!`
    );
  };

  const handleSendMessage = () => {
    if (!selectedContact || !sendingConnectionId || !messageText.trim()) return;
    const phone = selectedContact.phone?.replace(/\D/g, '');
    if (!phone) {
      toast.error('Contato sem numero de telefone.');
      return;
    }
    const conversationId = `${sendingConnectionId}:${phone}@c.us`;
    sendMessage(conversationId, messageText.trim());
    toast.success(`Mensagem enviada para ${selectedContact.name}.`);
    setSelectedContact(null);
    setShowChannelSelector(false);
    setMessageText('');
  };

  const handleOpenWeddingChat = (w: UpcomingWedding) => {
    setSelectedContact(null);
    setSelectedWedding(w);
    const firstName = campaignRecipientNameVars(w.name || '').nome || 'amigo(a)';
    const conj = w.spouseName === '—' ? 'seu cônjuge' : w.spouseName;
    const anos = w.yearsCelebrating != null ? ` Parabéns pelos ${w.yearsCelebrating} anos de casados!` : '';
    const whenLabel = w.daysRemaining === 0 ? 'hoje' : `em ${w.daysRemaining} dia${w.daysRemaining > 1 ? 's' : ''}`;
    setWeddingMessageText(
      `Olá ${firstName}! 💍\n\nParabéns pelo aniversário de casamento (${whenLabel === 'hoje' ? 'de hoje' : whenLabel})! Que Deus abençoe você e ${conj}.${anos}\n\nFeliz bodas!`
    );
  };

  const handleSendWeddingMessage = () => {
    if (!selectedWedding || !sendingConnectionId || !weddingMessageText.trim()) return;
    const phone = selectedWedding.phone?.replace(/\D/g, '');
    if (!phone) {
      toast.error('Contato sem número de telefone.');
      return;
    }
    const conversationId = `${sendingConnectionId}:${phone}@c.us`;
    sendMessage(conversationId, weddingMessageText.trim());
    toast.success(`Mensagem enviada para ${selectedWedding.name}.`);
    setSelectedWedding(null);
    setShowChannelSelector(false);
    setWeddingMessageText('');
  };

  const openWeddingBulk = () => {
    setBulkBirthdayOpen(false);
    setWeddingBulkTemplate(WEDDING_BULK_DEFAULT);
    setWeddingBulkOpen(true);
  };

  const handleWeddingBulkSubmit = async () => {
    if (!bulkConnectionId || !weddingBulkTemplate.trim()) return;
    const list = weekWeddings;
    if (list.length === 0) {
      toast.error('Nenhum casal com bodas nesta semana.');
      return;
    }
    const recipients = list.map((w) => {
      const nv = campaignRecipientNameVars(w.name || '');
      return {
        phone: w.phone,
        vars: {
          nome: nv.nome,
          nome_completo: nv.nome_completo,
          telefone: w.phone,
          conjuge: w.spouseName === '—' ? '' : w.spouseName,
          data_bodas: w.nextLabel,
          anos_casamento: w.yearsCelebrating != null ? String(w.yearsCelebrating) : '',
          anos_line:
            w.yearsCelebrating != null ? ` Hoje celebram ${w.yearsCelebrating} anos de casados.` : ' Muitas felicidades.'
        }
      };
    });
    const numbers = recipients.map((r) => r.phone);
    setWeddingBulkSubmitting(true);
    try {
      await startCampaign(
        bulkConnectionId,
        numbers,
        weddingBulkTemplate.trim(),
        [bulkConnectionId],
        { id: undefined, name: `Bodas (${list.length})` },
        `Bodas de casamento - ${new Date().toLocaleDateString('pt-BR')}`,
        { delaySeconds: 10, recipients }
      );
      toast.success(`Disparo de bodas iniciado para ${list.length} contato(s).`);
      setWeddingBulkOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao iniciar disparo de bodas.';
      toast.error(msg);
    } finally {
      setWeddingBulkSubmitting(false);
    }
  };

  const currentChannel = connections.find((c) => c.id === sendingConnectionId);

  // --- METRICAS REAIS (acumulador persistente do servidor) ---
  // funnelStats sobrevive a reinicios do servidor e a delecao de campanhas.
  // Pode ser zerado pelo usuario via botao "Limpar" abaixo do funil.
  //
  // Coerencia logica do funil: enviada >= entregue >= lida >= respondida.
  // Em casos onde o ack=READ nao chega (contato com confirmacao de leitura
  // desligada), o servidor ja promove "lida" ao receber a resposta. Mas para
  // dados antigos persistidos antes deste fix, sanitizamos aqui na UI para
  // nunca mostrar "1 lida / 2 respostas".
  const campaignGeoTotals = useMemo(() => {
    let delivered = 0;
    let read = 0;
    let replied = 0;
    for (const s of Object.values(campaignGeo?.byUf || {})) {
      delivered += Number(s.delivered) || 0;
      read += Number(s.read) || 0;
      replied += Number(s.replied) || 0;
    }
    return { delivered, read, replied };
  }, [campaignGeo?.byUf]);

  const metrics = useMemo(() => {
    const sent = Math.max(0, funnelStats.totalSent || 0);
    const replied = Math.max(0, funnelStats.totalReplied || 0, campaignGeoTotals.replied);
    const read = Math.max(funnelStats.totalRead || 0, campaignGeoTotals.read, replied);
    const delivered = Math.max(
      funnelStats.totalDelivered || 0,
      campaignGeoTotals.delivered,
      campaignGeoTotals.read,
      campaignGeoTotals.replied,
      read
    );
    const cap = (n: number) => (sent > 0 ? Math.min(sent, n) : n);
    return {
      totalSent: sent,
      totalDelivered: cap(delivered),
      totalRead: cap(read),
      totalReplied: cap(replied)
    };
  }, [funnelStats, campaignGeoTotals]);

  const deliveryRate = metrics.totalSent > 0 ? Math.round((metrics.totalDelivered / metrics.totalSent) * 100) : 0;
  const readRate = metrics.totalSent > 0 ? Math.round((metrics.totalRead / metrics.totalSent) * 100) : 0;
  const replyRate = metrics.totalSent > 0 ? Math.round((metrics.totalReplied / metrics.totalSent) * 100) : 0;

  const funnelStages = useMemo(
    () => [
      {
        label: 'Enviadas',
        value: metrics.totalSent,
        pctOfSent: metrics.totalSent > 0 ? 100 : 0,
        color: 'var(--brand-500)',
        colorSoft: 'rgba(16, 185, 129, 0.14)'
      },
      {
        label: 'Entregues',
        value: metrics.totalDelivered,
        pctOfSent: deliveryRate,
        color: '#3b82f6',
        colorSoft: 'rgba(59, 130, 246, 0.14)'
      },
      {
        label: 'Lidas',
        value: metrics.totalRead,
        pctOfSent: readRate,
        color: '#8b5cf6',
        colorSoft: 'rgba(139, 92, 246, 0.14)'
      },
      {
        label: 'Respostas',
        value: metrics.totalReplied,
        pctOfSent: replyRate,
        color: '#f59e0b',
        colorSoft: 'rgba(245, 158, 11, 0.14)'
      }
    ],
    [deliveryRate, metrics.totalDelivered, metrics.totalRead, metrics.totalReplied, metrics.totalSent, readRate, replyRate]
  );

  const funnelEmpty =
    metrics.totalSent === 0 &&
    metrics.totalDelivered === 0 &&
    metrics.totalRead === 0 &&
    metrics.totalReplied === 0;

  const channelSpotlight = useMemo(
    () => buildChannelSpotlightRows(connections, warmupChipStats, 4),
    [connections, warmupChipStats]
  );
  const accountSummary = useMemo(
    () => computeAccountDashboardSummary(connections, campaigns, contacts, circuitBreakerOpenConnectionIds),
    [connections, campaigns, contacts, circuitBreakerOpenConnectionIds]
  );
  const adminOps = useMemo(
    () => computeAdminOpsSnapshot(connections, systemMetrics),
    [connections, systemMetrics]
  );

  const animSent = useCountUp(metrics.totalSent);
  const animDelivered = useCountUp(metrics.totalDelivered);
  const animRead = useCountUp(metrics.totalRead);
  const animReplied = useCountUp(metrics.totalReplied);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const funnelSectionRef = useRef<HTMLDivElement>(null);
  const scrollToFunnel = () => {
    funnelSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="zm-dashboard space-y-5 pb-10">
      {/* ========== HERO: Mission Control ========== */}
      <div
        className="zm-dash-section zm-hero-mission relative overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(145deg, #060e1a 0%, #0b1829 50%, #071220 100%)',
          border: '1px solid rgba(16,185,129,0.22)',
          boxShadow: '0 30px 90px -30px rgba(16,185,129,0.25), 0 0 0 1px rgba(16,185,129,0.08)'
        }}
      >
        <div className="zm-hero-orb zm-hero-orb--green" aria-hidden />
        <div className="zm-hero-orb zm-hero-orb--blue" aria-hidden />
        {/* Grid de linhas finas — textura de terminal */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{ backgroundImage: 'linear-gradient(rgba(16,185,129,1) 1px,transparent 1px),linear-gradient(90deg,rgba(16,185,129,1) 1px,transparent 1px)', backgroundSize: '40px 40px' }}
          aria-hidden
        />
        {/* Radar concêntrico decorativo */}
        <div className="absolute -bottom-28 -left-28 pointer-events-none" aria-hidden>
          {[220,160,100,50].map((s,i) => (
            <div key={i} className="absolute rounded-full border"
              style={{ width:s, height:s, top:'50%', left:'50%', transform:'translate(-50%,-50%)',
                borderColor:`rgba(16,185,129,${0.06+i*0.04})`,
                animation: i === 0 ? 'ping 3s cubic-bezier(0,0,0.2,1) infinite' : undefined
              }} />
          ))}
        </div>
        {/* Acento verde topo */}
        <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent 0%,#10b981 30%,#3b82f6 65%,#8b5cf6 85%,transparent 100%)' }}
          aria-hidden />

        <div className="relative z-10 px-5 py-6 sm:px-8 sm:py-7">
          {/* ── Status strip ── */}
          <div className="flex items-center gap-3 flex-wrap mb-5">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
              style={
                isBackendConnected
                  ? { background: 'rgba(16,185,129,0.14)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }
                  : { background: 'rgba(245,158,11,0.14)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)' }
              }
            >
              <span className="relative flex w-1.5 h-1.5">
                {isBackendConnected ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500 animate-pulse" />
                )}
              </span>
              {isBackendConnected ? 'Servidor online' : 'Reconectando…'}
            </span>
            <span className="text-[11px] font-semibold" style={{ color:'rgba(255,255,255,0.35)' }}>
              <Clock className="w-3 h-3 inline-block mr-1" />
              {now.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
              {' · '}
              {now.toLocaleDateString('pt-BR', { weekday:'short', day:'numeric', month:'short' })}
            </span>
            {onlineCount > 0 && (
              <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold"
                style={{ background:'rgba(59,130,246,0.14)', color:'#60a5fa', border:'1px solid rgba(59,130,246,0.28)' }}>
                <Wifi className="w-3 h-3" />
                {onlineCount}/{connections.length} canais
              </span>
            )}
          </div>

          {/* ── Greeting + KPI strip ── */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
            {/* Saudação */}
            <div className="flex-1 min-w-0">
              <h1 className="text-[26px] sm:text-[36px] font-black leading-[1.1] tracking-tight"
                style={{ color:'#fff' }}>
                {greeting},{' '}
                <span style={{ background:'linear-gradient(90deg,#10b981,#3b82f6)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
                  {firstName}
                </span>
                <span className="ml-1.5 text-[22px]">{hour < 6 ? '🌙' : hour < 12 ? '☀️' : hour < 18 ? '🌤️' : '🌙'}</span>
              </h1>
              {segmentXp.dashboardTagline && (
                <p className="mt-2 text-[13px] leading-relaxed max-w-lg" style={{ color:'rgba(255,255,255,0.45)' }}>
                  {segmentXp.dashboardTagline}
                </p>
              )}
              {/* CTAs */}
              <div className="flex items-center gap-2.5 mt-5 flex-wrap">
                <button type="button" onClick={() => setCurrentView('campaigns')}
                  className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                  style={{ background:'linear-gradient(135deg,#10b981,#059669)', boxShadow:'0 8px 24px -8px rgba(16,185,129,0.7)' }}>
                  <Rocket className="w-3.5 h-3.5 transition-transform group-hover:-translate-y-0.5" />
                  Nova campanha
                </button>
                <button type="button" onClick={() => setCurrentView('connections')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 hover:-translate-y-0.5"
                  style={{ background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.8)', border:'1px solid rgba(255,255,255,0.12)' }}>
                  <Smartphone className="w-3.5 h-3.5" style={{ color:'#10b981' }} />
                  Conectar canal
                </button>
                <button type="button" onClick={() => setCurrentView('help')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 hover:-translate-y-0.5"
                  style={{ background:'rgba(59,130,246,0.1)', color:'rgba(255,255,255,0.7)', border:'1px solid rgba(59,130,246,0.25)' }}>
                  <BookOpen className="w-3.5 h-3.5" style={{ color:'#60a5fa' }} />
                  Guia
                </button>
              </div>
            </div>

            {/* KPI tiles horizontais */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2 lg:gap-3 shrink-0 lg:max-w-[480px]">
              {[
                { label:'Enviadas', val: metrics.totalSent.toLocaleString('pt-BR'), color:'#10b981', icon:<Send className="w-3.5 h-3.5" /> },
                { label:'Entregues', val:`${deliveryRate}%`, color:'#3b82f6', icon:<CheckCheck className="w-3.5 h-3.5" /> },
                { label:'Lidas', val:`${readRate}%`, color:'#8b5cf6', icon:<CheckCheck className="w-3.5 h-3.5" /> },
                { label:'Respostas', val: metrics.totalReplied.toLocaleString('pt-BR'), color:'#f59e0b', icon:<Reply className="w-3.5 h-3.5" /> },
              ].map((k) => (
                <button
                  key={k.label}
                  type="button"
                  className="zm-hero-kpi rounded-xl px-3 py-3 flex flex-col gap-1 text-left"
                  style={{ background: `${k.color}12`, border: `1px solid ${k.color}28` }}
                  onClick={() =>
                    k.label === 'Enviadas' ? setCurrentView('campaigns') : scrollToFunnel()
                  }
                  title={
                    k.label === 'Enviadas'
                      ? 'Abrir campanhas'
                      : 'Ver funil de desempenho'
                  }
                >
                  <div className="flex items-center gap-1.5" style={{ color: k.color }}>
                    {k.icon}
                    <span
                      className="text-[9px] font-bold uppercase tracking-widest"
                      style={{ color: 'rgba(255,255,255,0.4)' }}
                    >
                      {k.label}
                    </span>
                  </div>
                  <span className="text-[22px] font-black leading-none tabular-nums" style={{ color: '#fff' }}>
                    {k.val}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Insights strip ── */}
          {(bestWindow || contacts.length > 0) && (
            <div className="mt-5 flex flex-wrap gap-2">
              {bestWindow && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold"
                  style={{ background:'rgba(245,158,11,0.12)', color:'#fbbf24', border:'1px solid rgba(245,158,11,0.22)' }}>
                  <Zap className="w-3.5 h-3.5" />
                  Melhor horário: <strong>{bestWindow.label}</strong>
                </span>
              )}
              {contacts.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold"
                  style={{ background:'rgba(139,92,246,0.12)', color:'#a78bfa', border:'1px solid rgba(139,92,246,0.22)' }}>
                  <Users className="w-3.5 h-3.5" />
                  <strong>{contacts.length.toLocaleString('pt-BR')}</strong> contatos na base
                </span>
              )}
              {campaigns.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold"
                  style={{ background:'rgba(16,185,129,0.10)', color:'#34d399', border:'1px solid rgba(16,185,129,0.2)' }}>
                  <BarChart3 className="w-3.5 h-3.5" />
                  <strong>{campaigns.length}</strong> campanha{campaigns.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Convites de equipa — visível desde o Painel */}
      <button
        type="button"
        onClick={() => setCurrentView('team')}
        className="zm-dash-section group w-full text-left rounded-2xl border px-4 py-4 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
        style={{
          borderColor: 'rgba(16,185,129,0.35)',
          background:
            'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.05))'
        }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff',
            boxShadow: '0 8px 24px -8px rgba(16,185,129,0.55)'
          }}
        >
          <UserPlus className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] sm:text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
            Adicionar funcionário ou sócio à conta
          </p>
          <p className="text-[12px] sm:text-[12.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Gera um código, envia por WhatsApp e a pessoa entra com o Google próprio — mesmos números e campanhas.
          </p>
        </div>
        <span
          className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-xl text-[12.5px] font-bold whitespace-nowrap self-start sm:self-center"
          style={{ background: '#10b981', color: '#fff' }}
        >
          Funcionários
          <ArrowRight className="w-4 h-4 opacity-90 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </button>

      {/* ========== QUICK ACTIONS: atalhos grandes coloridos ========== */}
      <div className="zm-dash-section grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <QuickAction
          label="Campanhas"
          hint="Crie e acompanhe disparos em massa"
          icon={<Rocket className="w-5 h-5" />}
          gradient={['#10b981', '#059669']}
          onClick={() => setCurrentView('campaigns')}
        />
        <QuickAction
          label="Canais"
          hint="Conecte WhatsApps e gerencie QR codes"
          icon={<Smartphone className="w-5 h-5" />}
          gradient={['#3b82f6', '#1d4ed8']}
          onClick={() => setCurrentView('connections')}
        />
        <QuickAction
          label="Contatos"
          hint="Importe listas e edite aniversários"
          icon={<Users className="w-5 h-5" />}
          gradient={['#8b5cf6', '#6d28d9']}
          onClick={() => setCurrentView('contacts')}
        />
        <QuickAction
          label="Aquecimento"
          hint="Reduza o risco de banimento dos chips"
          icon={<Flame className="w-5 h-5" />}
          gradient={['#f59e0b', '#d97706']}
          onClick={() => setCurrentView('warmup')}
        />
      </div>

      {/* STAT CARDS - com glow, progress e animação */}
      <div className="zm-dash-section grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <DashboardStat
          label="Enviadas"
          value={animSent.toLocaleString('pt-BR')}
          icon={<Send className="w-4 h-4" />}
          gradient={['#10b981', '#059669']}
          helper={metrics.totalSent > 0 ? `${campaigns.length} campanha${campaigns.length > 1 ? 's' : ''} registrada${campaigns.length > 1 ? 's' : ''}` : 'Aguardando a primeira campanha'}
          progress={metrics.totalSent > 0 ? 100 : 0}
          onClick={() => setCurrentView('campaigns')}
        />
        <DashboardStat
          label="Entregues"
          value={animDelivered.toLocaleString('pt-BR')}
          icon={<CheckCheck className="w-4 h-4" />}
          gradient={['#3b82f6', '#1d4ed8']}
          helper={metrics.totalSent > 0 ? `${deliveryRate}% dos envios chegaram` : 'Ainda sem envios'}
          progress={deliveryRate}
          onClick={scrollToFunnel}
        />
        <DashboardStat
          label="Lidas"
          value={animRead.toLocaleString('pt-BR')}
          icon={<CheckCheck className="w-4 h-4" />}
          gradient={['#8b5cf6', '#6d28d9']}
          helper={metrics.totalSent > 0 ? `${readRate}% taxa de leitura` : 'Aguardando leituras'}
          progress={readRate}
          onClick={scrollToFunnel}
        />
        <DashboardStat
          label="Respostas"
          value={animReplied.toLocaleString('pt-BR')}
          icon={<Reply className="w-4 h-4" />}
          gradient={['#f59e0b', '#d97706']}
          helper={metrics.totalSent > 0 ? `${replyRate}% engajamento` : 'Aguardando engajamento'}
          progress={replyRate}
          onClick={scrollToFunnel}
        />
      </div>

      <div className="zm-dash-section">
      <DashboardIntelPanel
        campaigns={campaigns}
        contacts={contacts}
        connections={connections}
        conversations={deferredConversations}
        systemLogs={systemLogs}
        funnelStatsTotalSent={funnelStats.totalSent}
        funnelUpdatedAt={funnelStats.updatedAt || 0}
        funnelSentByDay={funnelStats.sentByDay}
        funnelDeliveredByDay={funnelStats.deliveredByDay}
        funnelReadByDay={funnelStats.readByDay}
        funnelRepliedByDay={funnelStats.repliedByDay}
        funnelSentByDayByCampaign={funnelStats.sentByDayByCampaign}
        warmupChipStats={warmupChipStats}
        userUid={user?.uid}
        circuitBreakerOpenIds={circuitBreakerOpenConnectionIds}
        onOpenCampaigns={() => setCurrentView('campaigns')}
        onOpenConnections={() => setCurrentView('connections')}
        onOpenContacts={() => setCurrentView('contacts')}
        onNavigateToChat={(phone, name) => openChatNavigate(setCurrentView, phone, name)}
      />
      </div>

      <DDDPulseMap contacts={contacts} campaigns={campaigns} isLive={isBackendConnected} />
      <CommercialIntelligenceMap />
      <ContactAddressMap />

      {campaignGeo && Object.keys(campaignGeo.byUf || {}).length > 0 && (
        <Card className="zm-dash-section">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center brand-soft">
              <span className="text-base">🗺️</span>
            </div>
            <div>
              <h3 className="ui-title text-[15px]">Cobertura Geográfica</h3>
              <p className="ui-subtitle text-[12px]">Distribuição de envios por estado (inferência por DDD)</p>
            </div>
          </div>
          <BrazilCampaignMap
            byUf={campaignGeo.byUf}
            layer={geoLayer}
            onLayerChange={setGeoLayer}
            isLive={false}
            campaignLabel={campaignGeo.campaignId ?? undefined}
            updatedAt={campaignGeo.updatedAt}
          />
        </Card>
      )}

      <div
        ref={funnelSectionRef}
        className="zm-dash-section grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 scroll-mt-6"
      >
        <Card className="zm-funnel-panel lg:col-span-2">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center brand-soft">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="ui-title text-[15px]">Funil de Desempenho</h3>
                <p className="ui-subtitle text-[12px]">
                  Acumulado histórico — persiste após reinícios e exclusão de campanhas
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success" dot>
                Tempo real
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClearFunnel(true)}
                disabled={
                  metrics.totalSent === 0 &&
                  metrics.totalDelivered === 0 &&
                  metrics.totalRead === 0 &&
                  metrics.totalReplied === 0
                }
                title="Zerar contadores do funil"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Limpar
              </Button>
            </div>
          </div>

          <PerformanceFunnel
            sent={metrics.totalSent}
            delivered={metrics.totalDelivered}
            read={metrics.totalRead}
            replied={metrics.totalReplied}
            height={360}
          />

          <div
            className="mt-6 p-4 rounded-2xl flex items-start gap-3.5 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(16,185,129,0.08) 100%)',
              border: '1px solid rgba(245, 158, 11, 0.22)',
              boxShadow: '0 12px 40px -24px rgba(245, 158, 11, 0.45)'
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.12]"
              style={{
                background: 'radial-gradient(600px 120px at 20% 0%, rgba(245,158,11,0.5), transparent 60%)'
              }}
            />
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 relative"
              style={{ background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.35)' }}
            >
              <Zap className="w-5 h-5" style={{ color: '#fbbf24' }} />
            </div>
            <div className="relative min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                Insight operacional
              </p>
              <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {bestWindow ? (
                  <>
                    Os seus clientes mais respondem entre{' '}
                    <strong className="text-[var(--text-1)]">{bestWindow.label}</strong>. Taxa de resposta atual:{' '}
                    <strong style={{ color: replyRate > 0 ? 'var(--brand-600)' : '#f59e0b' }}>{replyRate}%</strong>.
                  </>
                ) : (
                  <>
                    Taxa de resposta atual:{' '}
                    <strong style={{ color: replyRate > 0 ? 'var(--brand-600)' : '#f59e0b' }}>{replyRate}%</strong>.{' '}
                    <span className="text-[var(--text-3)]">
                      {replyRate === 0
                        ? 'Sem respostas registradas ainda — priorize horário e texto do convite.'
                        : 'Continue acompanhando — logo vamos apontar o melhor horário da sua audiência.'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4 min-h-0">
        <Card className="overflow-hidden p-0">
          <div
            className="px-4 pt-4 pb-3 flex items-start justify-between gap-3"
            style={{
              background:
                'linear-gradient(160deg, rgba(236,72,153,0.14) 0%, rgba(147,51,234,0.08) 45%, transparent 100%)',
              borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent)'
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
                style={{
                  background: 'linear-gradient(135deg, rgba(236,72,153,0.35), rgba(168,85,247,0.3))',
                  border: '1px solid rgba(244, 114, 182, 0.45)',
                  boxShadow: '0 8px 24px -8px rgba(236, 72, 153, 0.45)'
                }}
              >
                <Cake className="w-5 h-5 text-white drop-shadow" />
              </div>
              <div className="min-w-0">
                <h3 className="ui-title text-[15px] leading-tight" style={{ color: 'var(--text-1)' }}>
                  Aniversariantes
                </h3>
                <p className="ui-subtitle text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {todaysBirthdays.length > 0
                    ? `${todaysBirthdays.length} hoje · ${weekBirthdays.length} nesta semana`
                    : `Próximos ${BIRTHDAY_RANGE_DAYS} dias no calendário`}
                </p>
              </div>
            </div>
            <div
              className="shrink-0 min-w-[2.5rem] h-8 px-2.5 rounded-full flex items-center justify-center text-[12px] font-bold tabular-nums"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {upcomingBirthdays.length}
            </div>
          </div>

          <div className="px-4 pt-1 pb-4">
            {upcomingBirthdays.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Sparkles className="w-3.5 h-3.5" />}
                className="w-full mb-3 mt-3"
                onClick={openBulkBirthday}
              >
                Felicitar todos ({weekBirthdays.length})
              </Button>
            )}

            <div className="flex-1 overflow-y-auto max-h-[300px] space-y-2 min-h-[11rem]">
              {upcomingBirthdays.length === 0 ? (
                <div
                  className="relative rounded-2xl overflow-hidden mt-2 flex flex-col items-center justify-center text-center px-4 py-9"
                  style={{
                    background:
                      'linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 96%, #ec4899) 0%, var(--surface-1) 100%)',
                    border: '1px solid color-mix(in srgb, var(--border-subtle) 90%, #f472b6)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
                  }}
                >
                  <div
                    className="absolute inset-0 pointer-events-none opacity-[0.35]"
                    style={{
                      background: 'radial-gradient(400px 160px at 50% 0%, rgba(236,72,153,0.3), transparent 65%)'
                    }}
                  />
                  <div
                    className="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
                    style={{
                      background: 'linear-gradient(160deg, rgba(236,72,153,0.2), rgba(168,85,247,0.12))',
                      border: '1px solid rgba(244, 114, 182, 0.25)',
                      boxShadow: '0 12px 32px -16px rgba(236, 72, 153, 0.5)'
                    }}
                  >
                    <Cake className="w-8 h-8" style={{ color: '#f472b6' }} />
                  </div>
                  <p className="relative text-[14px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
                    Nenhum aniversariante próximo
                  </p>
                  <p className="relative text-[12px] mt-1.5 max-w-[16rem] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    Preencha a data de nascimento nos contatos e aparecem aqui, com lembrete e parabéns em um clique.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-4 relative"
                    leftIcon={<Users className="w-3.5 h-3.5" />}
                    rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                    onClick={() => setCurrentView('contacts')}
                  >
                    Ir para Contatos
                  </Button>
                </div>
              ) : (
                upcomingBirthdaysVisible.map((contact) => (
                  <div
                    key={contact.id}
                    className={`p-2.5 rounded-xl transition-all flex items-center justify-between group border ${
                      contact.daysRemaining === 0
                        ? 'border-pink-500/30 bg-pink-500/[0.07] dark:bg-pink-500/10'
                        : 'border-transparent'
                    } hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)]`}
                    style={contact.daysRemaining === 0 ? undefined : { background: 'var(--surface-1)' }}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {contact.profilePicUrl ? (
                        <img
                          src={contact.profilePicUrl}
                          alt={contact.name}
                          className="w-9 h-9 rounded-xl object-cover flex-shrink-0 ring-1 ring-white/10"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/10 text-pink-500">
                          {contact.daysRemaining === 0 ? <Cake className="w-4 h-4" /> : <User className="w-4 h-4" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>
                          {contact.name}
                          {contact.age != null && (
                            <span className="ml-1.5 text-[10.5px] font-normal" style={{ color: 'var(--text-3)' }}>
                              — {contact.age} anos
                            </span>
                          )}
                        </p>
                        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          <Calendar className="w-3 h-3 shrink-0" />
                          <span>{contact.birthdayLabel}</span>
                          {contact.daysRemaining === 0 ? (
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-md font-bold text-[10px] bg-pink-100 dark:bg-pink-500/20 text-pink-600 dark:text-pink-300">
                              Hoje
                            </span>
                          ) : contact.daysRemaining === 1 ? (
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-md font-bold text-[10px] bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                              Amanhã
                            </span>
                          ) : (
                            <span className="ml-0.5" style={{ color: 'var(--text-3)' }}>
                              em {contact.daysRemaining} dias
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenChat(contact)}
                      title="Enviar parabéns agora"
                      className="shrink-0"
                    >
                      <MessageCircle className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                    </Button>
                  </div>
                ))
              )}
              {upcomingBirthdays.length > birthdaysVisible && (
                <button
                  type="button"
                  onClick={() => setBirthdaysVisible((n) => n + DASHBOARD_LIST_PAGE)}
                  className="w-full text-[12px] font-bold py-1.5 rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                  style={{ color: 'var(--brand-600)' }}
                >
                  Mostrar mais ({upcomingBirthdays.length - birthdaysVisible} restantes)
                </button>
              )}
            </div>
          </div>
        </Card>

        {segment === 'religious' && (
        <Card className="overflow-hidden p-0">
          <div
            className="px-4 pt-4 pb-3 flex items-start justify-between gap-3"
            style={{
              background:
                'linear-gradient(160deg, rgba(244,63,94,0.16) 0%, rgba(99,102,241,0.1) 45%, transparent 100%)',
              borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent)'
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
                style={{
                  background: 'linear-gradient(135deg, rgba(244,63,94,0.45), rgba(99,102,241,0.38))',
                  border: '1px solid rgba(251, 113, 133, 0.5)',
                  boxShadow: '0 8px 24px -8px rgba(244, 63, 94, 0.45)'
                }}
              >
                <Heart className="w-5 h-5 text-white drop-shadow" />
              </div>
              <div className="min-w-0">
                <h3 className="ui-title text-[15px] leading-tight" style={{ color: 'var(--text-1)' }}>
                  Bodas de casamento
                </h3>
                <p className="ui-subtitle text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {todaysWeddings.length > 0
                    ? `${todaysWeddings.length} hoje · ${weekWeddings.length} nesta semana`
                    : `Próximos ${BIRTHDAY_RANGE_DAYS} dias (data na ficha de membro)`}
                </p>
              </div>
            </div>
            <div
              className="shrink-0 min-w-[2.5rem] h-8 px-2.5 rounded-full flex items-center justify-center text-[12px] font-bold tabular-nums"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {upcomingWeddings.length}
            </div>
          </div>

          <div className="px-4 pt-1 pb-4">
            {upcomingWeddings.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Sparkles className="w-3.5 h-3.5" />}
                className="w-full mb-3 mt-3"
                onClick={openWeddingBulk}
              >
                Mensagem em massa — bodas da semana ({weekWeddings.length})
              </Button>
            )}

            <div className="flex-1 overflow-y-auto max-h-[300px] space-y-2 min-h-[11rem]">
              {upcomingWeddings.length === 0 ? (
                <div
                  className="relative rounded-2xl overflow-hidden mt-2 flex flex-col items-center justify-center text-center px-4 py-9"
                  style={{
                    background:
                      'linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 96%, #fb7185) 0%, var(--surface-1) 100%)',
                    border: '1px solid color-mix(in srgb, var(--border-subtle) 90%, #fb7185)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
                  }}
                >
                  <Heart className="w-8 h-8 mb-2" style={{ color: '#fb7185' }} />
                  <p className="text-[14px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
                    Nenhuma boda próxima
                  </p>
                  <p className="text-[12px] mt-1.5 max-w-[16rem] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    Preencha a data do casamento e o cônjuge na ficha de membro (Contatos ou aba Ficha membro).
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    leftIcon={<Users className="w-3.5 h-3.5" />}
                    rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                    onClick={() => setCurrentView('contacts')}
                  >
                    Ir para Contatos
                  </Button>
                </div>
              ) : (
                upcomingWeddingsVisible.map((w) => (
                  <div
                    key={w.id}
                    className={`p-2.5 rounded-xl transition-all flex items-center justify-between group border ${
                      w.daysRemaining === 0
                        ? 'border-rose-500/30 bg-rose-500/[0.07] dark:bg-rose-500/10'
                        : 'border-transparent'
                    } hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)]`}
                    style={w.daysRemaining === 0 ? undefined : { background: 'var(--surface-1)' }}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-rose-50 dark:bg-rose-500/10 text-rose-500">
                        {w.daysRemaining === 0 ? <Heart className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>
                          {w.name}
                          {w.yearsCelebrating != null && (
                            <span className="ml-1.5 text-[10.5px] font-normal" style={{ color: 'var(--text-3)' }}>
                              — {w.yearsCelebrating} anos de casados
                            </span>
                          )}
                        </p>
                        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          <Calendar className="w-3 h-3 shrink-0" />
                          <span>
                            Bodas {w.nextLabel}
                            {w.spouseName !== '—' ? ` · com ${w.spouseName}` : ''}
                          </span>
                          {w.daysRemaining === 0 ? (
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-md font-bold text-[10px] bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300">
                              Hoje
                            </span>
                          ) : w.daysRemaining === 1 ? (
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-md font-bold text-[10px] bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                              Amanhã
                            </span>
                          ) : (
                            <span className="ml-0.5" style={{ color: 'var(--text-3)' }}>
                              em {w.daysRemaining} dias
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenWeddingChat(w)}
                      title="Enviar mensagem de bodas"
                      className="shrink-0"
                    >
                      <MessageCircle className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                    </Button>
                  </div>
                ))
              )}
              {upcomingWeddings.length > weddingsVisible && (
                <button
                  type="button"
                  onClick={() => setWeddingsVisible((n) => n + DASHBOARD_LIST_PAGE)}
                  className="w-full text-[12px] font-bold py-1.5 rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                  style={{ color: 'var(--brand-600)' }}
                >
                  Mostrar mais ({upcomingWeddings.length - weddingsVisible} restantes)
                </button>
              )}
            </div>
          </div>
        </Card>
        )}

        {segment === 'religious' && (
          <Card className="overflow-hidden p-0">
            <div
              className="px-4 pt-4 pb-3 flex items-start justify-between gap-3"
              style={{
                background:
                  'linear-gradient(160deg, rgba(16,185,129,0.14) 0%, rgba(59,130,246,0.08) 45%, transparent 100%)',
                borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent)'
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
                  style={{
                    background: 'linear-gradient(135deg, rgba(16,185,129,0.4), rgba(59,130,246,0.32))',
                    border: '1px solid rgba(16,185,129,0.45)',
                    boxShadow: '0 8px 24px -8px rgba(16, 185, 129, 0.35)'
                  }}
                >
                  <MapPin className="w-5 h-5 text-white drop-shadow" />
                </div>
                <div className="min-w-0">
                  <h3 className="ui-title text-[15px] leading-tight" style={{ color: 'var(--text-1)' }}>
                    Próximas visitas
                  </h3>
                  <p className="ui-subtitle text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    Pastoral — agendadas no ZapMass
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setCurrentView('pastoral-visits')}>
                Abrir agenda
              </Button>
            </div>
            <div className="px-4 pt-1 pb-4">
              <div className="flex-1 overflow-y-auto max-h-[220px] space-y-2 min-h-[6rem]">
                {pastoralLoading ? (
                  <p className="text-[12px] py-6 text-center" style={{ color: 'var(--text-3)' }}>
                    A carregar…
                  </p>
                ) : upcomingPastoralVisits.length === 0 ? (
                  <p className="text-[12px] py-6 text-center leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    Nenhuma visita agendada nos próximos dias. Use o menu <strong style={{ color: 'var(--text-2)' }}>Visitas</strong> para
                    planear.
                  </p>
                ) : (
                  upcomingPastoralVisits.slice(0, pastoralVisible).map((v) => {
                    const a = new Date(v.scheduledStartMs);
                    const label = `${a.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })} · ${a.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                    return (
                      <div
                        key={v.id}
                        className="p-2.5 rounded-xl flex items-center justify-between gap-2 group border border-transparent hover:border-[var(--border-subtle)]"
                        style={{ background: 'var(--surface-1)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>
                            {v.contactName}
                            {v.communionNeeded ? (
                              <span className="ml-1.5 text-[10px] font-normal text-amber-600">· ceia</span>
                            ) : null}
                          </p>
                          <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                            <Calendar className="w-3 h-3 shrink-0" />
                            {label}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Pipeline (WhatsApp)"
                            onClick={() => openChatNavigate(setCurrentView, v.phone, v.contactName)}
                          >
                            <MessageCircle className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Descarregar .ics"
                            onClick={() => {
                              downloadPastoralVisitIcs(v);
                              toast.success('Ficheiro .ics descarregado.');
                            }}
                          >
                            <Download className="w-4 h-4" style={{ color: 'var(--text-2)' }} />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
                {upcomingPastoralVisits.length > pastoralVisible && (
                  <button
                    type="button"
                    onClick={() => setPastoralVisible((n) => n + DASHBOARD_LIST_PAGE)}
                    className="w-full text-[12px] font-bold py-1.5 rounded-lg transition-colors hover:bg-[var(--surface-2)]"
                    style={{ color: 'var(--brand-600)' }}
                  >
                    Mostrar mais ({upcomingPastoralVisits.length - pastoralVisible} restantes)
                  </button>
                )}
              </div>
            </div>
          </Card>
        )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="zm-channel-accent" aria-hidden />
          <div className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="ui-title text-[15px]">Canais em destaque</h3>
                <p className="ui-subtitle text-[12px]">
                  {accountSummary.totalChannels > 0
                    ? `${accountSummary.sentToday.toLocaleString('pt-BR')} envios hoje · ${accountSummary.onlineChannels} online`
                    : 'Top envios de hoje'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="neutral">Hoje</Badge>
                {accountSummary.totalChannels > 0 && (
                  <Button type="button" size="xs" variant="ghost" onClick={() => setCurrentView('connections')}>
                    Ver todos
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {channelSpotlight.length === 0 ? (
                <div className="col-span-full py-10 text-center">
                  <div
                    className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                    style={{
                      background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(59,130,246,0.12))',
                      border: '1px solid rgba(16,185,129,0.2)'
                    }}
                  >
                    <Smartphone className="w-7 h-7" style={{ color: 'var(--brand-600)' }} />
                  </div>
                  <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                    Nenhum canal ativo ainda
                  </p>
                  <p className="text-[12px] mt-1 max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
                    Conecte seu primeiro WhatsApp na aba <strong style={{ color: 'var(--text-2)' }}>Canais</strong> para começar a enviar campanhas.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    leftIcon={<Smartphone className="w-4 h-4" />}
                    onClick={() => setCurrentView('connections')}
                  >
                    Conectar canal
                  </Button>
                </div>
              ) : (
                channelSpotlight.map((row) => {
                  const conn = row.connection;
                  const isOnline = conn.status === ConnectionStatus.CONNECTED;
                  const statusColor = isOnline ? '#10b981' : '#f43f5e';
                  const avatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(conn.name)}&background=${isOnline ? '10b981' : '64748b'}&color=fff&size=88&bold=true`;
                  const trendLabel =
                    row.trendPct > 0 ? `+${row.trendPct}%` : row.trendPct < 0 ? `${row.trendPct}%` : 'estável';
                  const trendColor = row.trendPct > 0 ? '#10b981' : row.trendPct < 0 ? '#f43f5e' : 'var(--text-3)';
                  return (
                    <div
                      key={conn.id}
                      className="p-3.5 rounded-xl"
                      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div
                            className="w-11 h-11 rounded-xl overflow-hidden shrink-0"
                            style={{ border: `2px solid ${statusColor}55` }}
                          >
                            <img
                              src={conn.profilePicUrl || avatarFallback}
                              alt={conn.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <p className="font-semibold text-[13px] truncate" style={{ color: 'var(--text-1)' }}>
                                {conn.name}
                              </p>
                              {isOnline ? <Badge variant="success" dot /> : <Badge variant="danger" dot />}
                              <span
                                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                                style={{ background: row.tempBg, color: row.tempColor }}
                              >
                                {row.tempLabel}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                              {conn.phoneNumber || 'Sem número'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[20px] font-bold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                            {row.sentToday}
                          </p>
                          <p className="text-[9px] uppercase font-semibold tracking-widest mt-1" style={{ color: 'var(--text-3)' }}>
                            envios
                          </p>
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <Sparkline values={row.spark} color={row.tempColor} width={88} height={24} id={`spot-${conn.id}`} />
                        <div className="text-right">
                          <p className="text-[9px]" style={{ color: trendColor }}>
                            {trendLabel} vs ontem
                          </p>
                          <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                            {row.weekTotal.toLocaleString('pt-BR')} na semana
                            {(conn.queueSize || 0) > 0 ? ` · fila ${conn.queueSize}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Card>

        {!isAdmin ? (
          <Card
            className="overflow-hidden p-0"
            style={{
              background: 'linear-gradient(180deg, var(--ops-panel-fade) 0%, var(--surface-0) 48%)',
              borderColor: 'var(--border-subtle)'
            }}
          >
            <div className="zm-account-accent" aria-hidden />
            <div className="p-1">
              <CardHeader
                icon={
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'var(--semantic-success-bg)' }}
                  >
                    <Users className="w-[18px] h-[18px] text-emerald-600" aria-hidden />
                  </div>
                }
                title="Resumo da sua conta"
                subtitle="Plano, envios de hoje e próximos passos — sem detalhes técnicos de servidor."
                actions={
                  <Badge variant="neutral" className="text-[10px] hidden sm:inline-flex" dot={isBackendConnected}>
                    {isBackendConnected ? 'Sincronizado' : '…'}
                  </Badge>
                }
              />
            </div>
            <div className="px-4 pb-4 space-y-3">
              <div
                className="rounded-xl px-3 py-2.5"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase" style={{ color: 'var(--text-3)' }}>
                    Canais no plano
                  </span>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                    {planScopedCount} / {maxPlanChannelSlots}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'var(--surface-2)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${planUsagePct}%`,
                      background:
                        atPlanChannelLimit || planUsagePct >= 80
                          ? 'linear-gradient(90deg, var(--warning), #f59e0b)'
                          : 'linear-gradient(90deg, var(--success), #10b981)'
                    }}
                  />
                </div>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
                  {atPlanChannelLimit
                    ? 'Limite atingido — adicione extras na assinatura.'
                    : `Inclui ${BASE_CHANNEL_SLOTS} no plano${
                        typeof subscription?.extraChannelSlots === 'number' && subscription.extraChannelSlots > 0
                          ? ` + ${subscription.extraChannelSlots} extra(s).`
                          : '.'
                      }`}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    label: 'Enviados hoje',
                    value: accountSummary.sentToday.toLocaleString('pt-BR'),
                    icon: <Send className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                  },
                  {
                    label: 'Canais online',
                    value: `${accountSummary.onlineChannels}/${accountSummary.totalChannels}`,
                    icon: <Wifi className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                  },
                  {
                    label: 'Campanhas ativas',
                    value: String(accountSummary.runningCampaigns + accountSummary.scheduledCampaigns),
                    icon: <Rocket className="w-3.5 h-3.5" style={{ color: '#8b5cf6' }} />
                  },
                  {
                    label: 'Lembretes hoje',
                    value: String(accountSummary.followUpsToday),
                    icon: <Calendar className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
                  }
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="rounded-xl px-2.5 py-2"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {kpi.icon}
                      <span className="text-[9px] uppercase font-bold" style={{ color: 'var(--text-3)' }}>
                        {kpi.label}
                      </span>
                    </div>
                    <p className="text-[18px] font-black tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                      {kpi.value}
                    </p>
                  </div>
                ))}
              </div>

              <div
                className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)' }}
              >
                {accountSummary.offlineChannels > 0 ? (
                  <p style={{ color: 'var(--text-2)' }}>
                    <strong style={{ color: '#f59e0b' }}>{accountSummary.offlineChannels} canal(is) offline.</strong>{' '}
                    Reconecte em Canais para não perder disparos.
                  </p>
                ) : bestWindow ? (
                  <p style={{ color: 'var(--text-2)' }}>
                    Melhor horário para disparar hoje: <strong>{bestWindow.label}</strong> (com base nas respostas recentes).
                  </p>
                ) : accountSummary.sentToday === 0 ? (
                  <p style={{ color: 'var(--text-2)' }}>
                    Ainda sem envios hoje. Crie uma campanha ou envie mensagens pelo Pipeline para começar.
                  </p>
                ) : (
                  <p style={{ color: 'var(--text-2)' }}>
                    Tudo sincronizado. Use Campanhas para escalar ou Contatos para retomar conversas quentes.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setCurrentView('connections')}
                  leftIcon={<Smartphone className="w-4 h-4" />}
                >
                  Gerir conexões
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    className="flex-1"
                    onClick={() => setCurrentView('campaigns')}
                    leftIcon={<Rocket className="w-4 h-4" />}
                  >
                    Campanhas
                  </Button>
                  <Button type="button" variant="ghost" className="flex-1" onClick={() => setCurrentView('contacts')}>
                    Contatos
                  </Button>
                </div>
                {atPlanChannelLimit && (
                  <Button type="button" variant="primary" className="w-full" onClick={() => setCurrentView('subscription')}>
                    Assinatura e extras
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <Card
            className="overflow-hidden p-0"
            style={{
              background: 'linear-gradient(180deg, var(--ops-panel-fade) 0%, var(--surface-0) 48%)',
              borderColor: 'var(--border-subtle)'
            }}
          >
            <div className="zm-ops-accent" aria-hidden />
            <div className="p-1">
              <CardHeader
                icon={
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'var(--semantic-info-tint)' }}
                  >
                    <Server className="w-[18px] h-[18px] text-indigo-500" aria-hidden />
                  </div>
                }
                title="Operações de servidor"
                subtitle="Visão rápida da infra. Detalhes completos na aba Operações."
                actions={
                  <Button type="button" size="sm" variant="primary" onClick={() => setCurrentView('admin-ops')}>
                    Abrir operações
                  </Button>
                }
              />
            </div>
            <div className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    label: 'RAM',
                    value: adminOps.ramPct != null ? `${adminOps.ramPct}%` : '—',
                    sub: adminOps.ramTotalGb != null ? `${adminOps.ramTotalGb} GB` : 'A sincronizar',
                    warn: (adminOps.ramPct ?? 0) >= 85
                  },
                  {
                    label: 'Latência',
                    value: adminOps.latencyMs != null ? `${adminOps.latencyMs} ms` : '—',
                    sub: 'Socket',
                    warn: (adminOps.latencyMs ?? 0) >= 400
                  },
                  {
                    label: 'Offline',
                    value: String(adminOps.offlineChannels),
                    sub: 'canais',
                    warn: adminOps.offlineChannels > 0
                  },
                  {
                    label: 'Fila',
                    value: String(adminOps.queueTotal),
                    sub: 'mensagens',
                    warn: adminOps.queueTotal > 50
                  }
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="rounded-xl px-2.5 py-2"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    <p className="text-[9px] uppercase font-bold" style={{ color: 'var(--text-3)' }}>
                      {kpi.label}
                    </p>
                    <p
                      className="text-[18px] font-black tabular-nums leading-none mt-0.5"
                      style={{ color: kpi.warn ? '#f59e0b' : 'var(--text-1)' }}
                    >
                      {kpi.value}
                    </p>
                    <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {kpi.sub}
                    </p>
                  </div>
                ))}
              </div>

              {adminOps.ramPct != null && (
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, adminOps.ramPct)}%`,
                      background:
                        adminOps.ramPct >= 85
                          ? 'linear-gradient(90deg, #f59e0b, #f43f5e)'
                          : 'linear-gradient(90deg, #6366f1, #818cf8)'
                    }}
                  />
                </div>
              )}

              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Conta com <strong style={{ color: 'var(--text-1)' }}>{planScopedCount}</strong> canais ·{' '}
                <strong style={{ color: 'var(--text-1)' }}>{accountSummary.runningCampaigns}</strong> campanha(s) em
                disparo. Host, Docker e integrações ficam na aba <strong>Operações</strong>.
              </p>

              <div
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px]"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                role="status"
              >
                {isBackendConnected ? (
                  <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                )}
                <span style={{ color: 'var(--text-3)' }}>
                  {isBackendConnected ? 'Backend online e sincronizado.' : 'A reconectar ao servidor…'}
                </span>
              </div>
            </div>
          </Card>
        )}
      </div>

      <Modal
        isOpen={!!selectedContact}
        onClose={() => {
          setSelectedContact(null);
          setShowChannelSelector(false);
        }}
        title={selectedContact?.name}
        subtitle={
          selectedContact
            ? `+${selectedContact.phone} - ${selectedContact.birthdayLabel}${
                selectedContact.daysRemaining === 0 ? ' (hoje)' : ''
              }`
            : undefined
        }
        icon={<Cake className="w-4 h-4 text-pink-500" />}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelectedContact(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              leftIcon={<Send className="w-4 h-4" />}
              disabled={!sendingConnectionId || !messageText}
              onClick={handleSendMessage}
            >
              Enviar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="ui-eyebrow mb-1.5 block">Enviando por</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowChannelSelector((v) => !v)}
                className="w-full flex items-center justify-between p-3 rounded-lg transition-all"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 brand-soft">
                    {currentChannel?.profilePicUrl ? (
                      <img src={currentChannel.profilePicUrl} alt="" className="w-8 h-8 rounded-md" />
                    ) : (
                      <Smartphone className="w-4 h-4" />
                    )}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                      {currentChannel?.name || 'Selecione um canal'}
                    </p>
                    <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                      {currentChannel?.phoneNumber || '-'}
                    </p>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              </button>
              {showChannelSelector && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto"
                  style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
                >
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => {
                        setSendingConnectionId(conn.id);
                        setShowChannelSelector(false);
                      }}
                      disabled={conn.status !== ConnectionStatus.CONNECTED}
                      className="w-full flex items-center justify-between p-3 hover:bg-[var(--surface-1)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="text-left min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {conn.name}
                        </p>
                        <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                          {conn.phoneNumber || '-'}
                        </p>
                      </div>
                      {conn.status !== ConnectionStatus.CONNECTED && <Badge variant="danger">Offline</Badge>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="ui-eyebrow mb-1.5 block">Mensagem</label>
            <Textarea
              rows={6}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!selectedWedding}
        onClose={() => {
          setSelectedWedding(null);
          setShowChannelSelector(false);
        }}
        title={selectedWedding?.name}
        subtitle={
          selectedWedding
            ? `+${selectedWedding.phone} · bodas ${selectedWedding.nextLabel}${
                selectedWedding.spouseName !== '—' ? ` · com ${selectedWedding.spouseName}` : ''
              }${selectedWedding.daysRemaining === 0 ? ' (hoje)' : ''}`
            : undefined
        }
        icon={<Heart className="w-4 h-4 text-rose-500" />}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelectedWedding(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              leftIcon={<Send className="w-4 h-4" />}
              disabled={!sendingConnectionId || !weddingMessageText.trim()}
              onClick={handleSendWeddingMessage}
            >
              Enviar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="ui-eyebrow mb-1.5 block">Enviando por</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowChannelSelector((v) => !v)}
                className="w-full flex items-center justify-between p-3 rounded-lg transition-all"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 brand-soft">
                    {currentChannel?.profilePicUrl ? (
                      <img src={currentChannel.profilePicUrl} alt="" className="w-8 h-8 rounded-md" />
                    ) : (
                      <Smartphone className="w-4 h-4" />
                    )}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                      {currentChannel?.name || 'Selecione um canal'}
                    </p>
                    <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                      {currentChannel?.phoneNumber || '-'}
                    </p>
                  </div>
                </div>
                <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              </button>
              {showChannelSelector && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto"
                  style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
                >
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => {
                        setSendingConnectionId(conn.id);
                        setShowChannelSelector(false);
                      }}
                      disabled={conn.status !== ConnectionStatus.CONNECTED}
                      className="w-full flex items-center justify-between p-3 hover:bg-[var(--surface-1)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="text-left min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {conn.name}
                        </p>
                        <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                          {conn.phoneNumber || '-'}
                        </p>
                      </div>
                      {conn.status !== ConnectionStatus.CONNECTED && <Badge variant="danger">Offline</Badge>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="ui-eyebrow mb-1.5 block">Mensagem</label>
            <Textarea rows={6} value={weddingMessageText} onChange={(e) => setWeddingMessageText(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={weddingBulkOpen}
        onClose={() => {
          if (weddingBulkSubmitting) return;
          setWeddingBulkOpen(false);
        }}
        title="Mensagem em massa — bodas da semana"
        subtitle={`${weekWeddings.length} contato(s) com aniversário de casamento nos próximos 7 dias`}
        icon={<Heart className="w-4 h-4 text-rose-500" />}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWeddingBulkOpen(false)} disabled={weddingBulkSubmitting}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              leftIcon={<Send className="w-4 h-4" />}
              disabled={weddingBulkSubmitting || !bulkConnectionId || !weddingBulkTemplate.trim() || weekWeddings.length === 0}
              onClick={() => void handleWeddingBulkSubmit()}
            >
              {weddingBulkSubmitting ? 'A enviar…' : `Disparar para ${weekWeddings.length}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="ui-eyebrow mb-1.5 block">Canal</label>
            <Select value={bulkConnectionId} onChange={(e) => setBulkConnectionId(e.target.value)}>
              {connections.map((c) => (
                <option key={c.id} value={c.id} disabled={c.status !== ConnectionStatus.CONNECTED}>
                  {c.name}
                  {c.status !== ConnectionStatus.CONNECTED ? ' (offline)' : ''}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="ui-eyebrow mb-1.5 block">Texto da mensagem</label>
            <Textarea rows={8} value={weddingBulkTemplate} onChange={(e) => setWeddingBulkTemplate(e.target.value)} />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
              Variáveis: <code>{'{nome}'}</code> <code>{'{conjuge}'}</code> <code>{'{data_bodas}'}</code>{' '}
              <code>{'{anos_casamento}'}</code> <code>{'{anos_line}'}</code>
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bulkBirthdayOpen}
        onClose={() => {
          if (bulkSubmitting) return;
          setBulkBirthdayOpen(false);
          setBulkStep('compose');
        }}
        title={bulkStep === 'compose' ? 'Felicitar aniversariantes' : 'Revise antes de disparar'}
        subtitle={
          bulkStep === 'compose'
            ? 'Monte uma mensagem unica e dispare para todos de uma vez'
            : `Confira exatamente o que cada pessoa vai receber (${bulkSelectedList.length} mensagens)`
        }
        icon={<Sparkles className="w-4 h-4 text-pink-500" />}
        size="lg"
        footer={
          bulkStep === 'compose' ? (
            <>
              <Button variant="ghost" onClick={() => setBulkBirthdayOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                leftIcon={<Sparkles className="w-4 h-4" />}
                disabled={bulkSelectedIds.size === 0 || !bulkConnectionId || !bulkTemplate.trim()}
                onClick={goToPreview}
              >
                Pre-visualizar ({bulkSelectedIds.size})
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setBulkStep('compose')} disabled={bulkSubmitting}>
                Voltar e editar
              </Button>
              <Button
                variant="primary"
                leftIcon={<Send className="w-4 h-4" />}
                disabled={bulkSubmitting}
                onClick={handleBulkBirthdaySubmit}
              >
                {bulkSubmitting ? 'Disparando...' : `Confirmar e disparar para ${bulkSelectedList.length}`}
              </Button>
            </>
          )
        }
      >
        {bulkStep === 'compose' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="ui-eyebrow mb-1.5 block">Canal de envio</label>
              <Select value={bulkConnectionId} onChange={(e) => setBulkConnectionId(e.target.value)}>
                <option value="">Selecione um canal...</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.status !== ConnectionStatus.CONNECTED}>
                    {c.name} {c.status !== ConnectionStatus.CONNECTED ? '(offline)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="ui-eyebrow mb-1.5 block">Periodo dos aniversariantes</label>
              <Select value={bulkDaysRange} onChange={(e) => setBulkDaysRange(Number(e.target.value))}>
                <option value={0}>Apenas hoje</option>
                <option value={1}>Ate amanha</option>
                <option value={3}>Próximos 3 dias</option>
                <option value={7}>Próximos 7 dias</option>
                <option value={15}>Próximos 15 dias</option>
                <option value={30}>Próximos 30 dias</option>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="ui-eyebrow">Mensagem (use variaveis entre chaves)</label>
              <Badge variant="info">{'{nome} {idade} {aniversario}'}</Badge>
            </div>
            <Textarea
              rows={6}
              value={bulkTemplate}
              onChange={(e) => setBulkTemplate(e.target.value)}
              placeholder={DEFAULT_BIRTHDAY_TEMPLATE}
            />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
              Exemplos: <code>{'{nome}'}</code> = primeiro nome, <code>{'{nome_completo}'}</code>, <code>{'{idade}'}</code>, <code>{'{aniversario}'}</code>.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="ui-eyebrow">
                Aniversariantes selecionados ({bulkSelectedIds.size} de {bulkCandidates.length})
              </label>
              <button
                type="button"
                onClick={toggleBulkSelectAll}
                className="text-[11.5px] font-semibold hover:underline"
                style={{ color: 'var(--brand-600)' }}
              >
                {allBulkSelected ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>

            <div
              className="rounded-xl max-h-[260px] overflow-y-auto divide-y"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderColor: 'var(--border-subtle)' }}
            >
              {bulkCandidates.length === 0 ? (
                <div className="py-8 text-center text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                  Nenhum aniversariante no periodo selecionado.
                </div>
              ) : (
                bulkCandidates.map((b) => {
                  const checked = bulkSelectedIds.has(b.id);
                  return (
                    <label
                      key={b.id}
                      className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBulkSelect(b.id)}
                        className="w-4 h-4 accent-pink-500"
                      />
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/10 text-pink-500">
                        {b.daysRemaining === 0 ? <Cake className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {b.name}
                          {b.age != null && (
                            <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>
                              - {b.age} anos
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                          +{b.phone}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {b.birthdayLabel}
                        </p>
                        <p className="text-[10.5px]" style={{ color: b.daysRemaining === 0 ? '#ec4899' : 'var(--text-3)' }}>
                          {b.daysRemaining === 0 ? 'Hoje' : b.daysRemaining === 1 ? 'Amanha' : `em ${b.daysRemaining} dias`}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div
            className="p-3 rounded-xl flex items-start gap-2.5"
            style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.18)' }}
          >
            <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-pink-500" />
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              No proximo passo voce vera <strong>exatamente como cada mensagem ficara</strong>, com o nome de cada pessoa ja preenchido, antes de confirmar o envio.
            </p>
          </div>
        </div>
        ) : (
          <div className="space-y-4">
            {bulkSelectedList.length === 0 ? (
              <div className="py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                Nenhum aniversariante selecionado.
              </div>
            ) : (
              <>
                {/* Navegador entre mensagens */}
                <div
                  className="flex items-center justify-between p-2 rounded-lg"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bulkPreviewIndex === 0}
                    onClick={() => setBulkPreviewIndex((i) => Math.max(0, i - 1))}
                  >
                    ← Anterior
                  </Button>
                  <div className="text-center">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      Mensagem {bulkPreviewIndex + 1} de {bulkSelectedList.length}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Para {bulkSelectedList[bulkPreviewIndex]?.name}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bulkPreviewIndex >= bulkSelectedList.length - 1}
                    onClick={() => setBulkPreviewIndex((i) => Math.min(bulkSelectedList.length - 1, i + 1))}
                  >
                    Proxima →
                  </Button>
                </div>

                {/* Preview da mensagem em estilo WhatsApp */}
                {bulkSelectedList[bulkPreviewIndex] && (() => {
                  const b = bulkSelectedList[bulkPreviewIndex];
                  const rendered = renderTemplate(bulkTemplate, b);
                  return (
                    <div
                      className="rounded-xl p-4"
                      style={{
                        background: 'linear-gradient(135deg, rgba(236,72,153,0.06), rgba(139,92,246,0.06))',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div className="flex items-center gap-3 pb-3 mb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/15 text-pink-500">
                          <User className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                            {b.name}
                          </p>
                          <p className="text-[11.5px] font-mono" style={{ color: 'var(--text-3)' }}>
                            +{b.phone}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                            {b.birthdayLabel}
                          </p>
                          <p
                            className="text-[10.5px] font-bold"
                            style={{ color: b.daysRemaining === 0 ? '#ec4899' : 'var(--text-3)' }}
                          >
                            {b.daysRemaining === 0
                              ? '🎂 Hoje'
                              : b.daysRemaining === 1
                              ? 'Amanha'
                              : `em ${b.daysRemaining} dias`}
                          </p>
                        </div>
                      </div>

                      <div
                        className="rounded-lg p-3 text-[13.5px] whitespace-pre-wrap leading-relaxed"
                        style={{
                          background: 'var(--surface-0)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-1)',
                          maxHeight: '260px',
                          overflowY: 'auto'
                        }}
                      >
                        {rendered || <span style={{ color: 'var(--text-3)' }}>(mensagem vazia)</span>}
                      </div>
                    </div>
                  );
                })()}

                {/* Resumo + miniatura das demais */}
                <div>
                  <p className="ui-eyebrow mb-2">Resumo das {bulkSelectedList.length} mensagens</p>
                  <div
                    className="rounded-xl max-h-[180px] overflow-y-auto divide-y"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    {bulkSelectedList.map((b, idx) => {
                      const preview = renderTemplate(bulkTemplate, b).replace(/\s+/g, ' ').slice(0, 80);
                      const active = idx === bulkPreviewIndex;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBulkPreviewIndex(idx)}
                          className="w-full flex items-center gap-3 p-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                          style={{
                            background: active ? 'rgba(236,72,153,0.08)' : 'transparent'
                          }}
                        >
                          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-pink-50 dark:bg-pink-500/10 text-pink-500 text-[11px] font-bold">
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                              {b.name}
                            </p>
                            <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                              {preview}
                              {preview.length >= 80 ? '...' : ''}
                            </p>
                          </div>
                          {active && <Badge variant="info">atual</Badge>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  className="p-3 rounded-xl flex items-start gap-2.5"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                  <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                    Ao confirmar, uma campanha real sera criada e as mensagens serao enviadas com intervalo anti-ban de 10 segundos. Esta acao <strong>nao pode ser desfeita</strong>.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Confirmacao para zerar contadores do funil */}
      <Modal
        isOpen={confirmClearFunnel}
        onClose={() => setConfirmClearFunnel(false)}
        title="Zerar funil de desempenho?"
        icon={<RotateCcw className="w-5 h-5" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="ghost" onClick={() => setConfirmClearFunnel(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearFunnelStats();
                setConfirmClearFunnel(false);
              }}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Zerar agora
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[13.5px]" style={{ color: 'var(--text-1)' }}>
            Os contadores de <strong>Enviadas</strong>, <strong>Entregues</strong>, <strong>Lidas</strong> e <strong>Respostas</strong> voltarao para zero.
          </p>
          <div
            className="p-3 rounded-xl flex items-start gap-2.5"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              Esta acao nao pode ser desfeita. Suas campanhas, conversas e contatos <strong>nao</strong> sao apagados — apenas os totais do painel.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div
              className="p-2.5 rounded-lg text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Enviadas</p>
              <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                {metrics.totalSent.toLocaleString('pt-BR')}
              </p>
            </div>
            <div
              className="p-2.5 rounded-lg text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Respostas</p>
              <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                {metrics.totalReplied.toLocaleString('pt-BR')}
              </p>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
