import React from 'react';
import { Download } from 'lucide-react';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { NeighborhoodContactRow, NeighborhoodRow } from './types';

type Props = {
  rows: NeighborhoodRow[];
  selectedKey: string | null;
  selectedContactId: string | null;
  contacts: NeighborhoodContactRow[];
  onSelectRow: (row: NeighborhoodRow | null) => void;
  onSelectContact: (contactId: string) => void;
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
        />
      ))}
    </div>
  );
}

export const TerritoryRankingTable: React.FC<Props> = ({
  rows,
  selectedKey,
  selectedContactId,
  contacts,
  onSelectRow,
  onSelectContact,
  onExportCsv,
}) => {
  if (rows.length === 0) {
    return (
      <div className="zm-atlas-table zm-atlas-table--empty">
        <p>Nenhum bairro nesta região.</p>
      </div>
    );
  }

  const selectedRow = rows.find((r) => r.key === selectedKey);

  return (
    <div className="zm-atlas-table zm-atlas-table--split">
      <div className="zm-atlas-table__head">
        <span>#</span>
        <span>Bairro</span>
        <span>Leads</span>
        <span>Mix</span>
      </div>

      <div className="zm-atlas-table__body zm-atlas-table__body--scroll">
        {rows.map((row) => {
          const active = selectedKey === row.key;
          return (
            <button
              key={row.key}
              type="button"
              className={`zm-atlas-table__row zm-atlas-table__row--compact${active ? ' zm-atlas-table__row--active' : ''}`}
              onClick={() => onSelectRow(active ? null : row)}
            >
              <span className="zm-atlas-table__num">{row.index ?? '—'}</span>
              <span className="zm-atlas-table__name">{row.label}</span>
              <span className={`zm-atlas-table__count${row.count === 0 ? ' zm-atlas-table__count--zero' : ''}`}>
                {row.count.toLocaleString('pt-BR')}
              </span>
              <StackBar row={row} />
            </button>
          );
        })}
      </div>

      {selectedRow && (
        <div className="zm-atlas-table__contacts-panel">
          <div className="zm-atlas-table__contacts-head">
            <span>{selectedRow.label}</span>
            {onExportCsv && contacts.length > 0 && (
              <button type="button" className="zm-atlas-table__export" onClick={onExportCsv}>
                <Download className="w-3 h-3" />
              </button>
            )}
          </div>
          <ul className="zm-atlas-table__contacts zm-atlas-table__contacts--scroll">
            {contacts.length === 0 ? (
              <li className="zm-atlas-table__detail-empty">Sem contatos.</li>
            ) : (
              contacts.slice(0, 80).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`zm-atlas-table__contact-btn${selectedContactId === c.id ? ' zm-atlas-table__contact-btn--on' : ''}`}
                    onClick={() => onSelectContact(c.id)}
                  >
                    <span className="zm-atlas-table__dot" style={{ background: TEMP_COLOR[c.temp] }} />
                    <span className="zm-atlas-table__contact-name">{c.name}</span>
                    <span className="zm-atlas-table__contact-temp">{CONTACT_TEMP_LABEL[c.temp]}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
