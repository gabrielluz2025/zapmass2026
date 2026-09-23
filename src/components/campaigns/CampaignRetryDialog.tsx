import React from 'react';
import { AlertTriangle, Paperclip, RefreshCw, Smartphone } from 'lucide-react';
import { ConnectionStatus, WhatsAppConnection } from '../../types';
import { Button, Modal, Select } from '../ui';
import { fetchCampaignMediaAttachments } from '../../services/campaignsApi';
import {
  campaignOutboundErrorKindLabel,
  classifyCampaignOutboundError,
  isRetryableCampaignOutboundKind,
  type CampaignOutboundErrorKind,
} from '../../../shared/campaignOutboundErrorKind';

export type CampaignRetryFailedRow = {
  phone: string;
  errorMessage?: string;
  connectionId?: string;
};

export type CampaignRetryDialogState = {
  phones: string[];
  failedConnectionId?: string;
  /** Quando presente, permite filtrar por tipo de erro (padrão: só retryáveis). */
  failedRows?: CampaignRetryFailedRow[];
};

type RetryScope = 'safe' | 'all';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  state: CampaignRetryDialogState | null;
  campaignId: string;
  connections: WhatsAppConnection[];
  campaignConnectionIds: string[];
  loading?: boolean;
  onConfirm: (connectionId: string, phones: string[]) => void;
};

function countByKind(rows: CampaignRetryFailedRow[]): Record<CampaignOutboundErrorKind, number> {
  const out: Record<CampaignOutboundErrorKind, number> = {
    not_registered: 0,
    reachout_timelock: 0,
    chip_auth: 0,
    content_dup: 0,
    other: 0,
  };
  for (const r of rows) {
    out[classifyCampaignOutboundError(r.errorMessage)]++;
  }
  return out;
}

