import React, { useMemo, useState } from 'react';
import type { CampaignGeoUfStats } from '../../types';
import { GEO_UNKNOWN_UF } from '../../utils/brazilPhoneGeo';
import { BarChart3, ChevronDown, MapPin } from 'lucide-react';
import { Button } from '../ui';

/** Todas as UFs + bucket sintético (fora do BR / sem DDD). */
const ALL_UF: string[] = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
  GEO_UNKNOWN_UF
];

const UF_NAME: Record<string, string> = {
  [GEO_UNKNOWN_UF]: 'Sem UF BR / internacional',
  AC: 'Acre',
  AL: 'Alagoas',
  AM: 'Amazonas',
  AP: 'Amapá',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MG: 'Minas Gerais',
  MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso',
  PA: 'Pará',
  PB: 'Paraíba',
  PE: 'Pernambuco',
  PI: 'Piauí',
  PR: 'Paraná',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RO: 'Rondônia',
  RR: 'Roraima',
  RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina',
  SE: 'Sergipe',
  SP: 'São Paulo',
  TO: 'Tocantins'
};

export type GeoLayer = 'delivered' | 'read' | 'replied';

interface BrazilCampaignMapProps {
  byUf: Record<string, CampaignGeoUfStats>;
  layer: GeoLayer;
  onLayerChange: (l: GeoLayer) => void;
  isLive: boolean;
  campaignLabel?: string;
  /** ms desde epoch — último pacote do servidor */
  updatedAt?: number;
}

const layerLabel: Record<GeoLayer, string> = {
  delivered: 'Entregues',
  read: 'Lidos',
  replied: 'Respostas'
};

function pickValue(stats: CampaignGeoUfStats | undefined, layer: GeoLayer): number {
  if (!stats) return 0;
  return Math.max(0, Number(stats[layer]) || 0);
}

const layerBarClass: Record<GeoLayer, string> = {
  delivered: 'brazil-geo-bar--delivered',
  read: 'brazil-geo-bar--read',
  replied: 'brazil-geo-bar--replied'
};

export const BrazilCampaignMap: React.FC<BrazilCampaignMapProps> = ({
  byUf,
  layer,
  onLayerChange,
  isLive,
  campaignLabel,
  updatedAt
}) => {
  const [showZeros, setShowZeros] = useState(false);

  const maxVal = useMemo(() => {
    let m = 0;
    for (const uf of ALL_UF) {
      m = Math.max(m, pickValue(byUf[uf], layer));
    }
    return Math.max(1, m);
  }, [byUf, layer]);

  const totalLayer = useMemo(() => {
    let t = 0;
    for (const uf of ALL_UF) {
      t += pickValue(byUf[uf], layer);
    }
    return t;
  }, [byUf, layer]);

  const { activeRows, zeroUfs } = useMemo(() => {
    const rows = ALL_UF.map((uf) => ({
      uf,
      v: pickValue(byUf[uf], layer),
      name: UF_NAME[uf] || uf
    }));
    const active = rows.filter((r) => r.v > 0).sort((a, b) => b.v - a.v || a.uf.localeCompare(b.uf));
    const zeros = rows.filter((r) => r.v === 0).map((r) => r.uf);
    return { activeRows: active, zeroUfs: zeros };
  }, [byUf, layer]);

  const formatUf = (uf: string) => (uf === GEO_UNKNOWN_UF ? 'Out' : uf);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <MapPin className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="min-w-0">
            {campaignLabel ? (
              <span className="font-medium text-slate-800 dark:text-slate-100">{campaignLabel}</span>
            ) : (
              <span className="font-medium text-slate-800 dark:text-slate-100">Campanha</span>
            )}{' '}
            <span className="text-slate-500 dark:text-slate-500">· inferência por DDD (não é GPS)</span>
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Ao vivo
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {(['delivered', 'read', 'replied'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              variant={layer === k ? 'primary' : 'secondary'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => onLayerChange(k)}
            >
              {layerLabel[k]}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/80 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/60">
        <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total · {layerLabel[layer].toLowerCase()}
            </p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
              {totalLayer.toLocaleString('pt-BR')}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <BarChart3 className="h-3.5 w-3.5 opacity-70" />
            <span>Ranking por UF nesta métrica</span>
          </div>
        </div>

        <div className="px-4 py-3 sm:px-5">
          {activeRows.length === 0 ? (
            <p className="py-6 text-center text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              Nenhum evento nesta métrica ainda. Quando houver retornos, as UFs aparecem aqui ordenadas por volume.
            </p>
          ) : (
            <ul className="max-h-[min(42vh,380px)] space-y-2.5 overflow-y-auto pr-1">
              {activeRows.map(({ uf, v, name }) => {
                const pct = Math.round((v / maxVal) * 100);
                const share = totalLayer > 0 ? Math.round((v / totalLayer) * 1000) / 10 : 0;
                const widthPct = v <= 0 ? 0 : Math.min(100, Math.max(pct, v > 0 && pct < 4 ? 4 : pct));
                return (
                  <li key={uf}>
                    <div className="flex items-center gap-3">
                      <span
                        className="w-9 shrink-0 text-center text-[11px] font-bold tabular-nums text-slate-600 dark:text-slate-300"
                        title={name}
                      >
                        {formatUf(uf)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="relative h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800/90"
                          title={`${name}: ${v.toLocaleString('pt-BR')} (${share}% do total nesta métrica)`}
                        >
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ease-out ${layerBarClass[layer]}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {v.toLocaleString('pt-BR')}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {zeroUfs.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowZeros((z) => !z)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-slate-500 transition-colors hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50"
              >
                <span>
                  UFs sem evento nesta métrica{' '}
                  <span className="font-medium text-slate-600 dark:text-slate-300">({zeroUfs.length})</span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform ${showZeros ? 'rotate-180' : ''}`}
                />
              </button>
              {showZeros && (
                <div className="flex flex-wrap gap-1.5 px-1 pb-1 pt-1">
                  {zeroUfs.map((uf) => (
                    <span
                      key={uf}
                      title={UF_NAME[uf] || uf}
                      className="inline-flex min-w-[2.25rem] items-center justify-center rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-1 text-[10px] font-semibold text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500"
                    >
                      {formatUf(uf)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>
          Soma das UFs = <strong className="text-slate-700 dark:text-slate-200">{totalLayer.toLocaleString('pt-BR')}</strong>
          {updatedAt ? (
            <span className="ml-2 text-slate-400 dark:text-slate-500">
              · atualizado{' '}
              {new Date(updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          ) : null}
        </span>
        <span className="text-slate-400 dark:text-slate-500">Cor da barra segue a métrica (entregue / lido / resposta)</span>
      </div>
    </div>
  );
};
