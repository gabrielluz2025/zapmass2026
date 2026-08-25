import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  Loader2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Layers,
  MessageCircle,
  Phone,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { apiNormalizeContactsAll, apiValidateContactsWhatsApp } from '../../services/contactsApi';
import { ConnectionStatus, type WhatsAppConnection } from '../../types';

type Props = {
  open: boolean;
  onClose: () => void;
  totalContacts: number;
  duplicateCount?: number;
  connections?: WhatsAppConnection[];
  onApplied?: () => void;
  onStartDedupe?: () => void;
  dedupeBusy?: boolean;
};

type FixMode = 'format' | 'whatsapp';
type RunPhase = 'idle' | 'preview' | 'apply';

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome',
  phone: 'Telefone',
  city: 'Cidade',
  state: 'Estado',
  neighborhood: 'Bairro',
  street: 'Rua',
  zipCode: 'CEP',
  number: 'Número',
};

const WA_RESULT_LABEL: Record<string, string> = {
  found: 'Tem WhatsApp',
  corrected: 'Corrigido (9º dígito)',
  missing: 'Sem WhatsApp',
  invalid_format: 'Formato inválido',
  uncertain: 'Indeterminado',
};

export const ContactBaseFixModal: React.FC<Props> = ({
  open,
  onClose,
  totalContacts,
  duplicateCount = 0,
  connections = [],
  onApplied,
  onStartDedupe,
  dedupeBusy = false,
}) => {
  const [mode, setMode] = useState<FixMode>('format');
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [connectionId, setConnectionId] = useState('');

  const [formatProgress, setFormatProgress] = useState({ scanned: 0, changed: 0 });
  const [fieldTotals, setFieldTotals] = useState<Record<string, number>>({});
  const [formatSamples, setFormatSamples] = useState<Array<{ field: string; before: string; after: string }>>([]);
  const [invalidPhoneCount, setInvalidPhoneCount] = useState(0);
  const [phoneIssueSamples, setPhoneIssueSamples] = useState<Array<{ before: string; after: string }>>([]);

  const [waProgress, setWaProgress] = useState({ scanned: 0, onWhatsApp: 0, corrected: 0, missing: 0 });
  const [waSamples, setWaSamples] = useState<
    Array<{ name: string; before: string; after?: string; result: string }>
  >([]);
  const [waTotals, setWaTotals] = useState({
    onWhatsApp: 0,
    phoneCorrected: 0,
    notOnWhatsApp: 0,
    invalidFormat: 0,
    uncertain: 0,
  });

  const [done, setDone] = useState(false);
  const [applied, setApplied] = useState(false);

  const connectedChips = useMemo(
    () => connections.filter((c) => c.status === ConnectionStatus.CONNECTED),
    [connections]
  );

  useEffect(() => {
    if (!open) return;
    const preferred =
      connectedChips[0]?.id ||
      connections.find((c) => c.status === ConnectionStatus.CONNECTED)?.id ||
      connections[0]?.id ||
      '';
    setConnectionId(preferred);
  }, [open, connectedChips, connections]);

  const reset = useCallback(() => {
    setMode('format');
    setPhase('idle');
    setBusy(false);
    setFormatProgress({ scanned: 0, changed: 0 });
    setFieldTotals({});
    setFormatSamples([]);
    setInvalidPhoneCount(0);
    setPhoneIssueSamples([]);
    setWaProgress({ scanned: 0, onWhatsApp: 0, corrected: 0, missing: 0 });
    setWaSamples([]);
    setWaTotals({ onWhatsApp: 0, phoneCorrected: 0, notOnWhatsApp: 0, invalidFormat: 0, uncertain: 0 });
    setDone(false);
    setApplied(false);
  }, []);

  const runFormatPaginated = useCallback(async (dryRun: boolean) => {
    setBusy(true);
    setDone(false);
    setPhase(dryRun ? 'preview' : 'apply');
    setFormatProgress({ scanned: 0, changed: 0 });
    setFieldTotals({});
    setFormatSamples([]);
    setInvalidPhoneCount(0);
    setPhoneIssueSamples([]);

    let offset = 0;
    let totalScanned = 0;
    let totalChanged = 0;
    let totalInvalidPhones = 0;
    const totals: Record<string, number> = {};
    const collectedSamples: Array<{ field: string; before: string; after: string }> = [];
    const collectedPhoneIssues: Array<{ before: string; after: string }> = [];

    try {
      for (;;) {
        const result = await apiNormalizeContactsAll({ offset, limit: 2000, dryRun });
        totalScanned += result.scanned;
        totalChanged += result.changed;
        totalInvalidPhones += result.invalidPhoneCount;
        offset = result.nextOffset;
        setFormatProgress({ scanned: totalScanned, changed: totalChanged });
        setInvalidPhoneCount(totalInvalidPhones);

        for (const [field, count] of Object.entries(result.fieldTotals)) {
          totals[field] = (totals[field] || 0) + count;
        }
        setFieldTotals({ ...totals });

        for (const s of result.samples) {
          if (collectedSamples.length < 20) collectedSamples.push(s);
        }
        setFormatSamples([...collectedSamples]);

        for (const s of result.phoneIssueSamples) {
          if (collectedPhoneIssues.length < 8) collectedPhoneIssues.push(s);
        }
        setPhoneIssueSamples([...collectedPhoneIssues]);

        if (!result.hasMore) break;
      }

      setDone(true);
      setApplied(!dryRun && totalChanged > 0);

      if (dryRun) {
        if (totalChanged === 0 && totalInvalidPhones === 0) {
          toast(
            'Formato já padronizado. Se ainda houver falhas, use a aba Validar WhatsApp — muitas vezes o 9º dígito está errado.',
            { icon: 'ℹ️', duration: 7000 }
          );
        } else {
          toast.success(
            `${totalChanged.toLocaleString('pt-BR')} contato(s) com ajuste de formato em ${totalScanned.toLocaleString('pt-BR')} analisados.`
          );
        }
      } else if (totalChanged > 0) {
        toast.success(`${totalChanged.toLocaleString('pt-BR')} contato(s) corrigidos!`);
        onApplied?.();
      } else {
        toast('Nada a corrigir no formato.', { icon: 'ℹ️' });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao corrigir contatos.');
    } finally {
      setBusy(false);
    }
  }, [onApplied]);

  const runWhatsAppPaginated = useCallback(async (dryRun: boolean) => {
    if (!connectionId) {
      toast.error('Selecione um chip conectado para validar no WhatsApp.');
      return;
    }

    setBusy(true);
    setDone(false);
    setPhase(dryRun ? 'preview' : 'apply');
    setWaProgress({ scanned: 0, onWhatsApp: 0, corrected: 0, missing: 0 });
    setWaSamples([]);
    setWaTotals({ onWhatsApp: 0, phoneCorrected: 0, notOnWhatsApp: 0, invalidFormat: 0, uncertain: 0 });

    let offset = 0;
    let totalScanned = 0;
    const totals = { onWhatsApp: 0, phoneCorrected: 0, notOnWhatsApp: 0, invalidFormat: 0, uncertain: 0 };
    const collectedSamples: typeof waSamples = [];

    try {
      for (;;) {
        const result = await apiValidateContactsWhatsApp({
          offset,
          limit: 50,
          dryRun,
          connectionId,
          markMissingInvalid: true,
        });
        totalScanned += result.scanned;
        totals.onWhatsApp += result.onWhatsApp;
        totals.phoneCorrected += result.phoneCorrected;
        totals.notOnWhatsApp += result.notOnWhatsApp;
        totals.invalidFormat += result.invalidFormat;
        totals.uncertain += result.uncertain;
        offset = result.nextOffset;

        setWaProgress({
          scanned: totalScanned,
          onWhatsApp: totals.onWhatsApp,
          corrected: totals.phoneCorrected,
          missing: totals.notOnWhatsApp + totals.invalidFormat,
        });
        setWaTotals({ ...totals });

        for (const s of result.samples) {
          if (collectedSamples.length < 20) collectedSamples.push(s);
        }
        setWaSamples([...collectedSamples]);

        if (!result.hasMore) break;
      }

      setDone(true);
      setApplied(!dryRun && (totals.phoneCorrected > 0 || totals.notOnWhatsApp > 0 || totals.invalidFormat > 0));

      if (dryRun) {
        toast.success(
          `Prévia: ${totals.onWhatsApp.toLocaleString('pt-BR')} com WhatsApp · ${totals.phoneCorrected.toLocaleString('pt-BR')} precisam corrigir 9º dígito · ${(totals.notOnWhatsApp + totals.invalidFormat).toLocaleString('pt-BR')} sem WhatsApp ou inválidos.`,
          { duration: 8000 }
        );
      } else {
        toast.success(
          `Validação concluída: ${totals.phoneCorrected.toLocaleString('pt-BR')} telefone(s) corrigidos · ${(totals.notOnWhatsApp + totals.invalidFormat).toLocaleString('pt-BR')} marcados como inválidos.`
        );
        onApplied?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao validar WhatsApp.');
    } finally {
      setBusy(false);
    }
  }, [connectionId, onApplied]);

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleApplyFormat = () => {
    if (formatProgress.changed === 0) {
      toast('Rode a prévia primeiro ou não há alterações de formato pendentes.');
      return;
    }
    if (
      !window.confirm(
        `Corrigir ${formatProgress.changed.toLocaleString('pt-BR')} contato(s) na base? Atualiza nome, telefone e endereço.`
      )
    ) {
      return;
    }
    void runFormatPaginated(false);
  };

  const handleApplyWhatsApp = () => {
    if (waProgress.scanned === 0) {
      toast('Rode a prévia de WhatsApp antes de aplicar.');
      return;
    }
    const toFix = waTotals.phoneCorrected;
    const toInvalidate = waTotals.notOnWhatsApp + waTotals.invalidFormat;
    if (
      !window.confirm(
        `Aplicar validação WhatsApp?\n\n· ${toFix.toLocaleString('pt-BR')} telefone(s) serão corrigidos (ex.: 9º dígito)\n· ${toInvalidate.toLocaleString('pt-BR')} contato(s) marcados como inválidos (não recebem campanha)\n\nDepois use "Reenviar falhas" nas campanhas afetadas.`
      )
    ) {
      return;
    }
    void runWhatsAppPaginated(false);
  };

  const fieldLines = Object.entries(fieldTotals).filter(([, n]) => n > 0);
  const hasConnectedChip = connectedChips.length > 0;

  const footer = (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
      <Button variant="ghost" type="button" disabled={busy || dedupeBusy} onClick={handleClose}>
        Fechar
      </Button>

      {mode === 'format' ? (
        <>
          <Button
            variant="secondary"
            type="button"
            loading={busy && phase === 'preview'}
            disabled={busy || dedupeBusy || totalContacts === 0}
            onClick={() => void runFormatPaginated(true)}
          >
            Ver o que mudaria
          </Button>
          {duplicateCount > 0 && onStartDedupe && (
            <Button
              variant="primary"
              type="button"
              loading={dedupeBusy}
              disabled={busy || dedupeBusy || totalContacts === 0}
              onClick={onStartDedupe}
            >
              Unir duplicados
            </Button>
          )}
          <Button
            variant={duplicateCount > 0 ? 'secondary' : 'primary'}
            type="button"
            loading={busy && phase === 'apply'}
            disabled={busy || dedupeBusy || totalContacts === 0}
            onClick={handleApplyFormat}
          >
            Corrigir formato
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="secondary"
            type="button"
            loading={busy && phase === 'preview'}
            disabled={busy || dedupeBusy || totalContacts === 0 || !hasConnectedChip}
            onClick={() => void runWhatsAppPaginated(true)}
          >
            Prévia WhatsApp
          </Button>
          <Button
            variant="primary"
            type="button"
            loading={busy && phase === 'apply'}
            disabled={busy || dedupeBusy || totalContacts === 0 || !hasConnectedChip}
            onClick={handleApplyWhatsApp}
          >
            Aplicar validação
          </Button>
        </>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title="Corrigir base de contatos"
      subtitle="Padronize telefones e valide no WhatsApp real do chip — reduz falhas de 'número não encontrado' no disparo."
      icon={<Database className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
      footer={footer}
    >
      <div className="space-y-4 text-[13px]" style={{ color: 'var(--text-1)' }}>
        <div
          className="flex rounded-xl border p-1 gap-1"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              setMode('format');
              setDone(false);
            }}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
            style={{
              background: mode === 'format' ? 'var(--brand-600)' : 'transparent',
              color: mode === 'format' ? '#fff' : 'var(--text-2)',
            }}
          >
            <Phone className="w-3.5 h-3.5" />
            Formato
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              setMode('whatsapp');
              setDone(false);
            }}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
            style={{
              background: mode === 'whatsapp' ? 'var(--brand-600)' : 'transparent',
              color: mode === 'whatsapp' ? '#fff' : 'var(--text-2)',
            }}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Validar WhatsApp
          </button>
        </div>

        {duplicateCount > 0 && mode === 'format' && (
          <div
            className="rounded-xl border p-4 space-y-2"
            style={{ borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)' }}
          >
            <div className="flex items-center gap-2 font-semibold">
              <Layers className="w-4 h-4 text-amber-500" />
              {duplicateCount.toLocaleString('pt-BR')} contato(s) com número repetido na base
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              O mesmo número pode estar em várias listas. A união mantém o cadastro mais completo e
              apaga só as linhas extras.
            </p>
          </div>
        )}

        {mode === 'format' ? (
          <div
            className="rounded-xl border p-4 space-y-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
          >
            <p className="font-semibold">Passo 1 — Ajuste de formato</p>
            <ul className="list-disc pl-5 space-y-1" style={{ color: 'var(--text-2)' }}>
              <li><strong>Telefone:</strong> DDI 55, remove 0 do tronco, corrige 9º dígito, remove DDI duplicado</li>
              <li><strong>Nome:</strong> capitalização, espaços e caracteres estranhos</li>
              <li><strong>Endereço:</strong> UF, cidade, bairro, CEP e abreviações comuns</li>
            </ul>
            <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
              Base: <strong>{totalContacts.toLocaleString('pt-BR')}</strong> contato(s). Depois do formato,
              use a aba <strong>Validar WhatsApp</strong> — é ela que confirma se o número existe de verdade.
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
          >
            <p className="font-semibold">Passo 2 — Validação real no WhatsApp</p>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Consulta o chip conectado (API Evolution) e testa variantes com/sem 9º dígito.
              Corrige o telefone quando o WhatsApp confirma outro formato e marca como inválido quem
              realmente não tem conta — evitando falhas falsas no disparo.
            </p>

            {!hasConnectedChip ? (
              <div
                className="rounded-lg border px-3 py-2 text-[12px] flex items-start gap-2"
                style={{ borderColor: 'rgba(251,191,36,0.4)', color: 'var(--text-2)' }}
              >
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                Conecte pelo menos um chip WhatsApp antes de validar. Sem chip online a consulta não funciona.
              </div>
            ) : (
              <label className="block text-[12px] space-y-1">
                <span style={{ color: 'var(--text-2)' }}>Chip para consulta</span>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-1)' }}
                  value={connectionId}
                  disabled={busy}
                  onChange={(e) => setConnectionId(e.target.value)}
                >
                  {connectedChips.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id}
                      {c.phoneNumber ? ` · ${c.phoneNumber}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              Bases grandes levam alguns minutos (≈50 contatos por lote). Após aplicar, reenvie falhas nas campanhas.
            </p>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-3 rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
            <span>
              {mode === 'format' ? (
                <>
                  {phase === 'preview' ? 'Analisando formato' : 'Corrigindo formato'}…{' '}
                  {formatProgress.scanned.toLocaleString('pt-BR')} lidos ·{' '}
                  {formatProgress.changed.toLocaleString('pt-BR')}{' '}
                  {phase === 'preview' ? 'com alteração' : 'corrigidos'}
                </>
              ) : (
                <>
                  {phase === 'preview' ? 'Consultando WhatsApp' : 'Aplicando validação'}…{' '}
                  {waProgress.scanned.toLocaleString('pt-BR')} lidos ·{' '}
                  {waProgress.onWhatsApp.toLocaleString('pt-BR')} OK ·{' '}
                  {waProgress.corrected.toLocaleString('pt-BR')} a corrigir ·{' '}
                  {waProgress.missing.toLocaleString('pt-BR')} sem WA
                </>
              )}
            </span>
          </div>
        )}

        {done && !busy && mode === 'format' && (
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{
              borderColor: applied ? 'rgba(16,185,129,0.35)' : 'var(--border)',
              background: applied ? 'rgba(16,185,129,0.06)' : 'var(--surface-0)',
            }}
          >
            <div className="flex items-center gap-2 font-semibold">
              {applied ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
              {applied
                ? `${formatProgress.changed.toLocaleString('pt-BR')} contato(s) corrigidos`
                : formatProgress.changed === 0
                  ? 'Nenhuma alteração de formato'
                  : `${formatProgress.changed.toLocaleString('pt-BR')} contato(s) precisam de correção de formato`}
            </div>

            {invalidPhoneCount > 0 && (
              <div
                className="rounded-lg border px-3 py-2 text-[12px] space-y-1"
                style={{ borderColor: 'rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.06)' }}
              >
                <strong>{invalidPhoneCount.toLocaleString('pt-BR')}</strong> telefone(s) com formato suspeito
                (tamanho ou DDD inválido). Use a aba <strong>Validar WhatsApp</strong> ou revise manualmente.
                {phoneIssueSamples.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                    {phoneIssueSamples.map((s, i) => (
                      <div key={i} className="opacity-80 truncate">
                        {s.before} → {s.after}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {formatProgress.changed === 0 && invalidPhoneCount === 0 && !applied && (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Formato OK. Se campanhas ainda falham com &quot;não encontrou WhatsApp&quot;, vá em
                <strong> Validar WhatsApp</strong> — o número pode estar certo no papel mas errado para a API
                (9º dígito, fixo vs celular).
              </p>
            )}

            {fieldLines.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fieldLines.map(([field, count]) => (
                  <span
                    key={field}
                    className="text-[11px] font-bold px-2 py-1 rounded-full"
                    style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}
                  >
                    {FIELD_LABEL[field] || field}: {count.toLocaleString('pt-BR')}
                  </span>
                ))}
              </div>
            )}

            {formatSamples.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {formatSamples.map((s, i) => (
                  <div key={`${s.field}-${i}`} className="text-[12px] flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-emerald-600">{FIELD_LABEL[s.field] || s.field}</span>
                    <span className="opacity-70 truncate max-w-[140px]" title={s.before}>{s.before || '—'}</span>
                    <ArrowRight className="w-3 h-3 opacity-40 shrink-0" />
                    <span className="truncate max-w-[180px]" title={s.after}>{s.after}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {done && !busy && mode === 'whatsapp' && (
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{
              borderColor: applied ? 'rgba(16,185,129,0.35)' : 'var(--border)',
              background: applied ? 'rgba(16,185,129,0.06)' : 'var(--surface-0)',
            }}
          >
            <div className="flex items-center gap-2 font-semibold">
              {applied ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
              {applied ? 'Validação WhatsApp aplicada' : 'Prévia da validação WhatsApp'}
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600">
                Com WhatsApp: {waTotals.onWhatsApp.toLocaleString('pt-BR')}
              </span>
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-sky-500/15 text-sky-600">
                9º dígito a corrigir: {waTotals.phoneCorrected.toLocaleString('pt-BR')}
              </span>
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-rose-500/15 text-rose-600">
                Sem WhatsApp: {waTotals.notOnWhatsApp.toLocaleString('pt-BR')}
              </span>
              <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}>
                Formato inválido: {waTotals.invalidFormat.toLocaleString('pt-BR')}
              </span>
              {waTotals.uncertain > 0 && (
                <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-amber-500/15 text-amber-700">
                  Indeterminado: {waTotals.uncertain.toLocaleString('pt-BR')}
                </span>
              )}
            </div>

            {!applied && waTotals.phoneCorrected > 0 && (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {waTotals.phoneCorrected.toLocaleString('pt-BR')} número(s) existem no WhatsApp com outro
                formato (geralmente 9º dígito). Aplicar corrige a base e reduz falhas no envio.
              </p>
            )}

            {waSamples.length > 0 && (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {waSamples.map((s, i) => (
                  <div key={`wa-${i}`} className="text-[12px] flex flex-wrap items-center gap-1.5">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background:
                          s.result === 'corrected'
                            ? 'rgba(14,165,233,0.15)'
                            : s.result === 'missing' || s.result === 'invalid_format'
                              ? 'rgba(244,63,94,0.12)'
                              : 'rgba(16,185,129,0.12)',
                        color:
                          s.result === 'corrected'
                            ? '#0284c7'
                            : s.result === 'missing' || s.result === 'invalid_format'
                              ? '#e11d48'
                              : '#059669',
                      }}
                    >
                      {WA_RESULT_LABEL[s.result] || s.result}
                    </span>
                    <span className="opacity-70 truncate max-w-[100px]" title={s.name}>{s.name}</span>
                    <span className="opacity-70 truncate max-w-[120px]" title={s.before}>{s.before}</span>
                    {s.after && s.after !== s.before && (
                      <>
                        <ArrowRight className="w-3 h-3 opacity-40 shrink-0" />
                        <span className="truncate max-w-[120px]" title={s.after}>{s.after}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
