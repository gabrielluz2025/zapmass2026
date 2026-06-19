/**
 * AddressIntelligencePanel
 *
 * Painel de IA de endereços que aparece abaixo do mapa.
 * Oferece:
 *  - Botão "Corrigir endereços agora" — chama ViaCEP + IBGE em lote
 *  - Progresso em tempo real
 *  - Lista de diffs (antes → depois) para o usuário ver o que foi corrigido
 *  - Contador de contatos com endereço incorreto / sem coordenada
 */
import React, { useState, useCallback } from 'react';
import {
  Wand2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowRight,
  Sparkles,
  MapPin,
  Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  apiNormalizeAddressesFull,
  type AddressNormDiff,
} from '../../services/leadsGeoApi';
import { Button } from '../ui/Button';

interface Props {
  /** Contatos sem coordenada (para exibir contador de pendentes). */
  pendingGeocode: number;
  /** Total de contatos com endereço cadastrado. */
  withAddress: number;
  /** Callback para atualizar o mapa após corrigir. */
  onAddressesFixed?: () => void;
}

type RunState = 'idle' | 'running' | 'done' | 'error';

const SOURCE_LABEL: Record<string, string> = {
  cep_viacep: 'ViaCEP',
  cep_brasilapi: 'BrasilAPI',
  abbreviation: 'Abreviação',
  state_name: 'Nome do estado',
  titlecase: 'Capitalização',
};

const FIELD_LABEL: Record<string, string> = {
  city: 'Cidade',
  state: 'Estado',
  street: 'Rua',
  neighborhood: 'Bairro',
  zipCode: 'CEP',
};

