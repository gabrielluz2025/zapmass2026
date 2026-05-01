import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryLow,
  CheckCircle2,
  Command,
  Filter,
  Gauge,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pin,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Trophy,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ConnectionStatus, WhatsAppConnection } from '../types';
import { useZapMass } from '../context/ZapMassContext';
import { ConnectionCardNew as ConnectionCard } from './ConnectionCardNew';
import { ConnectionListRow } from './ConnectionListRow';
import { AddConnectionModal } from './AddConnectionModal';
import { SessionLoadIndicator } from './SessionLoadIndicator';
import { SectionHeader, StatCard, Tabs, Input, Button, EmptyState, Modal } from './ui';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useMainLayoutNav } from '../context/MainLayoutNavContext';
import { isAdminUserEmail } from '../utils/adminAccess';
import {
  getMaxConnectionSlotsForUser,
  countAccountScopedConnections,
  MAX_CHANNELS_TOTAL
} from '../utils/connectionLimitPolicy';
import { openChannelExtraPurchaseFlow } from '../utils/openChannelExtraFlow';

type FilterValue = 'ALL' | 'ONLINE' | 'OFFLINE' | 'PAIRING';
type ViewMode = 'grid' | 'list';
type SortKey = 'default' | 'name' | 'sent' | 'queue' | 'uptime' | 'health' | 'battery';

const LS_VIEW = 'zapmass.connections.view';
const LS_PINS = 'zapmass.connections.pins';
const LS_SORT = 'zapmass.connections.sort';
const THROUGHPUT_WINDOW_SAMPLES = 30; // 30 amostras
const THROUGHPUT_SAMPLE_MS = 15_000; // a cada 15s → janela de ~7,5 min

type ThroughputSample = { t: number; total: number };

