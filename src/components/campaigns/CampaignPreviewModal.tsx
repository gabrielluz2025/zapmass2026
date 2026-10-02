/**
 * CampaignPreviewModal
 *
 * Preview da campanha antes do disparo com verificação automática de saúde
 * (Redis + chips) para o usuário saber antes de clicar em "Confirmar".
 */
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
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
import { applyCampaignMessagePreviewVars } from '../../utils/campaignMessageVariables';
import { hasUnresolvedCampaignTemplateTokens } from '../../../shared/campaignSpintax';
import { apiPreflightCheck, apiFrequencyCapCheck, ensureDispatchReady } from '../../services/campaignsApi';
import {
  computeDispatchableAfterFreqCap,
  frequencyCapAllowPhonesFromTriaged,
  phoneKeyForFreqPreview,
  triageRecipientsForFreqCap,
  type FreqCapTriagedContact,
} from '../../utils/campaignFrequencyCapPreview';
import toast from 'react-hot-toast';
import { DispatchFixPanel } from './DispatchFixPanel';
import { useAuth } from '../../context/AuthContext';
import { isPlatformAdminUser } from '../../utils/adminAccess';
import { useZapMassCore } from '../../context/ZapMassContext';
import type { WhatsAppConnection } from '../../types';
import {
  chipResultsFromLocalConnections,
  chipStatusFromResults,
  formatChipStatusLine,
  chipStatusHint,
  freqCapStatusAfterCheck,
  motorStatusFromDispatchHealth,
  type PreviewChipResult,
  type PreviewHealthStatus,
} from '../../utils/campaignPreviewHealth';

// ── helpers ──────────────────────────────────────────────────────────────────
function renderMessage(template: string, recipientVars: Record<string, string>): string {
  return applyCampaignMessagePreviewVars(template, recipientVars);
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

// ── tipos ────────────────────────────────────────────────────────────────────

interface SampleRecipient {
  phone: string;
  vars: Record<string, string>;
  name?: string;
}

interface CampaignPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (opts?: { skipFrequencyCap?: boolean; frequencyCapAllowPhones?: string[] }) => void;
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
  /** Estado local dos chips — fallback quando /preflight falha. */
  connections?: WhatsAppConnection[];
}

