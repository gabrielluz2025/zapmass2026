import React from 'react';
import { ChevronLeft, Download, Loader2 } from 'lucide-react';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import { formatSharePct, rankBarVisualPct } from './territoryMapUtils';
import { normBlumenauNbKey } from '../../../../shared/blumenauNeighborhoods';

export type NeighborhoodContactRow = {
  id: string;
  name: string;
  phone: string;
  neighborhood: string;
  zipCode: string;
  street: string;
  number: string;
  temp: ContactTemperature;
};

type RankItem = { label: string; count: number };

type Props = {
  city: string;
  blumenauFocus: boolean;
  regionLeadCount: number;
  topNeighborhoods: RankItem[];
  rankMaxCount: number;
  selectedNb: string | null;
  neighborhoodContacts: NeighborhoodContactRow[];
  nbTempBreakdown: Record<ContactTemperature, number>;
  loading?: boolean;
  onSelectNeighborhood: (label: string) => void;
  onClearSelection: () => void;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  canExportXlsx: boolean;
  layout?: 'sidebar' | 'mobile';
};

export const TerritoryRankingPanel: React.FC<Props> = ({
  city,
  blumenauFocus,
  regionLeadCount,
  topNeighborhoods,
  rankMaxCount,
  selectedNb,
  neighborhoodContacts,
  nbTempBreakdown,
  loading = false,
  onSelectNeighborhood,
  onClearSelection,
  onExportCsv,
  onExportXlsx,
  canExportXlsx,
  layout = 'sidebar',
}) => {
  const listPreview = neighborhoodContacts.slice(0, layout === 'mobile' ? 20 : 80);
  const isMobile = layout === 'mobile';

  const shellClass = isMobile ? 'zm-ta-rank zm-ta-rank--mobile' : 'zm-ta-rank zm-ta-rank--sidebar';

  return (
    <div className={shellClass}>
      {loading && (
        <div className="zm-ta-rank__loading" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}

      {selectedNb ? (
        <>
          <div className="zm-ta-rank__head">
            <button type="button" onClick={onClearSelection} className="zm-ta-rank__back">
              <ChevronLeft className="w-3.5 h-3.5" />
              Ranking
            </button>
            <p className="zm-ta-rank__title">{selectedNb}</p>
            <p className="zm-ta-rank__metric">{neighborhoodContacts.length.toLocaleString('pt-BR')} contatos</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {(['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).map((t) =>
                nbTempBreakdown[t] > 0 ? (
                  <span key={t} className="zm-ta-rank__temp-tag">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: TEMP_COLOR[t] }} />
                    {nbTempBreakdown[t]}
                  </span>
                ) : null
              )}
            </div>
            <div className="flex gap-1.5 mt-3">
              <button type="button" onClick={onExportCsv} className="zm-ta-rank__export">
                <Download className="w-3 h-3" />
                CSV
              </button>
              <button
                type="button"
                onClick={onExportXlsx}
                disabled={!canExportXlsx}
                className="zm-ta-rank__export zm-ta-rank__export--primary"
              >
                <Download className="w-3 h-3" />
                Excel
              </button>
            </div>
          </div>
          <div className="zm-ta-rank__list zm-ta-rank__list--contacts">
            {neighborhoodContacts.length === 0 ? (
              <p className="zm-ta-rank__empty">Nenhum contato com bairro &quot;{selectedNb}&quot; nesta cidade.</p>
            ) : (
              listPreview.map((row) => (
                <div key={row.id} className="zm-ta-rank__contact">
                  <div className="flex items-start justify-between gap-1">
                    <p className="zm-ta-rank__contact-name">{row.name}</p>
                    <span
                      className="w-2 h-2 rounded-full mt-1 shrink-0"
                      style={{ background: TEMP_COLOR[row.temp] }}
                      title={CONTACT_TEMP_LABEL[row.temp]}
                    />
                  </div>
                  <p className="zm-ta-rank__contact-phone">{row.phone}</p>
                </div>
              ))
            )}
          </div>
        </>
      ) : isMobile ? (
        <div className="zm-ta-rank__carousel">
          <p className="zm-ta-rank__carousel-label">
            Top bairros · {regionLeadCount.toLocaleString('pt-BR')} leads
          </p>
          <div className="zm-ta-rank__carousel-track">
            {topNeighborhoods.slice(0, 10).map(({ label, count }, i) => {
              const nbName = label.split('·')[0]?.trim() || label;
              return (
                <button
                  key={label}
                  type="button"
                  className="zm-ta-rank__card"
                  onClick={() => onSelectNeighborhood(label)}
                >
                  <span className="zm-ta-rank__card-rank">#{i + 1}</span>
                  <span className="zm-ta-rank__card-name">{nbName}</span>
                  <span className="zm-ta-rank__card-count">{count.toLocaleString('pt-BR')}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="zm-ta-rank__head">
            <p className="zm-ta-rank__eyebrow">{blumenauFocus ? '35 bairros oficiais' : 'Ranking territorial'}</p>
            <p className="zm-ta-rank__metric">{regionLeadCount.toLocaleString('pt-BR')}</p>
            <p className="zm-ta-rank__sub">leads na região</p>
            <p className="zm-ta-rank__city">{city}</p>
          </div>
          <div className="zm-ta-rank__list">
            {topNeighborhoods.length === 0 ? (
              <p className="zm-ta-rank__empty">Cadastre CEP e bairro ou use &quot;Mapear CEP&quot;.</p>
            ) : (
              <ol className="zm-ta-rank__ol">
                {topNeighborhoods.slice(0, 14).map(({ label, count }, i) => {
                  const nbName = label.split('·')[0]?.trim() || label;
                  const active = selectedNb && normBlumenauNbKey(selectedNb) === normBlumenauNbKey(nbName);
                  const barPct = rankBarVisualPct(count, rankMaxCount);
                  return (
                    <li key={label}>
                      <button
                        type="button"
                        onClick={() => onSelectNeighborhood(label)}
                        className={`zm-ta-rank__item${active ? ' zm-ta-rank__item--active' : ''}`}
                      >
                        <div className="zm-ta-rank__item-row">
                          <span className="zm-ta-rank__item-name">
                            <span className="zm-ta-rank__item-index">{i + 1}</span>
                            {nbName}
                          </span>
                          <span className="zm-ta-rank__item-meta">
                            <span>{count.toLocaleString('pt-BR')}</span>
                            <span className="zm-ta-rank__item-pct">{formatSharePct(count, regionLeadCount)}</span>
                          </span>
                        </div>
                        <div className="zm-ta-rank__bar">
                          <div className="zm-ta-rank__bar-fill" style={{ width: `${barPct}%` }} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
};