const loadPins = (): Set<string> => {
  try {
    const raw = localStorage.getItem(LS_PINS);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
};

const savePins = (pins: Set<string>) => {
  try {
    localStorage.setItem(LS_PINS, JSON.stringify(Array.from(pins)));
  } catch {
    /* noop */
  }
};

const loadView = (): ViewMode => {
  const v = localStorage.getItem(LS_VIEW);
  return v === 'list' || v === 'grid' ? v : 'grid';
};

const loadSort = (): SortKey => {
  const v = localStorage.getItem(LS_SORT) as SortKey | null;
  return v && ['default', 'name', 'sent', 'queue', 'uptime', 'health', 'battery'].includes(v)
    ? v
    : 'default';
};

export const ConnectionsTab: React.FC = () => {
  const { connections, addConnection, removeConnection, reconnectConnection, forceQr, renameConnection } =
    useZapMass();
  const { user } = useAuth();
  const { subscription, readOnlyMode, enforce: subEnforce } = useSubscription();
  const goToView = useMainLayoutNav();
  const isAdmin = isAdminUserEmail(user?.email ?? null);
  const maxConnectionSlots = useMemo(
    () => getMaxConnectionSlotsForUser(subscription, isAdmin),
    [subscription, isAdmin]
  );
  const scopedCount = useMemo(
    () => countAccountScopedConnections(connections, user?.uid ?? null),
    [connections, user?.uid]
  );
  const atSlotLimit = !isAdmin && scopedCount >= maxConnectionSlots;
  /** Apos trial / sem plano: nao criar novos canais ate contratar. */
  const blockNewBySubscription = subEnforce && readOnlyMode && !isAdmin;
  const canBuyMoreSlots = !isAdmin && maxConnectionSlots < MAX_CHANNELS_TOTAL;
  const needChannelExtraPurchase = atSlotLimit && canBuyMoreSlots && !blockNewBySubscription;
  const atPlatformMax = !isAdmin && atSlotLimit && maxConnectionSlots >= MAX_CHANNELS_TOTAL;
  const canOpenNameModal = !blockNewBySubscription && scopedCount < maxConnectionSlots;
  const primaryActionDisabled = blockNewBySubscription || atPlatformMax;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterValue>('ALL');
  const [view, setView] = useState<ViewMode>(loadView);
  const [sort, setSort] = useState<SortKey>(loadSort);
  const [pinned, setPinned] = useState<Set<string>>(loadPins);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState<null | 'remove' | 'reconnect'>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(searchTerm);

  // --- persiste preferências ---
  useEffect(() => {
    localStorage.setItem(LS_VIEW, view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem(LS_SORT, sort);
  }, [sort]);
  useEffect(() => {
    savePins(pinned);
  }, [pinned]);

  // --- throughput em tempo real ---
  const throughputRef = useRef<ThroughputSample[]>([]);
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const [throughputTick, setThroughputTick] = useState(0);

  useEffect(() => {
    const sample = () => {
      const total = connectionsRef.current.reduce((acc, c) => acc + c.messagesSentToday, 0);
      const arr = throughputRef.current;
      arr.push({ t: Date.now(), total });
      if (arr.length > THROUGHPUT_WINDOW_SAMPLES) arr.shift();
      setThroughputTick((n) => n + 1);
    };
    sample();
    const id = setInterval(sample, THROUGHPUT_SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  // msgs/min nos últimos ~7min
  const throughput = useMemo(() => {
    void throughputTick; // força dependência
    const arr = throughputRef.current;
    if (arr.length < 2) return { perMin: 0, trend: 0, sparkData: [] as number[] };
    const first = arr[0];
    const last = arr[arr.length - 1];
    const minutes = Math.max(0.25, (last.t - first.t) / 60_000);
    const deltaTotal = Math.max(0, last.total - first.total);
    const perMin = deltaTotal / minutes;

    // tendência: compara metade recente com metade anterior
    const mid = Math.floor(arr.length / 2);
    const half1 = arr.slice(0, mid);
    const half2 = arr.slice(mid);
    const d1 = half1.length > 1 ? half1[half1.length - 1].total - half1[0].total : 0;
    const d2 = half2.length > 1 ? half2[half2.length - 1].total - half2[0].total : 0;
    const trend = d1 > 0 ? ((d2 - d1) / d1) * 100 : d2 > 0 ? 100 : 0;

    // spark: deltas entre samples consecutivos
    const spark: number[] = [];
    for (let i = 1; i < arr.length; i++) {
      spark.push(Math.max(0, arr[i].total - arr[i - 1].total));
    }
    return { perMin, trend, sparkData: spark };
  }, [throughputTick]);

  // --- métricas agregadas ---
  const counts = useMemo(() => {
    const online = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
    const offline = connections.filter((c) => c.status === ConnectionStatus.DISCONNECTED).length;
    const pairing = connections.filter(
      (c) => c.status === ConnectionStatus.QR_READY || c.status === ConnectionStatus.CONNECTING
    ).length;
    const totalSentToday = connections.reduce((acc, c) => acc + c.messagesSentToday, 0);
    const totalQueue = connections.reduce((acc, c) => acc + c.queueSize, 0);
    const lowBattery = connections.filter(
      (c) => c.status === ConnectionStatus.CONNECTED && (c.batteryLevel ?? 100) < 20
    ).length;
    const overloaded = connections.filter(
      (c) => c.status === ConnectionStatus.CONNECTED && c.queueSize > 100
    ).length;
    const idle = connections.filter(
      (c) => c.status === ConnectionStatus.CONNECTED && c.messagesSentToday === 0
    ).length;
    const lowHealth = connections.filter(
      (c) => c.status === ConnectionStatus.CONNECTED && (c.healthScore ?? 100) < 50
    ).length;
    const avgHealth = (() => {
      const onlineConns = connections.filter((c) => c.status === ConnectionStatus.CONNECTED);
      if (onlineConns.length === 0) return 0;
      return Math.round(
        onlineConns.reduce((s, c) => s + (c.healthScore ?? 100), 0) / onlineConns.length
      );
    })();
    return {
      online,
      offline,
      pairing,
      totalSentToday,
      totalQueue,
      lowBattery,
      overloaded,
      idle,
      lowHealth,
      avgHealth
    };
  }, [connections]);

  // --- ranking top 3 do dia (só considera online) ---
  const topPerformers = useMemo(() => {
    return [...connections]
      .filter((c) => c.status === ConnectionStatus.CONNECTED && c.messagesSentToday > 0)
      .sort((a, b) => b.messagesSentToday - a.messagesSentToday)
      .slice(0, 3);
  }, [connections]);

  // --- filtro + ordenação + pin ---
  const sortedFiltered = useMemo(() => {
    const term = deferredSearch.toLowerCase().trim();
    let arr = connections.filter((conn) => {
      const matchesSearch =
        !term ||
        conn.name.toLowerCase().includes(term) ||
        (conn.phoneNumber && conn.phoneNumber.includes(deferredSearch));
      let matchesFilter = true;
      if (filterStatus === 'ONLINE') matchesFilter = conn.status === ConnectionStatus.CONNECTED;
      if (filterStatus === 'OFFLINE')
        matchesFilter = conn.status === ConnectionStatus.DISCONNECTED;
      if (filterStatus === 'PAIRING')
        matchesFilter =
          conn.status === ConnectionStatus.QR_READY ||
          conn.status === ConnectionStatus.CONNECTING;
      return matchesSearch && matchesFilter;
    });

    const sortFn: Record<SortKey, (a: WhatsAppConnection, b: WhatsAppConnection) => number> = {
      default: () => 0,
      name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
      sent: (a, b) => b.messagesSentToday - a.messagesSentToday,
      queue: (a, b) => b.queueSize - a.queueSize,
      uptime: (a, b) => (b.connectedSince ?? 0) - (a.connectedSince ?? 0),
      health: (a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0),
      battery: (a, b) => (a.batteryLevel ?? 101) - (b.batteryLevel ?? 101)
    };
    if (sort !== 'default') arr = [...arr].sort(sortFn[sort]);

    // pinadas no topo
    arr = [...arr].sort((a, b) => {
      const aP = pinned.has(a.id) ? 1 : 0;
      const bP = pinned.has(b.id) ? 1 : 0;
      return bP - aP;
    });

    return arr;
  }, [connections, deferredSearch, filterStatus, sort, pinned]);

  // --- handlers ---
  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        toast('Desafixado', { icon: '📌' });
      } else {
        next.add(id);
        toast('Fixado no topo', { icon: '📌' });
      }
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectMode(false);
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(sortedFiltered.map((c) => c.id)));
  }, [sortedFiltered]);

  const handlePrimaryConnectClick = useCallback(() => {
    if (blockNewBySubscription) {
      toast.error('Assine o ZapMass para criar novos canais. Abra Minha assinatura.');
      return;
    }
    if (atPlatformMax) {
      toast.error('Voce ja esta no maximo de 5 canais. Remova um canal para adicionar outro.');
      return;
    }
    if (needChannelExtraPurchase) {
      openChannelExtraPurchaseFlow();
      toast.success('Abrindo Minha assinatura na secao de canais extras.', { duration: 4500, icon: '📶' });
      return;
    }
    setIsModalOpen(true);
  }, [blockNewBySubscription, atPlatformMax, needChannelExtraPurchase]);

  const requestNewConnection = useCallback(
    (name: string) => {
      if (blockNewBySubscription) {
        toast.error('Assine o ZapMass para criar novos canais. Abra Minha assinatura.');
        return;
      }
      if (!canOpenNameModal) {
        if (needChannelExtraPurchase) {
          openChannelExtraPurchaseFlow();
          toast.success('Abrindo Minha assinatura — canais extras.', { duration: 4500, icon: '📶' });
        } else if (atPlatformMax) {
          toast.error('Voce ja esta no maximo de 5 canais.');
        } else {
          toast.error('Limite de canais atingido.');
        }
        return;
      }
      addConnection(name);
    },
    [addConnection, blockNewBySubscription, canOpenNameModal, needChannelExtraPurchase, atPlatformMax]
  );

  const runBulk = useCallback(
    (kind: 'remove' | 'reconnect') => {
      const ids = Array.from(selected);
      if (kind === 'reconnect') {
        ids.forEach((id) => reconnectConnection(id));
        toast.success(`Reconectando ${ids.length} ${ids.length === 1 ? 'canal' : 'canais'}`);
      } else {
        ids.forEach((id) => removeConnection(id));
        toast.success(`${ids.length} ${ids.length === 1 ? 'canal removido' : 'canais removidos'}`);
      }
      clearSelection();
      setBulkConfirmOpen(null);
    },
    [selected, reconnectConnection, removeConnection, clearSelection]
  );

  // --- atalhos de teclado ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      if (isTyping && e.key !== 'Escape') return;
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'g' || e.key === 'G') {
        setView('grid');
      } else if (e.key === 'l' || e.key === 'L') {
        setView('list');
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (blockNewBySubscription) {
          toast('Assine o plano para criar novos canais.', { icon: '🔒', duration: 4000 });
          return;
        }
        if (atPlatformMax) {
          toast('Voce ja esta no maximo de 5 canais.', { icon: '🔒', duration: 4000 });
          return;
        }
        if (needChannelExtraPurchase) {
          openChannelExtraPurchaseFlow();
          toast.success('Abrindo canais extras em Minha assinatura.', { icon: '📶', duration: 4000 });
          return;
        }
        setIsModalOpen(true);
      } else if (e.key === 'Escape') {
        if (selectMode) clearSelection();
        else if (searchTerm || filterStatus !== 'ALL') {
          setSearchTerm('');
          setFilterStatus('ALL');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectMode,
    searchTerm,
    filterStatus,
    clearSelection,
    blockNewBySubscription,
    atPlatformMax,
    needChannelExtraPurchase
  ]);

  // --- alertas inteligentes ---
  const alerts = useMemo(() => {
    const list: Array<{ id: string; tone: 'danger' | 'warning' | 'info'; text: string; icon: React.ReactNode }> = [];
    if (counts.offline > 0) {
      list.push({
        id: 'offline',
        tone: 'danger',
        icon: <WifiOff className="w-3.5 h-3.5" />,
        text: `${counts.offline} ${counts.offline === 1 ? 'canal offline' : 'canais offline'}`
      });
    }
    if (counts.lowBattery > 0) {
      list.push({
        id: 'battery',
        tone: 'warning',
        icon: <BatteryLow className="w-3.5 h-3.5" />,
        text: `${counts.lowBattery} com bateria baixa (<20%)`
      });
    }
    if (counts.overloaded > 0) {
      list.push({
        id: 'queue',
        tone: 'warning',
        icon: <Activity className="w-3.5 h-3.5" />,
        text: `${counts.overloaded} com fila >100 (sobrecarga)`
      });
    }
    if (counts.lowHealth > 0) {
      list.push({
        id: 'health',
        tone: 'warning',
        icon: <AlertTriangle className="w-3.5 h-3.5" />,
        text: `${counts.lowHealth} com saúde abaixo de 50%`
      });
    }
    if (counts.idle > 0 && counts.online >= 2) {
      list.push({
        id: 'idle',
        tone: 'info',
        icon: <Sparkles className="w-3.5 h-3.5" />,
        text: `${counts.idle} ${counts.idle === 1 ? 'canal ocioso' : 'canais ociosos'} (sem envios hoje) — redistribua a carga`
      });
    }
    return list;
  }, [counts]);

  const forecastToday = useMemo(() => {
    if (throughput.perMin <= 0) return null;
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const minsLeft = Math.max(0, (endOfDay.getTime() - now.getTime()) / 60_000);
    return Math.round(counts.totalSentToday + throughput.perMin * minsLeft);
  }, [throughput.perMin, counts.totalSentToday]);

  return (
    <div className="space-y-5 pb-8">
      {/* HEADER */}
      <SectionHeader
        eyebrow={
          <>
            <Radio className="w-3 h-3" />
            Central de Comando da Frota
          </>
        }
        title="Conexões WhatsApp"
        description="Controle, monitore e otimize sua frota de canais WhatsApp em tempo real."
        icon={<Radio className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
        actions={
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <p className="text-[11px] order-2 sm:order-1" style={{ color: 'var(--text-3)' }}>
              {isAdmin
                ? 'Criador: sem teto padrão de canais no painel.'
                : `Canais usados: ${Math.min(scopedCount, maxConnectionSlots)}/${maxConnectionSlots} (máx. ${MAX_CHANNELS_TOTAL} com extras).`}{' '}
              {!isAdmin && (
                <span>
                  O limite contratado é aplicado por plano (1 a 5 canais).
                </span>
              )}
            </p>
            <div className="flex items-center gap-2 order-1 sm:order-2 sm:shrink-0">
              <SessionLoadIndicator compact />
              <KeyboardHintButton />
              <Button
                variant="primary"
                size="lg"
                leftIcon={needChannelExtraPurchase ? <Radio className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                disabled={primaryActionDisabled}
                title={
                  blockNewBySubscription
                    ? 'Assine o plano para adicionar canais.'
                    : atPlatformMax
                      ? 'Limite de 5 canais atingido. Remova um canal para adicionar outro.'
                      : needChannelExtraPurchase
                        ? 'Adquirir canais extras (3.º em diante) em Minha assinatura'
                        : 'Adicionar conexão'
                }
                onClick={handlePrimaryConnectClick}
              >
                {needChannelExtraPurchase ? 'Adquirir mais canais' : 'Conectar WhatsApp'}
              </Button>
              {primaryActionDisabled && !blockNewBySubscription && atPlatformMax && (
                <Button variant="secondary" size="sm" onClick={() => goToView('subscription')}>
                  Minha assinatura
                </Button>
              )}
              {blockNewBySubscription && (
                <Button variant="secondary" size="sm" onClick={() => goToView('subscription')}>
                  Ver planos
                </Button>
              )}
            </div>
          </div>
        }
      />

      {!isAdmin && !blockNewBySubscription && (
        <div
          className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed"
          style={{
            background: needChannelExtraPurchase
              ? 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(6,182,212,0.08))'
              : 'var(--surface-0)',
            border: `1px solid ${needChannelExtraPurchase ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)'}`
          }}
        >
          <p className="font-bold mb-0.5" style={{ color: 'var(--text-1)' }}>
            Plano e canais WhatsApp
          </p>
          <p style={{ color: 'var(--text-2)' }}>
            O limite de canais segue o plano contratado (de <strong>1 a {MAX_CHANNELS_TOTAL}</strong>). Quando
            precisar de mais canais, use <strong>Adquirir mais canais</strong> para abrir a assinatura na secção certa.
          </p>
          {needChannelExtraPurchase && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="text-[11.5px] font-semibold rounded-md px-2 py-0.5"
                style={{ background: 'rgba(16,185,129,0.2)', color: 'var(--text-1)' }}
              >
                Atingiu os {maxConnectionSlots} canais contratados — adquira slots extra para o próximo
              </span>
              <Button size="sm" variant="primary" onClick={handlePrimaryConnectClick}>
                Abrir canais extras
              </Button>
            </div>
          )}
        </div>
      )}

      {/* KPI GRID - 4 colunas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Canais Online"
          value={`${counts.online}/${connections.length}`}
          helper={
            connections.length === 0
              ? 'Adicione seu primeiro canal'
              : counts.online === connections.length
              ? 'Frota 100% ativa'
              : `${counts.offline + counts.pairing} precisam de atenção`
          }
          icon={<Wifi className="w-4 h-4" />}
          accent={counts.online === 0 ? 'warning' : counts.online === connections.length ? 'success' : 'default'}
        />
        <StatCard
          label="Disparos Hoje"
          value={counts.totalSentToday.toLocaleString('pt-BR')}
          helper={
            forecastToday !== null && forecastToday > counts.totalSentToday
              ? `Projeção: ~${forecastToday.toLocaleString('pt-BR')} até 23:59`
              : counts.totalSentToday > 0
              ? 'Aguardando próximo envio'
              : 'Nenhum envio ainda'
          }
          icon={<Activity className="w-4 h-4" />}
        />
        <StatCard
          label="Fila Global"
          value={counts.totalQueue.toLocaleString('pt-BR')}
          helper={
            counts.totalQueue > 200
              ? 'Alta demanda'
              : counts.totalQueue > 0
              ? 'Fluxo normal'
              : 'Fila vazia'
          }
          icon={<Activity className="w-4 h-4" />}
          accent={counts.totalQueue > 200 ? 'warning' : 'default'}
        />
        <StatCard
          label="Saúde da Frota"
          value={`${counts.avgHealth}%`}
          helper={
            counts.avgHealth >= 80
              ? 'Frota saudável'
              : counts.avgHealth >= 50
              ? 'Monitorar'
              : 'Intervenção urgente'
          }
          icon={<Gauge className="w-4 h-4" />}
          accent={counts.avgHealth >= 80 ? 'success' : counts.avgHealth >= 50 ? 'default' : 'warning'}
        />
      </div>

      {/* PAINEL THROUGHPUT + RANKING */}
      {connections.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Throughput card */}
          <div
            className="lg:col-span-2 ui-card relative overflow-hidden"
            style={{ padding: 18 }}
          >
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.08]"
              style={{
                background:
                  'radial-gradient(700px 160px at 10% 0%, var(--brand-600), transparent 60%)'
              }}
              aria-hidden
            />
            <div className="relative flex items-start justify-between gap-3 mb-3">
              <div>
                <p
                  className="text-[10.5px] font-bold uppercase tracking-[0.12em] mb-1"
                  style={{ color: 'var(--text-3)' }}
                >
                  Throughput da frota
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-[32px] font-extrabold tabular-nums leading-none"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {throughput.perMin < 10
                      ? throughput.perMin.toFixed(1)
                      : Math.round(throughput.perMin)}
                  </span>
                  <span className="text-[13px] font-bold" style={{ color: 'var(--text-3)' }}>
                    msgs/min
                  </span>
                </div>
                <p className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                  Média dos últimos ~
                  {Math.round(
                    ((throughput.sparkData.length + 1) * THROUGHPUT_SAMPLE_MS) / 60_000
                  )}{' '}
                  min
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {throughput.trend !== 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{
                      background:
                        throughput.trend > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                      color: throughput.trend > 0 ? '#10b981' : '#ef4444',
                      border: `1px solid ${
                        throughput.trend > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'
                      }`
                    }}
                  >
                    {throughput.trend > 0 ? '↗' : '↘'} {Math.abs(Math.round(throughput.trend))}%
                  </span>
                )}
                {forecastToday !== null && forecastToday > counts.totalSentToday && (
                  <span
                    className="text-[10.5px] font-semibold"
                    style={{ color: 'var(--text-3)' }}
                  >
                    Projeção dia:{' '}
                    <strong style={{ color: 'var(--text-1)' }}>
                      {forecastToday.toLocaleString('pt-BR')}
                    </strong>
                  </span>
                )}
              </div>
            </div>
            {/* Sparkline */}
            <ThroughputSpark data={throughput.sparkData} />
          </div>

          {/* Ranking top 3 */}
          <div className="ui-card" style={{ padding: 18 }}>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #f59e0b33, #d9770622)',
                  border: '1px solid rgba(245,158,11,0.3)'
                }}
              >
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div>
                <h3 className="ui-title text-[13.5px]">Top do dia</h3>
                <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  Canais que mais dispararam hoje
                </p>
              </div>
            </div>
            {topPerformers.length === 0 ? (
              <p
                className="text-[11.5px] text-center py-3"
                style={{ color: 'var(--text-3)' }}
              >
                Nenhum envio registrado ainda
              </p>
            ) : (
              <div className="space-y-1.5">
                {topPerformers.map((conn, idx) => (
                  <PodiumRow key={conn.id} rank={idx + 1} conn={conn} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ALERTAS INTELIGENTES */}
      {alerts.length > 0 && (
        <div
          className="ui-card flex flex-wrap items-center gap-2"
          style={{ padding: 12 }}
        >
          <span
            className="text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1.5 shrink-0 pr-2 mr-1"
            style={{ color: 'var(--text-3)', borderRight: '1px solid var(--border-subtle)' }}
          >
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
            Alertas
          </span>
          {alerts.map((a) => (
            <AlertChip key={a.id} tone={a.tone} icon={a.icon}>
              {a.text}
            </AlertChip>
          ))}
        </div>
      )}

      {/* BARRA DE CONTROLES */}
      <div className="ui-card" style={{ padding: 12 }}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <Tabs
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as FilterValue)}
            items={[
              { id: 'ALL', label: `Todas (${connections.length})` },
              { id: 'ONLINE', label: `Online (${counts.online})`, icon: <Wifi className="w-3.5 h-3.5" /> },
              { id: 'OFFLINE', label: `Offline (${counts.offline})`, icon: <WifiOff className="w-3.5 h-3.5" /> },
              { id: 'PAIRING', label: `Pareando (${counts.pairing})`, icon: <QrCode className="w-3.5 h-3.5" /> }
            ]}
          />
          <div className="flex-1 min-w-0">
            <Input
              ref={searchInputRef}
              leftIcon={<Search className="w-4 h-4" />}
              placeholder="Buscar por nome ou número... (/ para focar)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SortSelect value={sort} onChange={setSort} />
            <ViewToggle value={view} onChange={setView} />
            <button
              type="button"
              onClick={() => {
                setSelectMode((v) => !v);
                if (selectMode) clearSelection();
              }}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition-colors"
              style={{
                background: selectMode ? 'var(--brand-600)' : 'var(--surface-1)',
                color: selectMode ? '#fff' : 'var(--text-2)',
                border: `1px solid ${selectMode ? 'var(--brand-600)' : 'var(--border-subtle)'}`
              }}
              title="Modo seleção em lote"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {selectMode ? 'Cancelar' : 'Lote'}
            </button>
          </div>
        </div>
      </div>

      {/* BULK ACTION BAR */}
      {selectMode && selected.size > 0 && (
        <div
          className="sticky top-2 z-30 flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{
            background: 'var(--surface)',
            border: '1.5px solid var(--brand-600)',
            boxShadow: '0 12px 30px -10px rgba(16,185,129,0.35)'
          }}
        >
          <span
            className="text-[12.5px] font-bold flex items-center gap-2"
            style={{ color: 'var(--text-1)' }}
          >
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
            {selected.size} selecionado{selected.size === 1 ? '' : 's'}
          </span>
          <button
            onClick={selectAllVisible}
            className="text-[11.5px] font-semibold underline underline-offset-2"
            style={{ color: 'var(--text-2)' }}
          >
            Selecionar todos visíveis ({sortedFiltered.length})
          </button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => setBulkConfirmOpen('reconnect')}
          >
            Reconectar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() => setBulkConfirmOpen('remove')}
          >
            Remover
          </Button>
          <button
            onClick={clearSelection}
            className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors"
            style={{ color: 'var(--text-3)' }}
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* LISTA/GRID */}
      {sortedFiltered.length > 0 ? (
        view === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
            {sortedFiltered.map((connection) => {
              const isPinned = pinned.has(connection.id);
              const isSel = selected.has(connection.id);
              return (
                <div key={connection.id} className="relative group">
                  {selectMode && (
                    <button
                      onClick={() => toggleSelect(connection.id)}
                      className="absolute top-2 left-2 z-20 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                      style={{
                        background: isSel ? 'var(--brand-600)' : 'var(--surface)',
                        border: `2px solid ${isSel ? 'var(--brand-600)' : 'var(--border)'}`,
                        color: '#fff',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.15)'
                      }}
                      title="Selecionar"
                    >
                      {isSel && <CheckCircle2 className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => togglePin(connection.id)}
                    className={`absolute top-2 right-2 z-20 inline-flex items-center gap-1 rounded-full transition-all ${
                      isPinned
                        ? 'px-2 py-0.5 opacity-100'
                        : 'p-1.5 opacity-0 group-hover:opacity-100'
                    }`}
                    style={
                      isPinned
                        ? {
                            background: 'var(--brand-600)',
                            color: '#fff',
                            boxShadow: '0 4px 10px rgba(16,185,129,0.4)'
                          }
                        : {
                            background: 'var(--surface)',
                            color: 'var(--text-3)',
                            border: '1px solid var(--border-subtle)',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                          }
                    }
                    title={isPinned ? 'Desafixar' : 'Fixar no topo'}
                  >
                    <Pin className={`w-3 h-3 ${isPinned ? 'fill-current' : ''}`} />
                    {isPinned && (
                      <span className="text-[9px] font-bold uppercase tracking-wider">Fixado</span>
                    )}
                  </button>
                  <ConnectionCard
                    connection={connection}
                    onDisconnect={removeConnection}
                    onReconnect={reconnectConnection}
                    onForceQr={forceQr}
                    onRename={renameConnection}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {sortedFiltered.map((connection) => (
              <ConnectionListRow
                key={connection.id}
                connection={connection}
                isPinned={pinned.has(connection.id)}
                isSelected={selected.has(connection.id)}
                selectMode={selectMode}
                onTogglePin={togglePin}
                onToggleSelect={toggleSelect}
                onReconnect={reconnectConnection}
                onForceQr={forceQr}
                onDisconnect={removeConnection}
              />
            ))}
          </div>
        )
      ) : (
        <EmptyState
          icon={<Filter className="w-6 h-6" style={{ color: 'var(--brand-600)' }} />}
          title={
            searchTerm
              ? 'Nenhum resultado'
              : filterStatus !== 'ALL'
              ? 'Sem conexões neste filtro'
              : 'Adicione seu primeiro canal'
          }
          description={
            searchTerm
              ? `Nada encontrado para "${searchTerm}". Ajuste sua busca ou limpe o filtro.`
              : filterStatus !== 'ALL'
              ? 'Nenhuma conexão corresponde ao filtro selecionado no momento.'
              : 'Conecte um número WhatsApp para começar a disparar com segurança.'
          }
          action={
            !searchTerm && filterStatus === 'ALL' ? (
              <Button
                variant="primary"
                leftIcon={<Plus className="w-4 h-4" />}
                disabled={primaryActionDisabled}
                onClick={handlePrimaryConnectClick}
              >
                {needChannelExtraPurchase ? 'Adquirir mais canais' : 'Conectar WhatsApp'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchTerm('');
                  setFilterStatus('ALL');
                }}
              >
                Limpar filtros
              </Button>
            )
          }
        />
      )}

      <AddConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={requestNewConnection}
      />

      {/* Confirmação de ação em lote */}
      <Modal
        isOpen={bulkConfirmOpen !== null}
        onClose={() => setBulkConfirmOpen(null)}
        title={bulkConfirmOpen === 'remove' ? 'Remover canais' : 'Reconectar canais'}
      >
        <div className="space-y-4">
          <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {bulkConfirmOpen === 'remove' ? (
              <>
                Essa ação vai remover <strong>{selected.size}</strong>{' '}
                {selected.size === 1 ? 'canal' : 'canais'} selecionado
                {selected.size === 1 ? '' : 's'}. A sessão local será apagada.
              </>
            ) : (
              <>
                Reconectar <strong>{selected.size}</strong>{' '}
                {selected.size === 1 ? 'canal' : 'canais'}? Cada um vai reiniciar o WhatsApp Web.
              </>
            )}
          </p>
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" onClick={() => setBulkConfirmOpen(null)}>
              Cancelar
            </Button>
            <Button
              variant={bulkConfirmOpen === 'remove' ? 'primary' : 'primary'}
              onClick={() => bulkConfirmOpen && runBulk(bulkConfirmOpen)}
            >
              {bulkConfirmOpen === 'remove' ? 'Remover tudo' : 'Reconectar todos'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ---------- Subcomponentes ----------

const AlertChip: React.FC<{
  tone: 'danger' | 'warning' | 'info';
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ tone, icon, children }) => {
  const tones = {
    danger: { bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.3)', fg: '#ef4444' },
    warning: { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.3)', fg: '#d97706' },
    info: { bg: 'rgba(59,130,246,0.1)', bd: 'rgba(59,130,246,0.28)', fg: '#2563eb' }
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
      style={{ background: tones.bg, border: `1px solid ${tones.bd}`, color: tones.fg }}
    >
      {icon}
      {children}
    </span>
  );
};

const ThroughputSpark: React.FC<{ data: number[] }> = ({ data }) => {
  const max = Math.max(1, ...data);
  return (
    <div className="relative h-[58px] flex items-end gap-[2px]">
      {data.length === 0 ? (
        <div
          className="absolute inset-0 flex items-center justify-center text-[11px]"
          style={{ color: 'var(--text-3)' }}
        >
          Coletando amostras…
        </div>
      ) : (
        data.map((v, i) => {
          const h = Math.max(2, Math.round((v / max) * 56));
          const isLast = i === data.length - 1;
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-all duration-300"
              style={{
                height: h,
                background: isLast
                  ? 'linear-gradient(180deg, var(--brand-500), var(--brand-700))'
                  : 'linear-gradient(180deg, rgba(16,185,129,0.55), rgba(16,185,129,0.2))',
                minWidth: 3,
                boxShadow: isLast ? '0 0 8px rgba(16,185,129,0.5)' : undefined
              }}
              title={`${v} msgs`}
            />
          );
        })
      )}
      {/* baseline */}
      <div
        className="absolute left-0 right-0 bottom-0 h-px"
        style={{ background: 'var(--border-subtle)' }}
      />
    </div>
  );
};