type HealthStatus = PreviewHealthStatus;

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
  connections = [],
}) => {
  const { user } = useAuth();
  const isAdmin = isPlatformAdminUser(user);
  const { isBackendConnected } = useZapMassCore();

  const [motorStatus, setMotorStatus] = useState<HealthStatus>('idle');
  const [chipStatus, setChipStatus] = useState<HealthStatus>('idle');
  const [chipResults, setChipResults] = useState<PreviewChipResult[]>([]);
  const [chipUsedLocalFallback, setChipUsedLocalFallback] = useState(false);
  const [chipPreflightError, setChipPreflightError] = useState<string | null>(null);
  const [freqCapDegraded, setFreqCapDegraded] = useState(false);
  const [showChipDetails, setShowChipDetails] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [freqCapStatus, setFreqCapStatus] = useState<HealthStatus>('idle');
  const [triagedContacts, setTriagedContacts] = useState<FreqCapTriagedContact[]>([]);
  const [cappedCount, setCappedCount] = useState(0);
  /** Telefones no limite 24 h que o usuário marcou para reenviar. */
  const [cappedResendSelected, setCappedResendSelected] = useState<Set<string>>(() => new Set());
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [confirmRechecking, setConfirmRechecking] = useState(false);
  const freqCapSectionRef = useRef<HTMLDivElement | null>(null);

  const allMessages = useMemo(() => {
    return [message, ...messageStages].filter(Boolean);
  }, [message, messageStages]);

  const previewSamples = useMemo(() => {
    return allRecipients.slice(0, 3).map((r) => ({
      ...r,
      preview: allMessages.map((tmpl) => renderMessage(tmpl, r.vars)),
    }));
  }, [allRecipients, allMessages]);

  const hasUnresolved = previewSamples.some((s) =>
    s.preview.some((p) => hasUnresolvedCampaignTemplateTokens(p))
  );

  const recipientsRef = useRef(allRecipients);
  const connectionIdsRef = useRef(selectedConnectionIds);
  const connectionsRef = useRef(connections);
  recipientsRef.current = allRecipients;
  connectionIdsRef.current = selectedConnectionIds;
  connectionsRef.current = connections;

  /** Base grande: o check 24h no cliente trava o modal (payload + re-render). O servidor aplica o cap no envio. */
  const LARGE_FREQ_CAP_CLIENT = 1_500;

  const applyFrequencyCapApiResult = useCallback(
    (
      recipients: SampleRecipient[],
      res: { contacts: Array<{ phoneKey: string; capped?: boolean; lastSentAt?: string }>; cappedCount: number; degraded?: boolean },
      resetResendSelection: boolean
    ) => {
      const { triaged, cappedCount: cappedFromTriage } = triageRecipientsForFreqCap(recipients, res.contacts);
      setTriagedContacts(triaged);
      setCappedCount(cappedFromTriage);
      if (resetResendSelection) {
        setCappedResendSelected(new Set());
      }
      const degraded = res.degraded === true;
      setFreqCapDegraded(degraded);
      if (degraded) {
        setFreqCapStatus(freqCapStatusAfterCheck(false, true));
        if (cappedFromTriage === 0) {
          setShowAllContacts(true);
        }
        return;
      }
      setFreqCapStatus('ok');
      if (cappedFromTriage > 0) {
        setShowAllContacts(true);
      }
    },
    []
  );

  const runFrequencyCapCheck = useCallback(
    async (opts?: { resetResendSelection?: boolean }) => {
      const recipients = recipientsRef.current;
      const resetResendSelection = opts?.resetResendSelection !== false;
      setFreqCapStatus('checking');
      if (resetResendSelection) {
        setCappedResendSelected(new Set());
      }
      const phones = recipients.map((r) => r.phone.replace(/\D/g, '')).filter((p) => p.length >= 10);

      if (phones.length > LARGE_FREQ_CAP_CLIENT) {
        setTriagedContacts(
          recipients.slice(0, 6).map((r) => ({
            phone: r.phone.replace(/\D/g, ''),
            name: r.name || r.phone,
            vars: r.vars,
            capped: false,
          }))
        );
        setCappedCount(0);
        setFreqCapDegraded(false);
        setFreqCapStatus('ok');
        return;
      }

      try {
        const res = await apiFrequencyCapCheck(phones);
        applyFrequencyCapApiResult(recipients, res, resetResendSelection);
      } catch {
        setTriagedContacts(
          recipients.slice(0, 6).map((r) => ({
            phone: r.phone.replace(/\D/g, ''),
            name: r.name || r.phone,
            vars: r.vars,
            capped: false,
          }))
        );
        setCappedCount(0);
        setFreqCapDegraded(true);
        setFreqCapStatus(freqCapStatusAfterCheck(false, true));
        setShowAllContacts(true);
      }
    },
    [applyFrequencyCapApiResult]
  );

  const runHealthCheck = useCallback(async () => {
    const ids = connectionIdsRef.current;
    const localConnections = connectionsRef.current;
    setMotorStatus(isBackendConnected ? 'checking' : 'reconnecting');
    setChipStatus('checking');
    setChipUsedLocalFallback(false);
    setChipPreflightError(null);

    const motorP = ensureDispatchReady({ maxAttempts: 3, tryReconnect: true })
      .then((h) => {
        setMotorStatus(motorStatusFromDispatchHealth(h));
      })
      .catch(() => {
        setMotorStatus('warn');
      });

    const chipP = (async () => {
      if (ids.length === 0) {
        setChipResults([]);
        setChipStatus('warn');
        return;
      }
      try {
        const res = await apiPreflightCheck(ids);
        setChipResults(res.results);
        setChipStatus(res.allReady ? 'ok' : res.results.some((r) => r.isReady) ? 'warn' : 'error');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Falha na verificação dos chips';
        setChipPreflightError(msg);
        const fallback = chipResultsFromLocalConnections(ids, localConnections);
        setChipResults(fallback);
        setChipUsedLocalFallback(true);
        setChipStatus(chipStatusFromResults(fallback, { usedLocalFallback: true }));
      }
    })();

    await Promise.all([motorP, chipP]);
  }, [isBackendConnected]);

  // Uma única verificação ao abrir — NÃO reexecuta quando o pai re-renderiza a lista (base grande).
  useEffect(() => {
    if (isOpen) {
      void runHealthCheck();
      void runFrequencyCapCheck();
    } else {
      setMotorStatus('idle');
      setChipStatus('idle');
      setChipResults([]);
      setShowChipDetails(false);
      setFreqCapStatus('idle');
      setFreqCapDegraded(false);
      setTriagedContacts([]);
      setCappedCount(0);
      setCappedResendSelected(new Set());
      setShowAllContacts(false);
      setChipUsedLocalFallback(false);
      setChipPreflightError(null);
      setConfirmRechecking(false);
    }
  }, [isOpen, runHealthCheck, runFrequencyCapCheck]);

  useEffect(() => {
    if (!isOpen || cappedCount <= 0) return;
    freqCapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [isOpen, cappedCount]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => {
      setMotorStatus((s) => (s === 'checking' ? 'warn' : s));
      setChipStatus((s) => (s === 'checking' ? 'warn' : s));
      setFreqCapStatus((s) => {
        if (s !== 'checking') return s;
        setFreqCapDegraded(true);
        return freqCapStatusAfterCheck(false, true);
      });
    }, 28_000);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  const triageComplete =
    freqCapStatus === 'ok' || freqCapStatus === 'warn' || freqCapStatus === 'error';
  const needsRepeatConfirm = cappedCount > 0 && freqCapStatus === 'ok';
  const largeBaseSkipClientCap = contactCount > LARGE_FREQ_CAP_CLIENT;
  const dispatchableCount = computeDispatchableAfterFreqCap({
    contactCount,
    cappedCount,
    selectedCappedKeys: cappedResendSelected,
    largeBaseSkipClientCap,
  });

  const toggleCappedResend = useCallback((phone: string, include: boolean) => {
    const key = phoneKeyForFreqPreview(phone);
    if (key.length < 8) return;
    setCappedResendSelected((prev) => {
      const next = new Set(prev);
      if (include) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const cappedInPreview = useMemo(
    () => triagedContacts.filter((c) => c.capped),
    [triagedContacts]
  );
  const allCappedSelected =
    cappedInPreview.length > 0 &&
    cappedInPreview.every((c) => cappedResendSelected.has(phoneKeyForFreqPreview(c.phone)));

  const freqCapBlocksDispatch =
    triageComplete &&
    !largeBaseSkipClientCap &&
    contactCount > 0 &&
    dispatchableCount <= 0;

  const overallHealth: HealthStatus =
    chipStatus === 'error'
      ? 'error'
      : motorStatus === 'checking' || chipStatus === 'checking' || freqCapStatus === 'checking'
      ? 'checking'
      : motorStatus === 'reconnecting'
      ? 'reconnecting'
      : freqCapBlocksDispatch
      ? 'warn'
      : chipStatus === 'ok' && (motorStatus === 'ok' || motorStatus === 'warn') && triageComplete
      ? 'ok'
      : motorStatus === 'warn' || freqCapStatus === 'warn' || freqCapStatus === 'error' || chipStatus === 'warn'
      ? 'warn'
      : 'idle';

  const chipHintKey = chipStatusHint(chipStatus, {
    selectedCount: selectedConnectionIds.length,
    usedLocalFallback: chipUsedLocalFallback,
    preflightError: chipPreflightError,
  });
  const chipStatusLine = formatChipStatusLine(chipStatus, chipResults, chipHintKey);

  const chipsConfirmedOffline =
    chipStatus === 'error' && chipResults.length > 0 && chipResults.every((r) => !r.isReady);
  const canDispatch =
    !hasUnresolved &&
    !chipsConfirmedOffline &&
    motorStatus !== 'error' &&
    dispatchableCount > 0 &&
    freqCapStatus !== 'checking' &&
    !confirmRechecking &&
    (isBackendConnected || chipUsedLocalFallback);

  const handleConfirmDispatch = useCallback(async () => {
    if (confirmRechecking || isLoading) return;
    const recipients = recipientsRef.current;
    setConfirmRechecking(true);
    try {
      if (recipients.length <= LARGE_FREQ_CAP_CLIENT) {
        const phones = recipients.map((r) => r.phone.replace(/\D/g, '')).filter((p) => p.length >= 10);
        const res = await apiFrequencyCapCheck(phones);
        applyFrequencyCapApiResult(recipients, res, false);
        const freshCapped = triageRecipientsForFreqCap(recipients, res.contacts).cappedCount;
        const freshDispatchable = computeDispatchableAfterFreqCap({
          contactCount: recipients.length,
          cappedCount: freshCapped,
          selectedCappedKeys: cappedResendSelected,
          largeBaseSkipClientCap: false,
        });
        if (freshDispatchable <= 0) {
          freqCapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const msg =
            freshCapped >= recipients.length
              ? `Nenhum envio possível: ${freshCapped} contato(s) já receberam mensagem nas últimas 24 h. Marque quem deve reenviar na lista abaixo.`
              : 'Nenhum contato selecionado para disparo. Marque reenvio (24 h) ou ajuste a lista.';
          toast.error(msg, { id: 'campaign-bootstrap', duration: 9000 });
          return;
        }
        const allowPhones = frequencyCapAllowPhonesFromTriaged(
          triageRecipientsForFreqCap(recipients, res.contacts).triaged,
          cappedResendSelected
        );
        onConfirm({
          skipFrequencyCap: false,
          frequencyCapAllowPhones: allowPhones.length > 0 ? allowPhones : undefined,
        });
        return;
      }
      const allowPhones = frequencyCapAllowPhonesFromTriaged(triagedContacts, cappedResendSelected);
      onConfirm({
        skipFrequencyCap: false,
        frequencyCapAllowPhones: allowPhones.length > 0 ? allowPhones : undefined,
      });
    } catch {
      toast.error(
        'Não foi possível reverificar o limite de 24 h. Clique em Reverificar ou tente de novo em instantes.',
        { id: 'campaign-bootstrap', duration: 9000 }
      );
    } finally {
      setConfirmRechecking(false);
    }
  }, [
    applyFrequencyCapApiResult,
    cappedResendSelected,
    confirmRechecking,
    isLoading,
    onConfirm,
    triagedContacts,
  ]);

  const palette = {
    ok: { bg: '#10b98115', border: '#10b98135', text: '#10b981', icon: <CheckCircle2 className="w-4 h-4" /> },
    error: { bg: '#ef444415', border: '#ef444435', text: '#ef4444', icon: <WifiOff className="w-4 h-4" /> },
    checking: { bg: 'var(--surface-1)', border: 'var(--border-subtle)', text: 'var(--text-3)', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
    reconnecting: { bg: '#f59e0b15', border: '#f59e0b35', text: '#f59e0b', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
    warn: { bg: '#f59e0b15', border: '#f59e0b35', text: '#f59e0b', icon: <AlertTriangle className="w-4 h-4" /> },
    idle: { bg: 'var(--surface-1)', border: 'var(--border-subtle)', text: 'var(--text-3)', icon: <Wifi className="w-4 h-4" /> },
  };

  const footerActions = (
    <>
      <Button variant="ghost" size="sm" onClick={onClose} leftIcon={<X className="w-4 h-4" />}>
        Cancelar
      </Button>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {!isBackendConnected && (
          <span className="text-[11px] text-amber-500 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Servidor em reconexão — aguarde ou clique em Reverificar
          </span>
        )}
        {overallHealth === 'error' && (
          <span className="text-[11px] text-red-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {isAdmin ? 'Corrija os problemas acima' : 'Aguarde a sincronização ou clique em Reverificar'}
          </span>
        )}
        {overallHealth === 'ok' && needsRepeatConfirm && dispatchableCount === 0 && (
          <span className="text-[11px] text-amber-500 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Todos estão no limite 24 h — marque quem reenviar ou mude a lista
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleConfirmDispatch()}
          loading={isLoading || confirmRechecking}
          leftIcon={isLoading || confirmRechecking ? undefined : <Rocket className="w-4 h-4" />}
          disabled={!canDispatch}
        >
          {launchMode === 'schedule'
            ? `Confirmar agendamento (${dispatchableCount.toLocaleString('pt-BR')})`
            : `Confirmar e disparar (${dispatchableCount.toLocaleString('pt-BR')})`}
        </Button>
      </div>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3 flex-wrap">{footerActions}</div>
      }
    >
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
              {overallHealth === 'warn' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
              {overallHealth === 'error' && <AlertTriangle className="w-4 h-4 text-red-500" />}
              {overallHealth === 'idle' && <Wifi className="w-4 h-4" style={{ color: 'var(--text-3)' }} />}
              <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
                {overallHealth === 'checking' ? 'Preparando envio…' :
                 overallHealth === 'reconnecting' ? 'Sincronizando com o servidor…' :
                 overallHealth === 'ok' ? 'Tudo pronto para disparar!' :
                 freqCapBlocksDispatch
                   ? 'Limite 24 h — marque reenvio para disparar'
                   : overallHealth === 'warn' ? 'Verificação incompleta — confira o limite 24 h' :
                 overallHealth === 'error' ? (isAdmin ? 'Problema detectado — veja abaixo' : 'Aguarde um instante e tente novamente') :
                 'Verificação de pré-disparo'}
              </span>
            </div>
            <button
              onClick={() => {
                runHealthCheck();
                void runFrequencyCapCheck();
              }}
              className="flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1"
              style={{ background: 'var(--surface-0)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
              disabled={overallHealth === 'checking'}
            >
              <RefreshCw className={`w-3 h-3 ${overallHealth === 'checking' ? 'animate-spin' : ''}`} />
              Reverificar
            </button>
          </div>

          <div className="px-4 py-3 grid grid-cols-2 gap-2">
            {/* Motor de envio */}
            {(['idle', 'checking', 'ok', 'error', 'warn', 'reconnecting'] as HealthStatus[]).includes(motorStatus) && (
              <div
                className="rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: palette[motorStatus].bg, border: `1px solid ${palette[motorStatus].border}` }}
              >
                <span style={{ color: palette[motorStatus].text }}>{palette[motorStatus].icon}</span>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: 'var(--text-1)' }}>Motor de envio</div>
                  <div className="text-[10px]" style={{ color: palette[motorStatus].text }}>
                    {motorStatus === 'ok' ? 'Pronto' :
                     motorStatus === 'error' ? (isAdmin ? 'Indisponível — ver correção' : 'Reconectando…') :
                     motorStatus === 'reconnecting' ? 'Sincronizando…' :
                     motorStatus === 'warn' ? 'Sem confirmação na rede (pode disparar)' :
                     motorStatus === 'checking' ? 'Verificando…' : 'Não verificado'}
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
                  {chipStatusLine}
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

          {/* Correção técnica — só para administradores da plataforma */}
          {motorStatus === 'error' && isAdmin && (
            <div className="px-4 pb-3">
              <DispatchFixPanel compact />
            </div>
          )}
          {motorStatus === 'error' && !isAdmin && (
            <div className="px-4 pb-3">
              <div
                className="rounded-xl px-3.5 py-3 flex items-start gap-2.5"
                style={{ background: '#f59e0b12', border: '1px solid #f59e0b35' }}
              >
                <Loader2 className="w-4 h-4 shrink-0 mt-0.5 text-amber-500 animate-spin" />
                <p className="text-[11.5px] leading-snug" style={{ color: 'var(--text-2)' }}>
                  O servidor está se preparando para o envio. Aguarde alguns segundos e clique em{' '}
                  <strong>Reverificar</strong>. Se persistir, recarregue a página.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── TRIAGEM DE CONTATOS (limite 24 h) ─────────────────────────── */}
        <div
          ref={freqCapSectionRef}
          className="rounded-2xl overflow-hidden"
          style={{
            border: `1px solid ${cappedCount > 0 || freqCapDegraded ? '#f59e0b55' : 'var(--border-subtle)'}`,
          }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between gap-2"
            style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {freqCapStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--text-3)' }} />}
              {freqCapStatus === 'ok' && cappedCount === 0 && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />}
              {freqCapStatus === 'ok' && cappedCount > 0 && <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />}
              {(freqCapStatus === 'error' || freqCapStatus === 'warn') && freqCapDegraded && (
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              )}
              {freqCapStatus === 'error' && !freqCapDegraded && (
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
              )}
              <span className="text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                {freqCapStatus === 'checking'
                  ? 'Verificando contatos (limite 24 h)…'
                  : freqCapStatus === 'warn' && freqCapDegraded
                  ? 'Limite 24 h: verificação parcial — aplicado no envio'
                  : freqCapStatus === 'error'
                  ? 'Não foi possível verificar o limite de 24 h'
                  : largeBaseSkipClientCap
                  ? `Base grande (${contactCount.toLocaleString('pt-BR')}): limite 24 h aplicado no envio`
                  : freqCapDegraded && cappedCount === 0
                  ? 'Limite 24 h não confirmado — reverifique antes de disparar'
                  : cappedCount > 0
                  ? `${cappedCount} no limite 24 h · ${dispatchableCount.toLocaleString('pt-BR')} no disparo`
                  : `Todos os ${contactCount} contatos liberados`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {needsRepeatConfirm && cappedInPreview.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (allCappedSelected) {
                      setCappedResendSelected(new Set());
                    } else {
                      setCappedResendSelected(
                        new Set(cappedInPreview.map((c) => phoneKeyForFreqPreview(c.phone)).filter((k) => k.length >= 8))
                      );
                    }
                  }}
                  className="text-[10px] font-bold rounded-lg px-2 py-1"
                  style={{ background: 'var(--surface-0)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
                >
                  {allCappedSelected ? 'Desmarcar 24 h' : 'Marcar todos (24 h)'}
                </button>
              )}
              {triagedContacts.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllContacts((v) => !v)}
                  className="text-[10px] font-bold rounded-lg px-2 py-1"
                  style={{ background: 'var(--surface-0)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
                >
                  {showAllContacts ? 'Recolher' : `Ver todos (${triagedContacts.length})`}
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-3 space-y-1.5 max-h-48 sm:max-h-56 overflow-y-auto">
            {freqCapStatus === 'checking' && triagedContacts.length === 0 && (
              <div className="text-[11px] py-4 text-center" style={{ color: 'var(--text-3)' }}>
                Carregando lista de contatos…
              </div>
            )}
            {(showAllContacts ? triagedContacts : triagedContacts.slice(0, 6)).map((c, idx) => {
              const phoneKey = phoneKeyForFreqPreview(c.phone);
              const included = !c.capped || cappedResendSelected.has(phoneKey);
              return (
              <div
                key={`${c.phone}-${idx}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{
                  background: c.capped ? '#f59e0b08' : '#10b98108',
                  border: `1px solid ${c.capped ? '#f59e0b25' : '#10b98120'}`,
                  opacity: c.capped && !included ? 0.65 : 1,
                }}
              >
                <label className="flex items-center shrink-0 cursor-pointer" title={c.capped ? 'Incluir no disparo (reenviar)' : 'Liberado para envio'}>
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5"
                    checked={included}
                    disabled={!c.capped}
                    onChange={(e) => toggleCappedResend(c.phone, e.target.checked)}
                  />
                </label>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black text-white shrink-0"
                  style={{ background: `hsl(${(idx * 137) % 360},60%,50%)` }}
                >
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                    {c.name}
                  </div>
                  <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-3)' }}>
                    {c.phone}
                    {c.capped && c.lastSentAt ? ` · ${formatRelativeHours(c.lastSentAt)}` : ''}
                  </div>
                </div>
                <span
                  className="text-[9px] font-bold rounded-full px-2 py-0.5 shrink-0"
                  style={{
                    background: c.capped ? '#f59e0b' : '#10b981',
                    color: '#fff',
                  }}
                >
                  {c.capped ? (included ? 'Reenviar' : '24 h') : 'OK'}
                </span>
              </div>
            );
            })}
            {!showAllContacts && triagedContacts.length > 6 && (
              <p className="text-[10px] text-center pt-1" style={{ color: 'var(--text-3)' }}>
                + {triagedContacts.length - 6} contato(s) oculto(s)
              </p>
            )}
          </div>

          {(needsRepeatConfirm || freqCapDegraded) && (
            <div className="mx-4 mb-3">
              <p className="text-[11px] leading-snug px-1" style={{ color: 'var(--text-3)' }}>
                {freqCapDegraded && cappedCount === 0
                  ? 'A verificação do limite 24 h ficou incompleta (servidor/Redis). Clique em Reverificar ou confirme de novo — o sistema reaplica o limite antes de enfileirar.'
                  : (
                    <>
                      Contatos com badge <strong>24 h</strong> já receberam mensagem hoje — por padrão ficam de
                      fora. Marque na lista quem deve <strong>reenviar</strong>; os demais seguem liberados
                      normalmente.
                    </>
                  )}
              </p>
            </div>
          )}
        </div>

        {/* ── PREVIEW DAS MENSAGENS ─────────────────────────────────────── */}
        {previewSamples.length > 0 && (
          <div>
            <p className="text-[11px] font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Amostra — {previewSamples.length} contato{previewSamples.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
              {previewSamples.map((s, idx) => {
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

      </div>
    </Modal>
  );
};
