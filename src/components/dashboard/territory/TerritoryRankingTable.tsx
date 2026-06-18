import React from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { NeighborhoodContactRow, NeighborhoodRow } from './types';

type Props = {
  rows: NeighborhoodRow[];
  selectedKey: string | null;
  detailContacts: NeighborhoodContactRow[];
  onSelect: (row: NeighborhoodRow | null) => void;
  onExportCsv?: () => void;
};

function StackBar({ row }: { row: NeighborhoodRow }) {
  const total = Math.max(1, row.count);
  const segs = (['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).filter((t) => row[t] > 0);

  return (
    <div className="zm-atlas-table__stack" aria-hidden>
      {segs.map((t) => (
        <span
          key={t}
          style={{ width: `${(row[t] / total) * 100}%`, background: TEMP_COLOR[t] }}
          title={`${CONTACT_TEMP_LABEL[t]}: ${row[t]}`}
        />
      ))}
    </div>
  );
}

export const TerritoryRankingTable: React.FC<Props> = ({
  rows,
  selectedKey,
  detailContacts,
  onSelect,
  onExportCsv,
}) => {
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  if (rows.length === 0) {
    return (
      <div className="zm-atlas-table zm-atlas-table--empty">
        <p>Nenhum bairro com contatos nesta região.</p>
        <p className="zm-atlas-table__hint">Cadastre endereços nos contatos ou use &quot;Atualizar CEP&quot;.</p>
      </div>
    );
  }

  return (
    <div className="zm-atlas-table">
      <div className="zm-atlas-table__head">
        <span>#</span>
        <span>Bairro</span>
        <span>Contatos</span>
        <span>Temperatura</span>
        <span aria-hidden />
      </div>

      <div className="zm-atlas-table__body">
        {rows.map((row, idx) => {
          const open = selectedKey === row.key;
          const share = Math.round((row.count / maxCount) * 100);

          return (
            <div key={row.key} className={`zm-atlas-table__block${open ? ' zm-atlas-table__block--open' : ''}`}>
              <button
                type="button"
                className="zm-atlas-table__row"
                onClick={() => onSelect(open ? null : row)}
              >
                <span className="zm-atlas-table__rank">{idx + 1}</span>
                <span className="zm-atlas-table__name">{row.label}</span>
                <span className="zm-atlas-table__count">{row.count.toLocaleString('pt-BR')}</span>
                <span className="zm-atlas-table__stack-wrap">
                  <StackBar row={row} />
                  <span className="zm-atlas-table__share">{share}% do topo</span>
                </span>
                <ChevronDown className={`zm-atlas-table__chev${open ? ' zm-atlas-table__chev--open' : ''}`} />
              </button>

              {open && (
                <div className="zm-atlas-table__detail">
                  <div className="zm-atlas-table__detail-meta">
                    <span>
                      {row.hot} quente · {row.warm} morno · {row.cold} frio
                      {row.new > 0 ? ` · ${row.new} sem hist.` : ''}
                    </span>
                    {onExportCsv && detailContacts.length > 0 && (
                      <button type="button" className="zm-atlas-table__export" onClick={onExportCsv}>
                        <Download className="w-3.5 h-3.5" />
                        Exportar
                      </button>
                    )}
                  </div>
                  {detailContacts.length === 0 ? (
                    <p className="zm-atlas-table__detail-empty">Sem contatos listados.</p>
                  ) : (
                    <ul className="zm-atlas-table__contacts">
                      {detailContacts.slice(0, 40).map((c) => (
                        <li key={c.id}>
                          <span className="zm-atlas-table__dot" style={{ background: TEMP_COLOR[c.temp] }} />
                          <span className="zm-atlas-table__contact-name">{c.name}</span>
                          <span className="zm-atlas-table__contact-phone">{c.phone}</span>
                          <span className="zm-atlas-table__contact-temp">{CONTACT_TEMP_LABEL[c.temp]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