const PodiumRow: React.FC<{ rank: number; conn: WhatsAppConnection }> = ({ rank, conn }) => {
  const medals = ['#f59e0b', '#94a3b8', '#b45309'];
  const color = medals[rank - 1] || 'var(--text-3)';
  const labels = ['🥇', '🥈', '🥉'];
  return (
    <div
      className="flex items-center gap-2.5 p-2 rounded-lg transition-colors"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
    >
      <span className="text-[15px] w-5 text-center shrink-0">{labels[rank - 1] || `${rank}º`}</span>
      <div
        className="w-7 h-7 rounded-lg overflow-hidden shrink-0"
        style={{ border: `1.5px solid ${color}55` }}
      >
        {conn.profilePicUrl ? (
          <img src={conn.profilePicUrl} alt={conn.name} className="w-full h-full object-cover" />
        ) : (
          <img
            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
              conn.name
            )}&background=10b981&color=fff&size=56&bold=true`}
            className="w-full h-full object-cover"
            alt=""
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="text-[12px] font-bold truncate leading-tight"
          style={{ color: 'var(--text-1)' }}
        >
          {conn.name}
        </p>
        <p
          className="text-[10.5px] font-mono truncate"
          style={{ color: 'var(--text-3)' }}
        >
          {conn.phoneNumber || '—'}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p
          className="text-[14px] font-extrabold tabular-nums leading-none"
          style={{ color: 'var(--text-1)' }}
        >
          {conn.messagesSentToday.toLocaleString('pt-BR')}
        </p>
        <p className="text-[9.5px] font-bold uppercase" style={{ color: 'var(--text-3)' }}>
          envios
        </p>
      </div>
    </div>
  );
};

const SortSelect: React.FC<{ value: SortKey; onChange: (v: SortKey) => void }> = ({
  value,
  onChange
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const options: Array<{ id: SortKey; label: string }> = [
    { id: 'default', label: 'Ordem padrão' },
    { id: 'name', label: 'Nome (A–Z)' },
    { id: 'sent', label: 'Mais disparos hoje' },
    { id: 'queue', label: 'Maior fila' },
    { id: 'uptime', label: 'Maior uptime' },
    { id: 'health', label: 'Melhor saúde' },
    { id: 'battery', label: 'Bateria mais baixa' }
  ];
  const current = options.find((o) => o.id === value) || options[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-2 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition-colors"
        style={{
          background: 'var(--surface-1)',
          color: 'var(--text-2)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
        {current.label}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-xl z-30 py-1 min-w-[200px]"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: '0 20px 40px -12px rgba(0,0,0,0.35)'
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--surface-1)]"
              style={{
                color: value === opt.id ? 'var(--brand-600)' : 'var(--text-1)',
                fontWeight: value === opt.id ? 700 : 500
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ViewToggle: React.FC<{ value: ViewMode; onChange: (v: ViewMode) => void }> = ({
  value,
  onChange
}) => (
  <div
    className="flex items-center rounded-lg overflow-hidden"
    style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
  >
    {(
      [
        { id: 'grid' as ViewMode, icon: <LayoutGrid className="w-3.5 h-3.5" />, label: 'Grid' },
        { id: 'list' as ViewMode, icon: <List className="w-3.5 h-3.5" />, label: 'Lista' }
      ]
    ).map((opt) => (
      <button
        key={opt.id}
        type="button"
        onClick={() => onChange(opt.id)}
        className="flex items-center gap-1 px-2.5 py-2 text-[11.5px] font-semibold transition-colors"
        style={{
          background: value === opt.id ? 'var(--brand-600)' : 'transparent',
          color: value === opt.id ? '#fff' : 'var(--text-2)'
        }}
        title={opt.label}
      >
        {opt.icon}
      </button>
    ))}
  </div>
);

const KeyboardHintButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden sm:inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-colors"
        style={{
          background: 'var(--surface-1)',
          color: 'var(--text-3)',
          border: '1px solid var(--border-subtle)'
        }}
        title="Atalhos de teclado"
      >
        <Command className="w-3.5 h-3.5" />
        Atalhos
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Atalhos de teclado">
        <div className="space-y-2">
          {[
            { k: '/', d: 'Focar campo de busca' },
            { k: 'G', d: 'Visualização em grade' },
            { k: 'L', d: 'Visualização em lista' },
            { k: 'N', d: 'Nova conexão' },
            { k: 'Esc', d: 'Limpar filtros ou seleção' }
          ].map((row) => (
            <div
              key={row.k}
              className="flex items-center justify-between py-1.5"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <span className="text-[13px]" style={{ color: 'var(--text-2)' }}>
                {row.d}
              </span>
              <kbd
                className="text-[11px] font-bold px-2 py-0.5 rounded-md tabular-nums"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)'
                }}
              >
                {row.k}
              </kbd>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};
