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
import { campaignClockVars } from '../../utils/campaignClockVars';
import {
  apiPreflightCheck,
  apiFrequencyCapCheck,
  fetchDispatchHealth,
  reconnectDispatchHealth,
} from '../../services/campaignsApi';
import { DispatchFixPanel } from './DispatchFixPanel';
import { useAuth } from '../../context/AuthContext';
import { isPlatformAdminUser } from '../../utils/adminAccess';

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

function formatRelativeHours(iso?: string): string {
  if (!iso) return '';
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs) || diffMs < 0) return '';
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return 'há menos de 1 h';
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} dia(s)`;
}

function buildTriagedFromRecipients(
  recipients: SampleRecipient[],
  cappedByPhone?: Map<string, { capped: boolean; lastSentAt?: string }>
): TriagedContact[] {
  return recipients.map((r) => {
    const digits = r.phone.replace(/\D/g, '');
    const key = digits.slice(-11);
    const cap = cappedByPhone?.get(key);
    return {
      phone: digits,
      name: r.name || r.phone,
      vars: r.vars,
      capped: cap?.capped ?? false,
      lastSentAt: cap?.lastSentAt,
    };
  });
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
  onConfirm: (opts?: { skipFrequencyCap?: boolean }) => void;
  campaignName: string;
  message: string;
  messageStages?: string[];
  chipCount: number;
  contactCount: number;
  delaySeconds: number;
  launchMode?: 'now' | 'schedule';
  allRecipients: SampleRecipient[];
  isLoading?: boolean;
  selectedConnectionIds?: string[];
}

type HealthStatus = 'idle' | 'checking' | 'ok' | 'warn' | 'error' | 'reconnecting';

interface ChipResult {
  connectionId: string;
  status: string;
  isReady: boolean;
  error: string | null;
}

interface TriagedContact {
  phone: string;
  name: string;
  vars: Record<string, string>;
  capped: boolean;
  lastSentAt?: string;
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
  allRecipients,
  isLoading = false,
  selectedConnectionIds = [],
}) => {
  const { user } = useAuth();
  const isAdmin = isPlatformAdminUser(user);

  const [motorStatus, setMotorStatus] = useState<HealthStatus>('idle');
  const [chipStatus, setChipStatus] = useState<HealthStatus>('idle');
  const [chipResults, setChipResults] = useState<ChipResult[]>([]);
  const [showChipDetails, setShowChipDetails] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [freqCapStatus, setFreqCapStatus] = useState<HealthStatus>('idle');
  const [triagedContacts, setTriagedContacts] = useState<TriagedContact[]>([]);
  const [cappedCount, setCappedCount] = useState(0);
  const [confirmRepeatSend, setConfirmRepeatSend] = useState(false);

  const allMessages = useMemo(() => {
    return [message, ...messageStages].filter(Boolean);
  }, [message, messageStages]);

  const triagedByPhone = useMemo(() => {
    const map = new Map<string, TriagedContact>();
    triagedContacts.forEach((c) => map.set(c.phone.slice(-11), c));
    return map;
  }, [triagedContacts]);

  const previewSamples = useMemo(() => {
    return allRecipients.slice(0, 3).map((r) => {
      const digits = r.phone.replace(/\D/g, '');
      const triage = triagedByPhone.get(digits.slice(-11));
      return {
        ...r,
        preview: allMessages.map((tmpl) => renderMessage(tmpl, r.vars)),
        capped: triage?.capped ?? false,
        lastSentAt: triage?.lastSentAt,
      };
    });
  }, [allRecipients, allMessages, triagedByPhone]);

  const hasUnresolved = previewSamples.some((s) =>
    s.preview.some((p) => p.includes('{{') && p.includes('}}'))
  );

  const runFrequencyCapCheck = useCallback(async () => {
    setFreqCapStatus('checking');
    setConfirmRepeatSend(false);
    try {
      const phones = allRecipients.map((r) => r.phone.replace(/\D/g, '')).filter((p) => p.length >= 10);
      const res = await apiFrequencyCapCheck(phones);
      const cappedByPhone = new Map(
        res.contacts.map((c) => [c.phoneKey, { capped: c.capped, lastSentAt: c.lastSentAt }])
      );
      setTriagedContacts(buildTriagedFromRecipients(allRecipients, cappedByPhone));
      setCappedCount(res.cappedCount);
      setFreqCapStatus('ok');
    } catch {
      setTriagedContacts(buildTriagedFromRecipients(allRecipients));
      setCappedCount(0);
      setFreqCapStatus('error');
    }
  }, [allRecipients]);

  const runMotorCheck = useCallback(async () => {
    setMotorStatus('checking');
    try {
      let h = await fetchDispatchHealth({ retries: 0 });
      if (!h.ok && h.reachable && (h.kind === 'redis_down' || h.kind === 'misconfig')) {
        setMotorStatus('reconnecting');
        h = await reconnectDispatchHealth();
      }
      setMotorStatus(h.ok ? 'ok' : h.reachable === false ? 'reconnecting' : 'error');
    } catch {
      setMotorStatus('reconnecting');
    }
  }, []);

  const runChipCheck = useCallback(async () => {
    if (selectedConnectionIds.length === 0) {
      setChipStatus('warn');
      setChipResults([]);
      return;
    }
    setChipStatus('checking');
    try {
      const res = await Promise.race([
        apiPreflightCheck(selectedConnectionIds),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        ),
      ]);
      setChipResults(res.results);
      setChipStatus(res.allReady ? 'ok' : 'error');
    } catch {
      setChipStatus('error');
      setChipResults([]);
    }
  }, [selectedConnectionIds]);

  const runAllChecks = useCallback(() => {
    void Promise.all([runMotorCheck(), runChipCheck(), runFrequencyCapCheck()]);
  }, [runMotorCheck, runChipCheck, runFrequencyCapCheck]);

  useEffect(() => {
    if (isOpen) {
      setTriagedContacts(buildTriagedFromRecipients(allRecipients));
      setExpanded(allRecipients.length === 1 ? 0 : null);
      runAllChecks();
    } else {
      setMotorStatus('idle');
      setChipStatus('idle');
      setChipResults([]);
      setShowChipDetails(false);
      setFreqCapStatus('idle');
      setTriagedContacts([]);
      setCappedCount(0);
      setConfirmRepeatSend(false);
      setExpanded(null);
    }
  }, [isOpen, runAllChecks, allRecipients]);

  const needsRepeatConfirm = cappedCount > 0 && freqCapStatus === 'ok';
  const repeatConfirmed = !needsRepeatConfirm || confirmRepeatSend;

  const dispatchHealthReady =
    (motorStatus === 'ok' || motorStatus === 'reconnecting') &&
    motorStatus !== 'checking' &&
    motorStatus !== 'error' &&
    chipStatus !== 'error' &&
    chipStatus !== 'checking';

  const canDispatch = dispatchHealthReady && repeatConfirmed;

  const checksPending = motorStatus === 'checking' || chipStatus === 'checking';
  const preflightHeadline = checksPending
    ? 'Verificando envio…'
    : dispatchHealthReady
    ? 'Pronto para disparar'
    : motorStatus === 'error'
    ? isAdmin
      ? 'Problema no motor — veja abaixo'
      : 'Aguarde a sincronização'
    : chipStatus === 'error'
    ? 'Chip offline — verifique a conexão'
    : 'Verificação de pré-disparo';

  const statusColor = (status: HealthStatus) => {
    if (status === 'ok') return '#10b981';
    if (status === 'error') return '#ef4444';
    if (status === 'warn' || status === 'reconnecting') return '#f59e0b';
    return 'var(--text-3)';
  };

  const statusIcon = (status: HealthStatus) => {
    if (status === 'checking' || status === 'reconnecting') {
      return <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: statusColor(status) }} />;
    }
    if (status === 'ok') return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: statusColor(status) }} />;
    if (status === 'error') return <WifiOff className="w-3.5 h-3.5" style={{ color: statusColor(status) }} />;
    if (status === 'warn') return <AlertTriangle className="w-3.5 h-3.5" style={{ color: statusColor(status) }} />;
    return <Wifi className="w-3.5 h-3.5" style={{ color: statusColor(status) }} />;
  };

  const motorStatusText =
    motorStatus === 'ok'
      ? 'Pronto'
      : motorStatus === 'error'
      ? isAdmin
        ? 'Indisponível'
        : 'Reconectando…'
      : motorStatus === 'reconnecting'
      ? 'Sincronizando…'
      : motorStatus === 'checking'
      ? 'Verificando…'
      : 'Aguardando';

  const chipStatusText =
    chipStatus === 'ok'
      ? `${chipResults.filter((r) => r.isReady).length}/${chipResults.length} online`
      : chipStatus === 'error'
      ? `${chipResults.filter((r) => !r.isReady).length || chipCount} offline`
      : chipStatus === 'checking'
      ? 'Verificando…'
      : chipStatus === 'warn'
      ? selectedConnectionIds.length === 0
        ? 'Nenhum chip'
        : 'Aguardando'
      : 'Aguardando';

  const freqCapStatusText =
    freqCapStatus === 'checking'
      ? 'Verificando…'
      : freqCapStatus === 'error'
      ? 'Não verificado'
      : cappedCount > 0
      ? `${cappedCount} em 24 h`
      : 'Liberados';

  const showFreqCapBanner = freqCapStatus === 'error';
  const showRepeatPanel = needsRepeatConfirm;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="lg">
      <div className="cpm-root">
        <header className="cpm-hero">
          <div className="cpm-hero__icon">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-[17px] truncate" style={{ color: 'var(--text-1)' }}>
              {campaignName}
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Confira tudo antes de disparar
            </p>
          </div>
          {launchMode === 'schedule' && (
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
              style={{ background: 'rgba(59, 130, 246, 0.14)', color: '#60a5fa' }}
            >
              Agendado
            </span>
          )}
        </header>

        <div className="cpm-stats">
          {[
            { icon: <Users className="w-3.5 h-3.5" />, label: 'Contatos', value: contactCount.toLocaleString('pt-BR'), color: '#3b82f6' },
            { icon: <Smartphone className="w-3.5 h-3.5" />, label: 'Chips', value: String(chipCount), color: '#10b981' },
            { icon: <Layers className="w-3.5 h-3.5" />, label: 'Etapas', value: String(allMessages.length), color: '#8b5cf6' },
            { icon: <Clock className="w-3.5 h-3.5" />, label: 'Duração', value: estimateDuration(contactCount, delaySeconds, allMessages.length), color: '#f59e0b' },
          ].map((s) => (
            <div key={s.label} className="cpm-stat">
              <div className="cpm-stat__icon" style={{ color: s.color }}>{s.icon}</div>
              <div className="cpm-stat__value">{s.value}</div>
              <div className="cpm-stat__label">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="cpm-meta">
          {formatDelay(delaySeconds)} entre mensagens ·{' '}
          {allMessages.length > 1 ? `${allMessages.length} etapas em sequência` : 'mensagem única por contato'}
        </p>

        <section className="cpm-preflight">
          <div className="cpm-preflight__head">
            <div className="cpm-preflight__title">
              {dispatchHealthReady ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : checksPending ? (
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-3)' }} />
              ) : motorStatus === 'error' || chipStatus === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-red-400" />
              ) : (
                <Wifi className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
              )}
              <span>{preflightHeadline}</span>
            </div>
            <button
              type="button"
              className="cpm-preflight__refresh"
              onClick={runAllChecks}
              disabled={checksPending}
            >
              <RefreshCw className={`w-3 h-3 ${checksPending ? 'animate-spin' : ''}`} />
              Reverificar
            </button>
          </div>

          <div className="cpm-checks">
            <div className="cpm-check" data-status={motorStatus}>
              <span className="cpm-check__icon">{statusIcon(motorStatus)}</span>
              <div className="cpm-check__body">
                <div className="cpm-check__label">Motor de envio</div>
                <div className="cpm-check__status" style={{ color: statusColor(motorStatus) }}>
                  {motorStatusText}
                </div>
              </div>
            </div>

            <div
              className={`cpm-check cpm-check--clickable${chipResults.length > 0 ? '' : ''}`}
              data-status={chipStatus}
              onClick={() => chipResults.length > 0 && setShowChipDetails((v) => !v)}
              onKeyDown={(e) => {
                if (chipResults.length > 0 && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setShowChipDetails((v) => !v);
                }
              }}
              role={chipResults.length > 0 ? 'button' : undefined}
              tabIndex={chipResults.length > 0 ? 0 : undefined}
            >
              <span className="cpm-check__icon">{statusIcon(chipStatus)}</span>
              <div className="cpm-check__body">
                <div className="cpm-check__label flex items-center gap-1">
                  WhatsApp Chips
                  {chipResults.length > 0 && (
                    showChipDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                  )}
                </div>
                <div className="cpm-check__status" style={{ color: statusColor(chipStatus) }}>
                  {chipStatusText}
                </div>
              </div>
            </div>

            <div className="cpm-check" data-status={freqCapStatus === 'error' ? 'warn' : freqCapStatus}>
              <span className="cpm-check__icon">{statusIcon(freqCapStatus === 'error' ? 'warn' : freqCapStatus)}</span>
              <div className="cpm-check__body">
                <div className="cpm-check__label">Limite 24 h</div>
                <div
                  className="cpm-check__status"
                  style={{ color: statusColor(freqCapStatus === 'error' ? 'warn' : freqCapStatus) }}
                >
                  {freqCapStatusText}
                </div>
              </div>
            </div>
          </div>

          {showChipDetails && chipResults.length > 0 && (
            <div className="cpm-chip-details">
              {chipResults.map((r) => (
                <div key={r.connectionId} className="cpm-chip-row" data-ready={r.isReady ? 'true' : 'false'}>
                  {r.isReady ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 shrink-0 text-red-400" />
                  )}
                  <span className="flex-1 truncate font-mono" style={{ color: 'var(--text-2)' }}>
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

          {motorStatus === 'error' && isAdmin && (
            <div className="px-4 pb-3">
              <DispatchFixPanel compact />
            </div>
          )}
          {motorStatus === 'error' && !isAdmin && (
            <div className="cpm-banner cpm-banner--warn">
              <Loader2 className="w-4 h-4 shrink-0 text-amber-500 animate-spin" />
              <p>
                O servidor está se preparando. Aguarde alguns segundos e clique em <strong>Reverificar</strong>.
              </p>
            </div>
          )}

          {showFreqCapBanner && (
            <div className="cpm-banner cpm-banner--warn">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <p>
                Não foi possível verificar o limite de 24 h — você ainda pode disparar normalmente.
              </p>
            </div>
          )}

          {showRepeatPanel && (
            <div className="cpm-repeat-confirm">
              <label>
                <input
                  type="checkbox"
                  checked={confirmRepeatSend}
                  onChange={(e) => setConfirmRepeatSend(e.target.checked)}
                />
                <span>
                  Confirmo envio para <strong>{cappedCount} contato{cappedCount !== 1 ? 's' : ''}</strong> que já
                  recebeu mensagem nas últimas 24 horas
                  {triagedContacts.find((c) => c.capped)?.lastSentAt
                    ? ` (${formatRelativeHours(triagedContacts.find((c) => c.capped)?.lastSentAt)})`
                    : ''}
                  .
                </span>
              </label>
            </div>
          )}
        </section>

        {previewSamples.length > 0 && (
          <section>
            <p className="cpm-samples__title">
              Amostra — {previewSamples.length} contato{previewSamples.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
              {previewSamples.map((s, idx) => {
                const isExpanded = expanded === idx;
                return (
                  <div key={s.phone} className="cpm-sample">
                    <button
                      type="button"
                      className="cpm-sample__head"
                      data-expanded={isExpanded ? 'true' : 'false'}
                      onClick={() => setExpanded(isExpanded ? null : idx)}
                    >
                      <div
                        className="cpm-sample__avatar"
                        style={{ background: `hsl(${(idx * 137) % 360},60%,50%)` }}
                      >
                        {(s.name || s.phone).charAt(0).toUpperCase()}
                      </div>
                      <div className="cpm-sample__meta">
                        <div className="cpm-sample__name">{s.name || s.phone}</div>
                        <div className="cpm-sample__phone">{s.phone}</div>
                      </div>
                      <div className="cpm-sample__badges">
                        {freqCapStatus === 'checking' ? (
                          <span className="cpm-badge cpm-badge--checking">24 h…</span>
                        ) : s.capped ? (
                          <span className="cpm-badge cpm-badge--cap" title={s.lastSentAt ? formatRelativeHours(s.lastSentAt) : undefined}>
                            24 h
                          </span>
                        ) : freqCapStatus === 'ok' ? (
                          <span className="cpm-badge cpm-badge--ok">OK</span>
                        ) : null}
                        <span className="cpm-badge cpm-badge--msgs">
                          {allMessages.length} msg{allMessages.length !== 1 ? 's' : ''}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="cpm-sample__bubbles">
                        {s.preview.map((msg, mIdx) => (
                          <div key={mIdx} className="cpm-bubble">
                            {allMessages.length > 1 && (
                              <div className="text-[9px] font-bold uppercase tracking-wider mb-1 opacity-70">
                                Etapa {mIdx + 1}
                              </div>
                            )}
                            {msg}
                            <div className="cpm-bubble__time">
                              {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ✓✓
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {hasUnresolved && (
          <div className="cpm-banner cpm-banner--warn">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <span>
              Variáveis <code>{'{{nome}}'}</code> sem valor — verifique se os contatos têm o campo preenchido.
            </span>
          </div>
        )}

        <footer className="cpm-footer">
          <Button variant="ghost" size="sm" onClick={onClose} leftIcon={<X className="w-4 h-4" />}>
            Cancelar
          </Button>
          <div className="cpm-footer__actions">
            {!canDispatch && motorStatus === 'error' && (
              <span className="cpm-footer__hint cpm-footer__hint--error">
                <AlertTriangle className="w-3.5 h-3.5" />
                {isAdmin ? 'Corrija acima' : 'Aguarde ou reverifique'}
              </span>
            )}
            {!canDispatch && chipStatus === 'error' && motorStatus !== 'error' && (
              <span className="cpm-footer__hint cpm-footer__hint--error">
                <AlertTriangle className="w-3.5 h-3.5" />
                Chip offline
              </span>
            )}
            {!canDispatch && checksPending && (
              <span className="cpm-footer__hint" style={{ color: 'var(--text-3)' }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Verificando…
              </span>
            )}
            {dispatchHealthReady && needsRepeatConfirm && !confirmRepeatSend && (
              <span className="cpm-footer__hint cpm-footer__hint--warn">
                <AlertTriangle className="w-3.5 h-3.5" />
                Confirme o envio repetido
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                onConfirm({
                  skipFrequencyCap: needsRepeatConfirm && confirmRepeatSend,
                })
              }
              loading={isLoading}
              leftIcon={isLoading ? undefined : <Rocket className="w-4 h-4" />}
              disabled={!canDispatch}
            >
              {launchMode === 'schedule' ? 'Confirmar agendamento' : 'Confirmar e disparar'}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
};