export const CampaignRetryDialog: React.FC<Props> = ({
  isOpen,
  onClose,
  state,
  campaignId,
  connections,
  campaignConnectionIds,
  loading = false,
  onConfirm,
}) => {
  const failedRows = state?.failedRows;
  const phonesFallback = state?.phones ?? [];
  const failedId = state?.failedConnectionId;
  const [mediaLabels, setMediaLabels] = React.useState<string[]>([]);
  const [scope, setScope] = React.useState<RetryScope>('safe');

  React.useEffect(() => {
    if (!isOpen || !campaignId) {
      setMediaLabels([]);
      return;
    }
    let cancelled = false;
    void fetchCampaignMediaAttachments(campaignId)
      .then((media) => {
        if (cancelled) return;
        const labels: string[] = [];
        if (media.mediaAttachment?.fileName) labels.push(media.mediaAttachment.fileName);
        if (media.followUpMediaAttachment?.fileName) labels.push(media.followUpMediaAttachment.fileName);
        setMediaLabels(labels);
      })
      .catch(() => {
        if (!cancelled) setMediaLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, campaignId]);

  React.useEffect(() => {
    if (!isOpen) return;
    setScope('safe');
  }, [isOpen, state?.phones?.join('|'), failedRows?.length]);

  const kindCounts = React.useMemo(
    () => (failedRows?.length ? countByKind(failedRows) : null),
    [failedRows]
  );

  const safePhones = React.useMemo(() => {
    if (!failedRows?.length) return phonesFallback;
    return failedRows
      .filter((r) => isRetryableCampaignOutboundKind(classifyCampaignOutboundError(r.errorMessage)))
      .map((r) => r.phone);
  }, [failedRows, phonesFallback]);

  const allPhones = failedRows?.length ? failedRows.map((r) => r.phone) : phonesFallback;
  const phones = scope === 'safe' && failedRows?.length ? safePhones : allPhones;
  const unsafeCount = allPhones.length - safePhones.length;

  const candidates = React.useMemo(() => {
    const ids = campaignConnectionIds.length > 0 ? campaignConnectionIds : connections.map((c) => c.id);
    const set = new Set(ids);
    return connections.filter((c) => set.has(c.id));
  }, [connections, campaignConnectionIds]);

  const failedConn = failedId ? connections.find((c) => c.id === failedId) : undefined;
  const failedOffline =
    failedConn != null && failedConn.status !== ConnectionStatus.CONNECTED;

  const [selectedId, setSelectedId] = React.useState('');

  React.useEffect(() => {
    if (!isOpen) return;
    const online = candidates.filter((c) => c.status === ConnectionStatus.CONNECTED);
    if (failedId && online.some((c) => c.id === failedId)) {
      setSelectedId(failedId);
      return;
    }
    if (online.length > 0) {
      setSelectedId(online[0].id);
      return;
    }
    setSelectedId(candidates[0]?.id ?? '');
  }, [isOpen, failedId, candidates]);

  const selectedOnline =
    candidates.find((c) => c.id === selectedId)?.status === ConnectionStatus.CONNECTED;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={phones.length === 1 && !failedRows?.length ? 'Reenviar mensagem' : 'Reenviar falhas'}
      size="md"
    >
      <div className="space-y-4">
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
          {failedRows?.length
            ? 'Escolha o chip e quais falhas reenviar. 463 (Meta) e números sem WhatsApp não devem ir em lote.'
            : phones.length === 1
              ? 'Confirme o chip de origem para reenviar a mensagem a este contato.'
              : `Reenviar de uma vez para ${phones.length} contatos com falha.`}
        </p>

        {kindCounts && (
          <div
            className="rounded-xl px-3 py-2.5 text-[12px] space-y-1.5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            {(Object.keys(kindCounts) as CampaignOutboundErrorKind[]).map((k) =>
              kindCounts[k] > 0 ? (
                <div key={k} className="flex justify-between gap-2" style={{ color: 'var(--text-2)' }}>
                  <span>{campaignOutboundErrorKindLabel(k)}</span>
                  <strong style={{ color: 'var(--text-1)' }}>{kindCounts[k]}</strong>
                </div>
              ) : null
            )}
          </div>
        )}

        {failedRows && failedRows.length > 0 && (
          <div className="space-y-2">
            <label className="ui-eyebrow mb-1 block">Quem reenviar</label>
            <Select value={scope} onChange={(e) => setScope(e.target.value as RetryScope)}>
              <option value="safe">
                Só chip/sessão e outros ({safePhones.length}) — recomendado
              </option>
              <option value="all">
                Todas as falhas ({allPhones.length}) — inclui 463 e sem WA
              </option>
            </Select>
            {scope === 'all' && unsafeCount > 0 && (
              <div
                className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px]"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)' }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                <span style={{ color: 'var(--text-2)' }}>
                  {unsafeCount} contato(s) com restrição Meta (463) ou sem WhatsApp. Reenviar em lote
                  queima chips e não resolve lista suja.
                </span>
              </div>
            )}
            {scope === 'safe' && safePhones.length === 0 && (
              <p className="text-[12px]" style={{ color: '#f59e0b' }}>
                Nenhuma falha segura para reenvio. Valide a base (sem WA) ou aqueça chips (463).
              </p>
            )}
          </div>
        )}

        {failedOffline && (
          <div
            className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px]"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <span style={{ color: 'var(--text-2)' }}>
              O chip <strong>{failedConn?.name || failedId}</strong> está offline. Escolha outro canal abaixo para
              redirecionar o reenvio.
            </span>
          </div>
        )}

        {mediaLabels.length > 0 && (
          <div
            className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-[12px]"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)' }}
          >
            <Paperclip className="w-4 h-4 shrink-0 mt-0.5 text-cyan-500" />
            <span style={{ color: 'var(--text-2)' }}>
              Anexo original incluído no reenvio: <strong>{mediaLabels.join(', ')}</strong>
            </span>
          </div>
        )}

        <div>
          <label className="ui-eyebrow mb-1.5 block">Chip de origem</label>
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Selecione…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status === ConnectionStatus.CONNECTED ? ' · online' : ' · offline'}
              </option>
            ))}
          </Select>
        </div>

        <ul className="text-[11px] space-y-1" style={{ color: 'var(--text-3)' }}>
          {candidates.slice(0, 4).map((c) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <Smartphone className="w-3 h-3" />
              {c.name} —{' '}
              <span style={{ color: c.status === ConnectionStatus.CONNECTED ? '#22c55e' : '#ef4444' }}>
                {c.status === ConnectionStatus.CONNECTED ? 'online' : 'offline'}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
            disabled={!selectedId || !selectedOnline || loading || phones.length === 0}
            onClick={() => onConfirm(selectedId, phones)}
          >
            {loading
              ? 'Reenviando…'
              : phones.length === 1
                ? 'Reenviar agora'
                : `Reenviar ${phones.length} de uma vez`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