export const AddressIntelligencePanel: React.FC<Props> = ({
  pendingGeocode,
  withAddress,
  onAddressesFixed,
}) => {
  const [runState, setRunState] = useState<RunState>('idle');
  const [progress, setProgress] = useState<{ scanned: number; updated: number; total: number } | null>(null);
  const [allDiffs, setAllDiffs] = useState<AddressNormDiff[]>([]);
  const [showDiffs, setShowDiffs] = useState(false);
  const [lastStats, setLastStats] = useState<{ scanned: number; updated: number } | null>(null);

  const handleFix = useCallback(async () => {
    if (runState === 'running') return;
    setRunState('running');
    setAllDiffs([]);
    setLastStats(null);
    setProgress({ scanned: 0, updated: 0, total: withAddress || 100 });

    let totalScanned = 0;
    let totalUpdated = 0;
    let offset = 0;
    const PAGE = 500;
    const collectedDiffs: AddressNormDiff[] = [];

    try {
      for (;;) {
        const result = await apiNormalizeAddressesFull({ offset, limit: PAGE });
        totalScanned += result.scanned;
        totalUpdated += result.updated;
        offset = result.nextOffset;
        setProgress({
          scanned: totalScanned,
          updated: totalUpdated,
          total: Math.max(withAddress, totalScanned + (result.hasMore ? PAGE : 0))
        });
        // Usa samples como proxy para diffs (contactsNormalizeService retorna samples)
        if (Array.isArray(result.samples)) {
          for (const s of result.samples) {
            collectedDiffs.push({
              contactId: '',
              name: '',
              field: 'endereço',
              before: s.from,
              after: s.to,
              source: 'cep_viacep',
            });
          }
        }
        if (!result.hasMore) break;
      }

      setAllDiffs(collectedDiffs);
      setLastStats({ scanned: totalScanned, updated: totalUpdated });
      setRunState('done');

      if (totalUpdated > 0) {
        toast.success(
          `${totalUpdated} endereço${totalUpdated !== 1 ? 's' : ''} corrigido${totalUpdated !== 1 ? 's' : ''}! Re-geocodificando...`
        );
        onAddressesFixed?.();
        // Mostra diffs automaticamente se houve mudanças
        setShowDiffs(true);
      } else {
        toast.success('Todos os endereços já estão corretos!');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao corrigir endereços.';
      toast.error(msg);
      setRunState('error');
    }
  }, [runState, withAddress, onAddressesFixed]);

  const progressPct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.scanned / progress.total) * 100))
    : 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
    >
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#06B6D420,#ec489920)' }}
          >
            <Sparkles className="w-4.5 h-4.5" style={{ color: '#06B6D4' }} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-[15px]" style={{ color: 'var(--text-1)' }}>
              Inteligência de Endereços
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              Corrige automaticamente erros de digitação via ViaCEP e normalização IBGE
            </p>
          </div>
        </div>
      </div>

      {/* ── Corpo ── */}
      <div className="p-5">
        {/* Explicação do que faz */}
        <div
          className="rounded-xl p-4 mb-5 flex gap-3"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#06B6D4' }} />
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
              O que esta correção faz:
            </p>
            <ul className="text-[11px] space-y-1" style={{ color: 'var(--text-2)' }}>
              <li>
                <span className="font-semibold" style={{ color: '#06B6D4' }}>CEP → endereço oficial</span>
                {' '}— busca cidade, estado, rua e bairro canônicos nos Correios (ViaCEP) para contatos com CEP
              </li>
              <li>
                <span className="font-semibold" style={{ color: '#3b82f6' }}>Sigla de estado</span>
                {' '}— converte "Santa Catarina" → "SC", "são paulo" → "SP", etc.
              </li>
              <li>
                <span className="font-semibold" style={{ color: '#10b981' }}>Abreviações</span>
                {' '}— expande "R. Eça de Queiroz" → "Rua Eça de Queirós", "Av." → "Avenida", etc.
              </li>
              <li>
                <span className="font-semibold" style={{ color: '#f59e0b' }}>Reinicia geocoding</span>
                {' '}— contatos com endereço corrigido são re-geocodificados com a localização certa
              </li>
            </ul>
          </div>
        </div>

        {/* Contadores rápidos */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div
            className="rounded-xl p-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-3.5 h-3.5" style={{ color: '#06B6D4' }} />
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                Com endereço
              </span>
            </div>
            <div className="text-[20px] font-black" style={{ color: 'var(--text-1)' }}>
              {withAddress.toLocaleString('pt-BR')}
            </div>
          </div>
          <div
            className="rounded-xl p-3"
            style={{
              background: pendingGeocode > 0 ? '#ef444410' : '#10b98110',
              border: `1px solid ${pendingGeocode > 0 ? '#ef444430' : '#10b98130'}`,
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              {pendingGeocode > 0
                ? <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              }
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                Sem coordenada
              </span>
            </div>
            <div
              className="text-[20px] font-black"
              style={{ color: pendingGeocode > 0 ? '#ef4444' : '#10b981' }}
            >
              {pendingGeocode.toLocaleString('pt-BR')}
            </div>
          </div>
        </div>

        {/* Botão de ação */}
        {runState === 'idle' || runState === 'error' ? (
          <Button
            variant="primary"
            size="md"
            onClick={handleFix}
            leftIcon={<Wand2 className="w-4 h-4" />}
            className="w-full"
          >
            Corrigir endereços automaticamente
          </Button>
        ) : runState === 'running' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#06B6D4' }} />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Corrigindo endereços…
                </span>
              </div>
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                {progress?.scanned ?? 0} / {progress?.total ?? '?'}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg,#06B6D4,#ec4899)',
                }}
              />
            </div>
            {progress && (
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                {progress.updated} contato{progress.updated !== 1 ? 's' : ''} corrigido{progress.updated !== 1 ? 's' : ''} até agora
              </p>
            )}
          </div>
        ) : runState === 'done' ? (
          <div
            className="rounded-xl p-4 flex items-start gap-3"
            style={{
              background: lastStats && lastStats.updated > 0 ? '#10b98110' : '#06B6D410',
              border: `1px solid ${lastStats && lastStats.updated > 0 ? '#10b98130' : '#06B6D430'}`,
            }}
          >
            <CheckCircle2
              className="w-5 h-5 shrink-0 mt-0.5"
              style={{ color: lastStats && lastStats.updated > 0 ? '#10b981' : '#06B6D4' }}
            />
            <div>
              <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                {lastStats && lastStats.updated > 0
                  ? `${lastStats.updated} endereço${lastStats.updated !== 1 ? 's' : ''} corrigido${lastStats.updated !== 1 ? 's' : ''}!`
                  : 'Todos os endereços já estão corretos!'}
              </p>
              {lastStats && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {lastStats.scanned} contatos verificados
                </p>
              )}
              <button
                onClick={handleFix}
                className="mt-2 text-[11px] font-semibold underline"
                style={{ color: '#06B6D4' }}
              >
                Rodar novamente
              </button>
            </div>
          </div>
        ) : null}

        {/* Diffs */}
        {allDiffs.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowDiffs((v) => !v)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-xl text-[12px] font-semibold transition-colors hover:bg-[var(--surface-1)]"
              style={{ color: 'var(--text-2)' }}
            >
              <span>
                Ver correções realizadas ({allDiffs.length})
              </span>
              {showDiffs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDiffs && (
              <div className="mt-2 space-y-1.5 max-h-[280px] overflow-y-auto rounded-xl" style={{ background: 'var(--surface-1)' }}>
                {allDiffs.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-3 py-2 text-[11px] border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="shrink-0 mt-0.5">
                      <div
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
                        style={{ background: '#06B6D420', color: '#06B6D4' }}
                      >
                        {FIELD_LABEL[d.field] || d.field}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-red-400 line-through truncate max-w-[120px]">{d.before}</span>
                        <ArrowRight className="w-3 h-3 shrink-0" style={{ color: 'var(--text-3)' }} />
                        <span className="font-semibold truncate max-w-[120px]" style={{ color: '#10b981' }}>{d.after}</span>
                      </div>
                      {d.name && (
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{d.name}</span>
                      )}
                    </div>
                    <div
                      className="shrink-0 text-[9px] font-semibold rounded-full px-1.5 py-0.5"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                    >
                      {SOURCE_LABEL[d.source] || d.source}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
