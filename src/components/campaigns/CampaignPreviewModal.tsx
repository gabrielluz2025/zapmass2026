/**
 * CampaignPreviewModal
 *
 * Preview da campanha antes do disparo com verificação automática de saúde
 * (Redis + chips) para o usuário saber antes de clicar em "Confirmar".
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  Layers,
  MessageSquare,
  Rocket,
  Smartphone,
  Users,
  X,
  AlertTriangle,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { campaignRecipientNameVars } from '../../utils/contactNameNormalize';
import { campaignClockVars } from '../../utils/campaignClockVars';
import { apiPreflightCheck } from '../../services/campaignsApi';

// ── helpers ──────────────────────────────────────────────────────────────────

function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const k = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return vars[k] ?? vars[key] ?? `{{${key}}}`;
  });
}

function resolveSpintax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_, inner) => {
    const options = inner.split('|');
    return options[Math.floor(Math.random() * options.length)] ?? '';
  });
}

function renderMessage(template: string, recipientVars: Record<string, string>): string {
  const clockVars = campaignClockVars();
  const merged: Record<string, string> = {};
  Object.entries(clockVars).forEach(([k, v]) => { merged[k.toLowerCase()] = String(v); });
  Object.entries(recipientVars).forEach(([k, v]) => { merged[k.toLowerCase()] = v; });
  return resolveSpintax(applyVars(template, merged));
}

function formatDelay(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${(s / 3600).toFixed(1)}h`;
}

function estimateDuration(contacts: number, delay: number, stages: number): string {
  const totalSeconds = contacts * delay * stages;
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `~${Math.ceil(totalSeconds / 60)}min`;
  return `~${(totalSeconds / 3600).toFixed(1)}h`;
}

// ── tipos ────────────────────────────────────────────────────────────────────

interface SampleRecipient {
  phone: string;
  vars: Record<string, string>;
  name?: string;
}

interface CampaignPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  campaignName: string;
  message: string;
  messageStages?: string[];
  chipCount: number;
  contactCount: number;
  delaySeconds: number;
  launchMode?: 'now' | 'schedule';
  sampleRecipients: SampleRecipient[];
  isLoading?: boolean;
  selectedConnectionIds?: string[];
}

type HealthStatus = 'idle' | 'checking' | 'ok' | 'warn' | 'error';

interface ChipResult {
  connectionId: string;
  status: string;
  isReady: boolean;
  error: string | null;
}

// ── componente ───────────────────────────────────────────────────────────────

export const CampaignPreviewModal: React.FC<CampaignPreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  campaignName,
  message,
  messageStages = [],
  chipCount,
  contactCount,
  delaySeconds,
  launchMode = 'now',
  sampleRecipients,
  isLoading = false,
  selectedConnectionIds = [],
}) => {
  const [redisStatus, setRedisStatus] = useState<HealthStatus>('idle');
  const [chipStatus, setChipStatus] = useState<HealthStatus>('idle');
  const [chipResults, setChipResults] = useState<ChipResult[]>([]);
  const [showChipDetails, setShowChipDetails] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const allMessages = useMemo(() => {
    return [message, ...messageStages].filter(Boolean);
  }, [message, messageStages]);

  const samples = useMemo(() => {
    return sampleRecipients.slice(0, 3).map((r) => ({
      ...r,
      preview: allMessages.map((tmpl) => renderMessage(tmpl, r.vars)),
    }));
  }, [sampleRecipients, allMessages]);

  const hasUnresolved = samples.some((s) =>
    s.preview.some((p) => p.includes('{{') && p.includes('}}'))
  );

  const runHealthCheck = useCallback(async () => {
    // 1. Verificar Redis
    setRedisStatus('checking');
    setChipStatus('checking');
    let redisOk = false;
    try {
      const r = await fetch('/api/health/redis', {
        signal: AbortSignal.timeout(6000),
      });
      redisOk = r.ok;
      setRedisStatus(r.ok ? 'ok' : 'error');
    } catch {
      setRedisStatus('error');
    }

    // 2. Verificar chips
    if (selectedConnectionIds.length === 0) {
      setChipStatus('warn');
      return;
    }
    // Se o Redis está fora, a Evolution API também fica lenta/sem resposta.
    // Não trava em "Verificando..." — marca chips como não verificados (Redis é o bloqueador).
    if (!redisOk) {
      setChipStatus('warn');
      setChipResults([]);
      return;
    }
    try {
      // Timeout de segurança: nunca deixa o check preso em "Verificando…".
      const res = await Promise.race([
        apiPreflightCheck(selectedConnectionIds),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 12000)
        ),
      ]);
      setChipResults(res.results);
      setChipStatus(res.allReady ? 'ok' : 'error');
    } catch {
      setChipStatus('error');
    }
  }, [selectedConnectionIds]);

  // Verificação automática ao abrir
  useEffect(() => {
    if (isOpen) {
      runHealthCheck();
    } else {
      setRedisStatus('idle');
      setChipStatus('idle');
      setChipResults([]);
      setShowChipDetails(false);
    }
  }, [isOpen]);

  // Redis error é bloqueador imediato — não espera chips terminarem de verificar.
  const overallHealth: HealthStatus =
    redisStatus === 'error'
      ? 'error'
      : chipStatus === 'error'
      ? 'error'
      : redisStatus === 'checking' || chipStatus === 'checking'
      ? 'checking'
      : redisStatus === 'ok' && chipStatus === 'ok'
      ? 'ok'
      : 'idle';

  // Bloqueia disparo enquanto verificação estiver em andamento ou houver erro.
  const canDispatch = overallHealth === 'ok' || overallHealth === 'idle';

  const palette = {
    ok: { bg: '#10b98115', border: '#10b98135', text: '#10b981', icon: <CheckCircle2 className="w-4 h-4" /> },
    error: { bg: '#ef444415', border: '#ef444435', text: '#ef4444', icon: <WifiOff className="w-4 h-4" /> },
    checking: { bg: 'var(--surface-1)', border: 'var(--border-subtle)', text: 'var(--text-3)', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
    warn: { bg: '#f59e0b15', border: '#f59e0b35', text: '#f59e0b', icon: <AlertTriangle className="w-4 h-4" /> },
    idle: { bg: 'var(--surface-1)', border: 'var(--border-subtle)', text: 'var(--text-3)', icon: <Wifi className="w-4 h-4" /> },
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="lg">
      <div className="space-y-4">

        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: 'linear-gradient(135deg,#3b82f610 0%,#10b98110 100%)', border: '1px solid var(--border-subtle)' }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#3b82f6,#10b981)', boxShadow: '0 4px 14px #3b82f640' }}
          >
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-[18px] truncate" style={{ color: 'var(--text-1)' }}>
              {campaignName}
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Confira tudo antes de disparar
            </p>
          </div>
          {launchMode === 'schedule' && (
            <div
              className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold"
              style={{ background: '#3b82f620', color: '#3b82f6' }}
            >
              Agendado
            </div>
          )}
        </div>

        {/* ── STATS CARDS ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: <Users className="w-4 h-4" />, label: 'Contatos', value: contactCount.toLocaleString('pt-BR'), color: '#3b82f6' },
            { icon: <Smartphone className="w-4 h-4" />, label: 'Chips', value: String(chipCount), color: '#10b981' },
            { icon: <Layers className="w-4 h-4" />, label: 'Etapas', value: String(allMessages.length), color: '#8b5cf6' },
            { icon: <Clock className="w-4 h-4" />, label: 'Duração', value: estimateDuration(contactCount, delaySeconds, allMessages.length), color: '#f59e0b' },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl p-3 flex flex-col items-center gap-1 text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div style={{ color: s.color }}>{s.icon}</div>
              <div className="text-[16px] font-black" style={{ color: 'var(--text-1)' }}>{s.value}</div>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{s.label}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-center -mt-1" style={{ color: 'var(--text-3)' }}>
          {formatDelay(delaySeconds)} entre mensagens &nbsp;·&nbsp;
          {allMessages.length > 1 ? `${allMessages.length} etapas em sequência` : 'mensagem única por contato'}
        </p>

        {/* ── VERIFICAÇÃO DE SAÚDE ──────────────────────────────────────── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2">
              {overallHealth === 'checking' && <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-3)' }} />}
              {overallHealth === 'ok' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              {overallHealth === 'error' && <AlertTriangle className="w-4 h-4 text-red-500" />}
              {overallHealth === 'idle' && <Wifi className="w-4 h-4" style={{ color: 'var(--text-3)' }} />}
              <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                {overallHealth === 'checking' ? 'Verificando infraestrutura…' :
                 overallHealth === 'ok' ? 'Tudo pronto para disparar!' :
                 overallHealth === 'error' ? 'Problema detectado — veja abaixo' :
                 'Verificação de pré-disparo'}
              </span>
            </div>
            <button
              onClick={runHealthCheck}
              className="flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1"
              style={{ background: 'var(--surface-0)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
              disabled={overallHealth === 'checking'}
            >
              <RefreshCw className={`w-3 h-3 ${overallHealth === 'checking' ? 'animate-spin' : ''}`} />
              Reverificar
            </button>
          </div>

          <div className="px-4 py-3 grid grid-cols-2 gap-2">
            {/* Redis */}
            {(['idle', 'checking', 'ok', 'error', 'warn'] as HealthStatus[]).includes(redisStatus) && (
              <div
                className="rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: palette[redisStatus].bg, border: `1px solid ${palette[redisStatus].border}` }}
              >
                <span style={{ color: palette[redisStatus].text }}>{palette[redisStatus].icon}</span>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: 'var(--text-1)' }}>Fila Redis</div>
                  <div className="text-[10px]" style={{ color: palette[redisStatus].text }}>
                    {redisStatus === 'ok' ? 'Online e respondendo' :
                     redisStatus === 'error' ? 'Fora do ar — reinicie o Redis' :
                     redisStatus === 'checking' ? 'Verificando…' : 'Não verificado'}
                  </div>
                </div>
              </div>
            )}

            {/* Chips */}
            <div
              className="rounded-xl px-3 py-2.5 flex items-center gap-2 cursor-pointer"
              style={{ background: palette[chipStatus].bg, border: `1px solid ${palette[chipStatus].border}` }}
              onClick={() => chipResults.length > 0 && setShowChipDetails(!showChipDetails)}
            >
              <span style={{ color: palette[chipStatus].text }}>{palette[chipStatus].icon}</span>
              <div className="flex-1">
                <div className="text-[11px] font-bold" style={{ color: 'var(--text-1)' }}>WhatsApp Chips</div>
                <div className="text-[10px]" style={{ color: palette[chipStatus].text }}>
                  {chipStatus === 'ok' ? `${chipResults.filter(r => r.isReady).length}/${chipResults.length} online` :
                   chipStatus === 'error' ? `${chipResults.filter(r => !r.isReady).length} chip(s) offline` :
                   chipStatus === 'checking' ? 'Verificando…' :
                   chipStatus === 'warn'
                     ? (selectedConnectionIds.length === 0 ? 'Nenhum chip selecionado' : 'Resolva o Redis primeiro')
                     : 'Não verificado'}
                </div>
              </div>
              {chipResults.length > 0 && (
                <span style={{ color: 'var(--text-3)' }}>
                  {showChipDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </span>
              )}
            </div>
          </div>

          {/* Detalhes dos chips */}
          {showChipDetails && chipResults.length > 0 && (
            <div className="px-4 pb-3 space-y-1.5">
              {chipResults.map((r) => (
                <div
                  key={r.connectionId}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: r.isReady ? '#10b98108' : '#ef444408', border: `1px solid ${r.isReady ? '#10b98120' : '#ef444420'}` }}
                >
                  {r.isReady
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    : <WifiOff className="w-3.5 h-3.5 shrink-0 text-red-400" />}
                  <span className="text-[11px] flex-1 truncate font-mono" style={{ color: 'var(--text-2)' }}>
                    {r.connectionId}
                  </span>
                  <span
                    className="text-[9px] font-bold rounded-full px-2 py-0.5"
                    style={{ background: r.isReady ? '#10b981' : '#ef4444', color: '#fff' }}
                  >
                    {r.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Aviso Redis down */}
          {redisStatus === 'error' && (
            <div className="px-4 pb-3">
              <div
                className="rounded-xl px-3 py-2.5 text-[11px]"
                style={{ background: '#ef444412', border: '1px solid #ef444430', color: '#ef4444' }}
              >
                <strong>Redis fora do ar.</strong> Execute na VPS:{' '}
                <code className="px-1 py-0.5 rounded text-[10px]" style={{ background: '#ef444420' }}>
                  docker compose restart redis
                </code>
              </div>
            </div>
          )}
        </div>

        {/* ── PREVIEW DAS MENSAGENS ─────────────────────────────────────── */}
        {samples.length > 0 && (
          <div>
            <p className="text-[11px] font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Amostra — {samples.length} contato{samples.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
              {samples.map((s, idx) => {
                const isExpanded = expanded === idx;
                return (
                  <div
                    key={s.phone}
                    className="rounded-2xl overflow-hidden"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    {/* Header contato */}
                    <button
                      className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
                      style={{ background: 'var(--surface-0)', borderBottom: isExpanded ? '1px solid var(--border-subtle)' : 'none' }}
                      onClick={() => setExpanded(isExpanded ? null : idx)}
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black text-white shrink-0"
                        style={{ background: `hsl(${(idx * 137) % 360},60%,50%)` }}
                      >
                        {(s.name || s.phone).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {s.name || s.phone}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{s.phone}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div
                          className="text-[10px] font-bold rounded-full px-2 py-0.5"
                          style={{ background: '#25d36620', color: '#25d366' }}
                        >
                          {allMessages.length} msg{allMessages.length !== 1 ? 's' : ''}
                        </div>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />}
                      </div>
                    </button>

                    {/* Bolhas */}
                    {isExpanded && (
                      <div
                        className="px-4 py-4 space-y-2"
                        style={{ background: 'linear-gradient(180deg,#0a0a0a00 0%,#25d36604 100%)' }}
                      >
                        {s.preview.map((msg, mIdx) => (
                          <div key={mIdx} className="flex justify-end">
                            <div className="max-w-[85%] space-y-1">
                              {allMessages.length > 1 && (
                                <div className="text-right">
                                  <span
                                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                                    style={{ background: '#25d36620', color: '#25d366' }}
                                  >
                                    Etapa {mIdx + 1}
                                  </span>
                                </div>
                              )}
                              <div
                                className="rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words shadow-sm"
                                style={{
                                  background: '#25d36618',
                                  color: 'var(--text-1)',
                                  border: '1px solid #25d36628',
                                }}
                              >
                                {msg}
                                <div className="text-right mt-1">
                                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                    {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ✓✓
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── AVISO VARIÁVEIS NÃO RESOLVIDAS ───────────────────────────── */}
        {hasUnresolved && (
          <div
            className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px]"
            style={{ background: '#f59e0b12', border: '1px solid #f59e0b35', color: '#d97706' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Variáveis <code>{'{{nome}}'}</code> sem valor — verifique se os contatos têm o campo preenchido.
            </span>
          </div>
        )}

        {/* ── AÇÕES ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <Button variant="ghost" size="sm" onClick={onClose} leftIcon={<X className="w-4 h-4" />}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            {overallHealth === 'error' && (
              <span className="text-[11px] text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Corrija os problemas acima
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              loading={isLoading}
              leftIcon={isLoading ? undefined : <Rocket className="w-4 h-4" />}
              disabled={!canDispatch}
            >
              {launchMode === 'schedule' ? 'Confirmar agendamento' : 'Confirmar e disparar'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
