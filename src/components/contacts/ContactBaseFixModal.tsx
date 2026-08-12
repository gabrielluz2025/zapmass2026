import React, { useCallback, useState } from 'react';
import { Database, Loader2, ArrowRight, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { apiNormalizeContactsAll } from '../../services/contactsApi';

type Props = {
  open: boolean;
  onClose: () => void;
  totalContacts: number;
  duplicateCount?: number;
  onApplied?: () => void;
  onStartDedupe?: () => void;
  dedupeBusy?: boolean;
};

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

export const ContactBaseFixModal: React.FC<Props> = ({
  open,
  onClose,
  totalContacts,
  duplicateCount = 0,
  onApplied,
  onStartDedupe,
  dedupeBusy = false,
}) => {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, changed: 0 });
  const [fieldTotals, setFieldTotals] = useState<Record<string, number>>({});
  const [samples, setSamples] = useState<Array<{ field: string; before: string; after: string }>>([]);
  const [done, setDone] = useState(false);
  const [applied, setApplied] = useState(false);

  const reset = useCallback(() => {
    setPhase('idle');
    setBusy(false);
    setProgress({ scanned: 0, changed: 0 });
    setFieldTotals({});
    setSamples([]);
    setDone(false);
    setApplied(false);
  }, []);

  const runPaginated = useCallback(async (dryRun: boolean) => {
    setBusy(true);
    setDone(false);
    setPhase(dryRun ? 'preview' : 'apply');
    setProgress({ scanned: 0, changed: 0 });
    setFieldTotals({});
    setSamples([]);

    let offset = 0;
    let totalScanned = 0;
    let totalChanged = 0;
    const totals: Record<string, number> = {};
    const collectedSamples: Array<{ field: string; before: string; after: string }> = [];

    try {
      for (;;) {
        const result = await apiNormalizeContactsAll({ offset, limit: 2000, dryRun });
        totalScanned += result.scanned;
        totalChanged += result.changed;
        offset = result.nextOffset;
        setProgress({ scanned: totalScanned, changed: totalChanged });

        for (const [field, count] of Object.entries(result.fieldTotals)) {
          totals[field] = (totals[field] || 0) + count;
        }
        setFieldTotals({ ...totals });

        for (const s of result.samples) {
          if (collectedSamples.length < 20) collectedSamples.push(s);
        }
        setSamples([...collectedSamples]);

        if (!result.hasMore) break;
      }

      setDone(true);
      setApplied(!dryRun && totalChanged > 0);

      if (dryRun) {
        if (totalChanged === 0) {
          toast(
            'Formato da base já está padronizado. Falhas de campanha podem ser número sem WhatsApp ou disparo antes da correção — use Reenviar falhas na campanha.',
            { icon: 'ℹ️', duration: 6000 }
          );
        } else {
          toast.success(
            `${totalChanged.toLocaleString('pt-BR')} contato(s) seriam corrigidos em ${totalScanned.toLocaleString('pt-BR')} analisados.`
          );
        }
      } else if (totalChanged > 0) {
        toast.success(`${totalChanged.toLocaleString('pt-BR')} contato(s) corrigidos!`);
        onApplied?.();
      } else {
        toast('Nada a corrigir — base já padronizada.', { icon: 'ℹ️' });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao corrigir contatos.');
    } finally {
      setBusy(false);
    }
  }, [onApplied]);

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleApply = () => {
    if (progress.changed === 0) {
      toast('Rode a prévia primeiro ou não há alterações pendentes.');
      return;
    }
    if (!window.confirm(`Corrigir ${progress.changed.toLocaleString('pt-BR')} contato(s) na base? Esta ação atualiza nome, telefone e endereço.`)) {
      return;
    }
    void runPaginated(false);
  };

  const fieldLines = Object.entries(fieldTotals).filter(([, n]) => n > 0);

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title="Corrigir base de contatos"
      subtitle="Une números repetidos na base (o mesmo número pode continuar em várias listas) e padroniza telefone, nome e endereço."
      icon={<Database className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
          <Button variant="ghost" type="button" disabled={busy || dedupeBusy} onClick={handleClose}>
            Fechar
          </Button>
          <Button
            variant="secondary"
            type="button"
            loading={busy && phase === 'preview'}
            disabled={busy || dedupeBusy || totalContacts === 0}
            onClick={() => void runPaginated(true)}
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
            onClick={handleApply}
          >
            Corrigir formato
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-[13px]" style={{ color: 'var(--text-1)' }}>
        {duplicateCount > 0 && (
          <div
            className="rounded-xl border p-4 space-y-2"
            style={{ borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)' }}
          >
            <div className="flex items-center gap-2 font-semibold">
              <Layers className="w-4 h-4 text-amber-500" />
              {duplicateCount.toLocaleString('pt-BR')} contato(s) com número repetido na base
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              O mesmo número pode estar em várias listas. O que não pode é haver duas linhas
              iguais na base. A união mantém o cadastro mais completo, atualiza as listas para
              esse contato e apaga só as linhas extras.
            </p>
          </div>
        )}
        <div
          className="rounded-xl border p-4 space-y-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
        >
          <p className="font-semibold">O que será ajustado:</p>
          <ul className="list-disc pl-5 space-y-1" style={{ color: 'var(--text-2)' }}>
            <li><strong>Telefone:</strong> DDI 55, remove 0 do tronco, corrige 9º dígito de celular BR</li>
            <li><strong>Nome:</strong> capitalização, espaços e caracteres estranhos</li>
            <li><strong>Endereço:</strong> UF, cidade, bairro, CEP e abreviações comuns</li>
          </ul>
          <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            Base atual: <strong>{totalContacts.toLocaleString('pt-BR')}</strong> contato(s). Recomendamos usar
            &quot;Ver o que mudaria&quot; antes de aplicar.
          </p>
        </div>

        {busy && (
          <div className="flex items-center gap-3 rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
            <span>
              {phase === 'preview' ? 'Analisando' : 'Corrigindo'}…{' '}
              {progress.scanned.toLocaleString('pt-BR')} lidos ·{' '}
              {progress.changed.toLocaleString('pt-BR')} {phase === 'preview' ? 'com alteração' : 'corrigidos'}
            </span>
          </div>
        )}

        {done && !busy && (
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
                ? `${progress.changed.toLocaleString('pt-BR')} contato(s) corrigidos`
                : progress.changed === 0
                  ? 'Nenhuma alteração de formato na base'
                  : `${progress.changed.toLocaleString('pt-BR')} contato(s) precisam de correção`}
            </div>
            {done && !applied && progress.changed === 0 && (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Os telefones já estão no padrão BR (DDI 55 e 9º dígito). Se ainda houver falhas no disparo,
                o número pode não ter WhatsApp ou a campanha foi enviada antes da correção — abra a campanha
                e use <strong>Reenviar falhas</strong> para tentar de novo com os dados atualizados.
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

            {samples.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {samples.map((s, i) => (
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
      </div>
    </Modal>
  );
};
