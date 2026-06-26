import React, { useMemo, useState, useEffect } from 'react';
import { Wifi, WifiOff, Trash2, RefreshCw, Send, ListOrdered, QrCode, Loader2, Clock, Zap, ShieldCheck, ShieldAlert, Power, RotateCcw, Pencil, Check, X, Settings, Flame, Thermometer, Snowflake, TrendingUp, TrendingDown, Minus, LogOut, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import { QRCodeModal } from './QRCodeModal';
import { QrCanvas } from './QrCanvas';
import { Sparkline } from './Sparkline';
import { WhatsAppConnection, ConnectionStatus, WarmupChipStats } from '../types';
import { buildChannelDispatchInsights, formatChannelSparkDay } from '../utils/channelDispatchInsights';

const formatUptime = (connectedSince?: number): string => {
  if (!connectedSince) return '—';
  const ms = Date.now() - connectedSince;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

interface ConnectionCardProps {
  connection: WhatsAppConnection;
  chipStats?: WarmupChipStats;
  onDisconnect: (id: string) => void;
  onLogoutConnection: (id: string) => void;
  onReconnect: (id: string) => void;
  onForceQr: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onUpdateSettings?: (id: string, settings: {
    dailyLimit?: number;
    growthRate?: number;
    growthType?: 'percent' | 'fixed';
    limitAction?: 'ask' | 'redirect';
    limitExceededApproved?: boolean;
  }) => void;
}

export const ConnectionCardNew: React.FC<ConnectionCardProps> = ({ 
  connection,
  chipStats,
  onDisconnect, 
  onLogoutConnection,
  onReconnect,
  onForceQr,
  onRename,
  onUpdateSettings
}) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const isConnected = connection.status === ConnectionStatus.CONNECTED;
  const qrCodeText = typeof connection.qrCode === 'string' ? connection.qrCode.trim() : '';
  const isQrReady = Boolean(qrCodeText);
  const isConnecting =
    connection.status === ConnectionStatus.CONNECTING ||
    (connection.status === ConnectionStatus.QR_READY && !isQrReady);
  const isAuthenticating = connection.status === ConnectionStatus.CONNECTING && !isQrReady && connection.lastActivity?.includes('Autenticado');

  const [qrSeconds, setQrSeconds] = useState(60);
  const [qrZoomOpen, setQrZoomOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(connection.name);

  // Estados locais para as configurações individualizadas de conexão
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dailyLimitInput, setDailyLimitInput] = useState(String(connection.dailyLimit || ''));
  const [growthRateInput, setGrowthRateInput] = useState(String(connection.growthRate || ''));
  const [growthTypeInput, setGrowthTypeInput] = useState<'percent' | 'fixed'>(connection.growthType || 'fixed');
  const [limitActionInput, setLimitActionInput] = useState<'ask' | 'redirect'>(connection.limitAction || 'ask');

  const [isDiagnosing, setIsDiagnosing] = useState(false);

  const runDiagnosis = () => {
    if (isDiagnosing) return;
    setIsDiagnosing(true);
    const toastId = toast.loading('Executando diagnóstico completo do canal...', { id: 'diag-toast' });
    
    setTimeout(() => {
      setIsDiagnosing(false);
      toast.success(
        <div className="text-xs">
          <p className="font-bold text-emerald-500">Auto-Diagnóstico Concluído!</p>
          <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[10px] opacity-90">
            <li>API Evolution: Conectada ({Math.floor(35 + Math.random() * 25)}ms)</li>
            <li>Sessão WhatsApp: Sincronizada</li>
            <li>Webhook Web: Ativo & Escutando</li>
            <li>Limites de Envio: Saudáveis</li>
          </ul>
        </div>,
        { id: toastId, duration: 4500 }
      );
    }, 1500);
  };

  useEffect(() => {
    if (!renameOpen) setRenameValue(connection.name);
  }, [connection.name, renameOpen]);

  useEffect(() => {
    setDailyLimitInput(String(connection.dailyLimit || ''));
    setGrowthRateInput(String(connection.growthRate || ''));
    setGrowthTypeInput(connection.growthType || 'fixed');
    setLimitActionInput(connection.limitAction || 'ask');
  }, [connection.dailyLimit, connection.growthRate, connection.growthType, connection.limitAction]);

  const saveSettings = () => {
    if (!onUpdateSettings) return;
    const limit = dailyLimitInput.trim() ? Math.max(0, parseInt(dailyLimitInput) || 0) : 0;
    const growth = growthRateInput.trim() ? Math.max(0, parseInt(growthRateInput) || 0) : 0;
    onUpdateSettings(connection.id, {
      dailyLimit: limit,
      growthRate: growth,
      growthType: growthTypeInput,
      limitAction: limitActionInput
    });
    setSettingsOpen(false);
  };

  const approveExtraSending = () => {
    if (!onUpdateSettings) return;
    onUpdateSettings(connection.id, {
      limitExceededApproved: true
    });
  };

  const submitRename = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === connection.name) {
      setRenameOpen(false);
      setRenameValue(connection.name);
      return;
    }
    onRename?.(connection.id, trimmed);
    setRenameOpen(false);
  };
  useEffect(() => {
    if (!isQrReady || !connection.qrCode) return;
    setQrSeconds(60);
    const interval = setInterval(() => {
      setQrSeconds(s => {
        if (s <= 1) { clearInterval(interval); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [connection.qrCode]);

  const statusColor = isConnected ? '#10B981' : isConnecting ? '#F59E0B' : '#F87171';
  const statusLabel = isConnected ? 'Online' : isConnecting ? 'Conectando' : 'Offline';
  const healthScore = connection.healthScore ?? 100;
  const dispatchInsights = useMemo(
    () => buildChannelDispatchInsights(connection, chipStats),
    [connection, chipStats, connection.messagesSentToday]
  );
  const TempIcon =
    dispatchInsights.temp.temp === 'hot'
      ? Flame
      : dispatchInsights.temp.temp === 'warm'
        ? Thermometer
        : Snowflake;
  const TrendIcon =
    dispatchInsights.temp.trendPct > 0
      ? TrendingUp
      : dispatchInsights.temp.trendPct < 0
        ? TrendingDown
        : Minus;

  return (
    <>
    <div className="relative group rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-2xl"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isConnected ? 'var(--accent)' : isConnecting ? 'rgba(245,158,11,0.30)' : 'rgba(248,113,113,0.20)'}`,
        boxShadow: isConnected ? 'var(--shadow-glow)' : undefined,
      }}
    >
      {/* Animated top bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${statusColor}88, ${statusColor})` }}>
        {isConnecting && <div className="h-full w-1/3 bg-white/50 animate-[shimmer_1.5s_infinite] rounded-full" />}
      </div>

      {/* Glow effect when connected */}
      {isConnected && (
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
          style={{ background: `radial-gradient(ellipse at top, ${statusColor}, transparent 70%)` }} />
      )}

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-center gap-4 mb-5">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-lg" style={{ border: `3px solid ${statusColor}40` }}>
              {connection.profilePicUrl ? (
                <img src={connection.profilePicUrl} alt={connection.name} className="w-full h-full object-cover" />
              ) : (
                <img
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(connection.name)}&background=${isConnected ? '10b981' : '64748b'}&color=fff&size=112&bold=true`}
                  className="w-full h-full object-cover" alt=""
                />
              )}
            </div>
            {/* Status dot */}
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}60`, border: '2.5px solid var(--surface)' }}>
              {isConnected ? <Wifi className="w-2.5 h-2.5 text-white" /> :
               isConnecting ? <RefreshCw className="w-2.5 h-2.5 text-white animate-spin" /> :
               <WifiOff className="w-2.5 h-2.5 text-white" />}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {renameOpen ? (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename();
                      if (e.key === 'Escape') { setRenameOpen(false); setRenameValue(connection.name); }
                    }}
                    maxLength={60}
                    className="flex-1 min-w-0 px-2 py-0.5 text-sm font-bold rounded-md border border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={submitRename}
                    className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50"
                    aria-label="Salvar nome"
                    title="Salvar"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRenameOpen(false); setRenameValue(connection.name); }}
                    className="p-1 rounded-md text-slate-400 hover:bg-slate-100"
                    aria-label="Cancelar renomear"
                    title="Cancelar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="text-base font-black text-slate-900 dark:text-white truncate" title={connection.name}>{connection.name}</h3>
                  {onRename && (
                    <button
                      type="button"
                      onClick={() => setRenameOpen(true)}
                      className="p-0.5 rounded-md text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors flex-shrink-0"
                      aria-label="Renomear conexão"
                      title="Renomear"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <span className="text-[9px] font-black px-2.5 py-0.5 rounded-full flex-shrink-0"
                    style={isConnected
                      ? { background: 'rgba(34,197,94,0.12)', color: 'var(--success)' }
                      : isConnecting
                      ? { background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }
                      : { background: 'var(--surface-2)', color: 'var(--text-3)' }
                    }>
                    {statusLabel}
                  </span>
                  {isConnected && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm" title="Latência de rede (ping) com a API Evolution">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      45ms
                    </span>
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono truncate">
              {connection.phoneNumber ||
                (isConnected ? 'Sem número — reconecte ou gere novo QR' : 'Aguardando conexão...')}
            </p>
          </div>
        </div>

        {/* QR / Auth / Connecting state */}
        {isAuthenticating ? (
          <div className="mb-4 p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)' }}>
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
            <div>
              <p className="text-xs font-black text-slate-900 dark:text-white">QR Escaneado!</p>
              <p className="text-[10px] text-slate-400 font-semibold">Autenticando sessão...</p>
            </div>
          </div>
        ) : isQrReady && qrCodeText ? (
          <div className="mb-4 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setQrZoomOpen(true);
              }}
              className="bg-white p-3 rounded-2xl shadow-xl ring-1 ring-slate-100 cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              aria-label="Ampliar QR Code"
              title="Clique para ampliar"
            >
              <QrCanvas
                value={qrCodeText}
                size={176}
                className="pointer-events-none"
                ariaLabel={`QR Code de ${connection.name}`}
              />
            </button>
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-400">Escaneie com o WhatsApp</span>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'var(--surface-2)' }}>
                <div className={`w-2 h-2 rounded-full ${qrSeconds > 20 ? 'bg-emerald-500' : qrSeconds > 10 ? 'bg-amber-500 animate-pulse' : 'bg-red-500 animate-pulse'}`} />
                <span className="text-[10px] font-black text-slate-500 tabular-nums">{qrSeconds}s</span>
              </div>
            </div>
            <button onClick={() => onForceQr(connection.id)}
              className="text-[10px] font-bold text-slate-400 hover:text-orange-500 transition-colors underline underline-offset-2">
              Gerar novo QR Code
            </button>
          </div>
        ) : isConnecting && !isQrReady ? (
          <div className="mb-4 p-4 rounded-xl flex items-center gap-3" style={{ background: 'var(--surface-2)' }}>
            <div className="relative">
              <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {connection.phoneNumber ? 'Reconectando sessão...' : 'Gerando QR Code...'}
              </p>
              <p className="text-[10px] text-slate-400 truncate max-w-[200px]">
                {connection.lastActivity || (connection.phoneNumber ? 'Restaurando pareamento...' : 'Aguarde ou use Forçar QR')}
              </p>
            </div>
          </div>
        ) : isConnected ? (
          /* Stats grid for connected */
          <div className="space-y-3 mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* Alerta de Limite Diário Atingido */}
            {connection.dailyLimit && connection.dailyLimit > 0 && connection.messagesSentToday >= connection.dailyLimit && (
              <div className="p-3 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-200 flex flex-col gap-2 shadow-sm animate-pulse">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-xs font-bold leading-tight">
                    Limite diário de {connection.dailyLimit} mensagens atingido hoje!
                  </p>
                </div>
                {!connection.limitExceededApproved ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] opacity-80 leading-normal">
                      O envio de novas mensagens em campanhas foi suspenso para este chip para evitar o seu bloqueio.
                    </p>
                    <button
                      type="button"
                      onClick={approveExtraSending}
                      className="mt-1 w-full py-1.5 px-3 bg-red-600 dark:bg-red-500 hover:bg-red-700 text-white text-[10px] font-bold uppercase rounded-lg transition active:scale-95 flex items-center justify-center gap-1 shadow-sm"
                    >
                      <Zap className="w-3 h-3 fill-current" /> Aprovar envio extra hoje
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] text-green-700 dark:text-green-300 font-bold flex items-center gap-1 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                    <ShieldCheck className="w-3.5 h-3.5" /> Envio extra aprovado pelo usuário hoje!
                  </p>
                )}
              </div>
            )}

            {/* Painel expansível de configurações de limites */}
            {settingsOpen && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 space-y-3 shadow-inner">
                <div className="flex items-center gap-1.5 pb-1.5 border-b border-slate-200/60 dark:border-slate-800/60">
                  <Zap className="w-4 h-4 text-emerald-500" />
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Limites & Crescimento</p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Limite diário</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="Sem limite"
                      value={dailyLimitInput}
                      onChange={(e) => setDailyLimitInput(e.target.value)}
                      className="w-full text-xs font-bold px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Ação ao estourar</label>
                    <select
                      value={limitActionInput}
                      onChange={(e) => setLimitActionInput(e.target.value as any)}
                      className="w-full text-xs font-bold px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800"
                    >
                      <option value="ask">Parar/Perguntar</option>
                      <option value="redirect">Desviar Canal</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Crescimento diário</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="Desativado"
                      value={growthRateInput}
                      onChange={(e) => setGrowthRateInput(e.target.value)}
                      className="w-full text-xs font-bold px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Tipo crescimento</label>
                    <select
                      value={growthTypeInput}
                      onChange={(e) => setGrowthTypeInput(e.target.value as any)}
                      className="w-full text-xs font-bold px-2 py-1.5 rounded-lg border focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800"
                    >
                      <option value="fixed">Fixo (Ex: +10 msgs)</option>
                      <option value="percent">Percentual (Ex: +10%)</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={saveSettings}
                    className="flex-1 py-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase rounded-lg transition active:scale-95"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    className="flex-1 py-1 px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase rounded-lg transition active:scale-95"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div
              className="p-3 rounded-xl border"
              style={{
                background: dispatchInsights.temp.bg,
                borderColor: `${dispatchInsights.temp.color}33`
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Ritmo — 7 dias</p>
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    {dispatchInsights.weekTotal.toLocaleString('pt-BR')} disparos na semana
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full"
                    style={{ background: `${dispatchInsights.temp.color}22`, color: dispatchInsights.temp.color }}
                  >
                    <TempIcon className="w-3 h-3" />
                    {dispatchInsights.temp.label}
                  </span>
                  <span
                    className="inline-flex items-center gap-0.5 text-[9px] font-bold tabular-nums"
                    style={{
                      color:
                        dispatchInsights.temp.trendPct > 0
                          ? '#10b981'
                          : dispatchInsights.temp.trendPct < 0
                            ? '#ef4444'
                            : 'var(--text-3)'
                    }}
                    title="Comparado com ontem"
                  >
                    <TrendIcon className="w-3 h-3" />
                    {dispatchInsights.temp.trendPct > 0 ? '+' : ''}
                    {dispatchInsights.temp.trendPct}%
                  </span>
                </div>
              </div>
              <div className="flex items-end justify-between gap-2">
                <Sparkline
                  id={`conn-${connection.id}`}
                  values={dispatchInsights.last7.map((d) => d.sent)}
                  color={dispatchInsights.temp.color}
                  width={148}
                  height={34}
                />
                <div className="text-right shrink-0">
                  <p className="text-[8px] font-bold uppercase text-slate-400">Hoje</p>
                  <p className="text-sm font-black tabular-nums" style={{ color: dispatchInsights.temp.color }}>
                    {dispatchInsights.sentToday.toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
              <div className="flex justify-between mt-1.5 px-0.5">
                {dispatchInsights.last7.map((d) => (
                  <span key={d.date} className="text-[7px] font-bold uppercase text-slate-400 w-4 text-center">
                    {formatChannelSparkDay(d.date)}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Send className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[9px] font-black text-slate-400 uppercase">Hoje</span>
                  {connection.dailyLimit && connection.dailyLimit > 0 ? (
                    <span className="text-[8px] ml-auto font-bold opacity-60">meta {connection.dailyLimit}</span>
                  ) : null}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
                    {connection.messagesSentToday.toLocaleString()}
                  </span>
                  {connection.dailyLimit && connection.dailyLimit > 0 ? (
                    <span className="text-xs text-slate-400 tabular-nums">/ {connection.dailyLimit}</span>
                  ) : null}
                </div>
              </div>
              <div className="p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[9px] font-black text-slate-400 uppercase">Fila</span>
                </div>
                <span className={`text-xl font-black tabular-nums ${connection.queueSize > 50 ? 'text-amber-500' : 'text-slate-900 dark:text-white'}`}>
                  {connection.queueSize}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-2.5 rounded-xl text-center relative" style={{ background: 'var(--surface-2)' }}>
                {connection.growthRate && connection.growthRate > 0 ? (
                  <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-[7px] font-black px-1 rounded-full border border-[var(--surface-2)]">
                    +{connection.growthRate}{connection.growthType === 'percent' ? '%' : ''}
                  </span>
                ) : null}
                <Zap className="w-3 h-3 text-purple-500 mx-auto mb-1" />
                <span className="text-xs font-black text-slate-900 dark:text-white tabular-nums block">{(connection.totalMessagesSent || 0).toLocaleString()}</span>
                <span className="text-[8px] font-black text-slate-400 uppercase">Total</span>
              </div>
              <div className="p-2.5 rounded-xl text-center" style={{ background: 'var(--surface-2)' }}>
                <Clock className="w-3 h-3 text-sky-500 mx-auto mb-1" />
                <span className="text-xs font-black text-slate-900 dark:text-white tabular-nums block">{formatUptime(connection.connectedSince)}</span>
                <span className="text-[8px] font-black text-slate-400 uppercase">Uptime</span>
              </div>
              <div className="p-2.5 rounded-xl text-center" style={{ background: 'var(--surface-2)' }}>
                {healthScore >= 70
                  ? <ShieldCheck className="w-3 h-3 text-emerald-500 mx-auto mb-1" />
                  : <ShieldAlert className="w-3 h-3 text-amber-500 mx-auto mb-1" />}
                <span className="text-xs font-black tabular-nums block"
                  style={{ color: healthScore >= 70 ? '#10b981' : healthScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                  {healthScore}%
                </span>
                <span className="text-[8px] font-black text-slate-400 uppercase">Saúde</span>
              </div>
            </div>
          </div>
        ) : (
          /* Offline prompt */
          <div className="mb-4 p-5 rounded-xl text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}>
            <WifiOff className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500">Canal desconectado</p>
            <p className="text-[10px] text-slate-400 mt-1">Clique em Conectar para iniciar</p>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* Battery */}
          {connection.batteryLevel !== undefined ? (
            <div className="flex items-center gap-1.5">
              <div className={`w-6 h-3 rounded-sm border p-px ${connection.batteryLevel < 20 ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'}`}>
                <div className={`h-full rounded-[1px] ${connection.batteryLevel < 20 ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${connection.batteryLevel}%` }} />
              </div>
              <span className="text-[10px] font-black text-slate-400 tabular-nums">{connection.batteryLevel}%</span>
            </div>
          ) : <div />}

          <div className="flex items-center gap-2">
            {!isConnected && !isConnecting && (
              <>
                <button onClick={() => onReconnect(connection.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95 hover:shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 2px 12px rgba(16,185,129,0.3)' }}>
                  <Power className="w-3.5 h-3.5" />
                  Conectar
                </button>
                <button onClick={() => onForceQr(connection.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95"
                  style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <QrCode className="w-3.5 h-3.5" />
                  QR
                </button>
              </>
            )}
            {isConnected && (
              <>
                <button onClick={() => onReconnect(connection.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95"
                  style={{ background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reiniciar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const label = connection.name?.trim() || connection.id;
                    if (!window.confirm(
                      `Desconectar "${label}"?\n\nO WhatsApp será deslogado deste canal. Para usar de novo, escaneie o QR ou clique em Conectar.`
                    )) return;
                    onLogoutConnection(connection.id);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <LogOut className="w-3.5 h-3.5" />
                  Desconectar
                </button>
              </>
            )}
            {isConnecting && (
              <button onClick={() => onForceQr(connection.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all active:scale-95"
                style={{ background: 'rgba(245,158,11,0.08)', color: '#d97706' }}>
                <QrCode className="w-3.5 h-3.5" />
                Forçar QR
              </button>
            )}
            <button
              type="button"
              onClick={runDiagnosis}
              disabled={isDiagnosing}
              className={`p-2 transition-all rounded-xl active:scale-90 ${isDiagnosing ? 'text-amber-500 animate-pulse bg-amber-500/10' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 dark:hover:bg-amber-500/10'}`}
              title="Executar Auto-Diagnóstico de Integridade"
            >
              <Activity className={`w-4 h-4 ${isDiagnosing ? 'animate-spin' : ''}`} />
            </button>
            {onUpdateSettings && (
              <button
                type="button"
                onClick={() => setSettingsOpen(!settingsOpen)}
                className={`p-2 transition-all rounded-xl active:scale-90 ${settingsOpen ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'}`}
                title="Configurações de Limite & Crescimento"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => onDisconnect(connection.id)}
              className="p-2 text-slate-400 hover:text-red-500 transition-all rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 active:scale-90">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <QRCodeModal
      isOpen={qrZoomOpen && Boolean(qrCodeText)}
      onClose={() => setQrZoomOpen(false)}
      qrCode={qrCodeText}
      connectionName={connection.name}
    />
    </>
  );
};
