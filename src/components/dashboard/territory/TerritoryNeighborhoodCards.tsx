import React from 'react';
import { ChevronLeft, Download } from 'lucide-react';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { NeighborhoodRow } from './types';
import type { NeighborhoodContactRow } from './TerritoryRankingPanel';

type Props = {
  rows: NeighborhoodRow[];
  selectedKey: string | null;
  selectedLabel: string | null;
  onSelect: (row: NeighborhoodRow) => void;
  onClear: () => void;
  detailContacts?: NeighborhoodContactRow[];
  onExportCsv?: () => void;
};

function TempStackBar({ row }: { row: NeighborhoodRow }) {
  const total = Math.max(1, row.count);
  const segments: { temp: ContactTemperature; pct: number }[] = (
    ['hot', 'warm', 'cold', 'new'] as ContactTemperature[]
  )
    .filter((t) => row[t] > 0)
    .map((t) => ({ temp: t, pct: (row[t] / total) * 100 }));

  if (segments.length === 0) {
    return <div className="zm-geo-stack zm-geo-stack--empty" />;
  }

  return (
    <div className="zm-geo-stack" aria-hidden>
      {segments.map((s) => (
        <span
          key={s.temp}
          className="zm-geo-stack__seg"
          style={{ width: `${s.pct}%`, background: TEMP_COLOR[s.temp] }}
          title={`${CONTACT_TEMP_LABEL[s.temp]}: ${row[s.temp]}`}
        />
      ))}
    </div>
  );
}

export const TerritoryNeighborhoodCards: React.FC<Props> = ({
  rows,
  selectedKey,
  selectedLabel,
  onSelect,
  onClear,
  detailContacts = [],
  onExportCsv,
}) => {
  if (selectedKey && selectedLabel) {
    return (
      <div className="zm-geo-cards zm-geo-cards--detail">
        <div className="zm-geo-cards__detail-head">
          <button type="button" className="zm-geo-cards__back" onClick={onClear}>
            <ChevronLeft className="w-4 h-4" />
            Bairros
          </button>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="zm-geo-cards__detail-title">{selectedLabel}</h3>
              <p className="zm-geo-cards__detail-sub">{detailContacts.length} contatos</p>
            </div>
            {onExportCsv && detailContacts.length > 0 && (
              <button type="button" className="zm-geo-cards__export" onClick={onExportCsv}>
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            )}
          </div>
        </div>
        <div className="zm-geo-cards__detail-list">
          {detailContacts.length === 0 ? (
            <p className="zm-geo-cards__empty">Nenhum contato neste bairro.</p>
          ) : (
            detailContacts.slice(0, 60).map((c) => (
              <div key={c.id} className="zm-geo-cards__contact">
                <span className="zm-geo-cards__contact-dot" style={{ background: TEMP_COLOR[c.temp] }} />
                <div className="min-w-0 flex-1">
                  <p className="zm-geo-cards__contact-name">{c.name}</p>
                  <p className="zm-geo-cards__contact-phone">{c.phone}</p>
                </div>
                <span className="zm-geo-cards__contact-temp">{CONTACT_TEMP_LABEL[c.temp]}</span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="zm-geo-cards zm-geo-cards--empty">
        <p className="zm-geo-cards__empty">
          Nenhum contato com bairro nesta região. Cadastre endereços ou use &quot;Mapear CEP&quot;.
        </p>
      </div>
    );
  }

  return (
    <div className="zm-geo-cards">
      <p className="zm-geo-cards__heading">Por bairro</p>
      <div className="zm-geo-cards__grid">
        {rows.map((row) => {
          const active = selectedKey === row.key;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onSelect(row)}
              className={`zm-geo-card${active ? ' zm-geo-card--active' : ''}`}
            >
              <div className="zm-geo-card__top">
                <span
                  className="zm-geo-card__pulse"
                  style={{ background: TEMP_COLOR[row.dominant] }}
                  aria-hidden
                />
                <span className="zm-geo-card__name">{row.label}</span>
                <span className="zm-geo-card__count">{row.count.toLocaleString('pt-BR')}</span>
              </div>
              <TempStackBar row={row} />
              <div className="zm-geo-card__legend">
                {row.hot > 0 && <span>{row.hot} quente{row.hot !== 1 ? 's' : ''}</span>}
                {row.warm > 0 && <span>{row.warm} morno{row.warm !== 1 ? 's' : ''}</span>}
                {row.cold > 0 && <span>{row.cold} frio{row.cold !== 1 ? 's' : ''}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
