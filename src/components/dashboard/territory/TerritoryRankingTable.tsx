import React, { useEffect, useMemo, useState } from 'react';
import { Download, Rocket, Users } from 'lucide-react';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { NeighborhoodContactRow, NeighborhoodRow } from './types';

function capitalizeName(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => {
      if (word.length <= 2 && ['de', 'do', 'da', 'dos', 'das', 'e', 'em'].includes(word)) {
        return word;
      }
      if (word.includes('-')) {
        return word.split('-').map(capitalizeName).join(' - ');
      }
      if (['sc', 'sp', 'rj', 'mg', 'rs', 'pr', 'ba', 'pe', 'df', 'go', 'es', 'ce', 'pi', 'rn', 'pb', 'al', 'se', 'am', 'pa', 'ma', 'to', 'mt', 'ms', 'ro', 'ac', 'rr', 'ap'].includes(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

type Props = {
  rows: NeighborhoodRow[];
  selectedKey: string | null;
  selectedContactId: string | null;
  contacts: NeighborhoodContactRow[];
  entityLabel?: string;
  emptyLabel?: string;
  onBack?: () => void;
  backLabel?: string;
  onSelectRow: (row: NeighborhoodRow | null) => void;
  onSelectContact: (contactId: string) => void;
  onExportCsv?: () => void;
  onLaunchCampaignForNeighborhood?: (row: NeighborhoodRow) => void;
  onOpenContactsForNeighborhood?: (row: NeighborhoodRow) => void;
};

const CONTACTS_PAGE = 80;

function StackBar({ row }: { row: NeighborhoodRow }) {
  const tempSum = row.hot + row.warm + row.cold + row.new;
  const total = Math.max(1, tempSum > 0 ? tempSum : row.count);
  const segs = (['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).filter((t) => row[t] > 0);

  return (
    <div className="zm-atlas-table__stack zm-atlas-table__stack--tall" title={`${row.count.toLocaleString('pt-BR')} contatos`}>
      {segs.length === 0 ? (
        <span className="zm-atlas-table__stack-empty" />
      ) : (
        segs.map((t) => (
          <span
            key={t}
            style={{ width: `${(row[t] / total) * 100}%`, background: TEMP_COLOR[t] }}
          />
        ))
      )}
    </div>
  );
}

export const TerritoryRankingTable: React.FC<Props> = ({
  rows,
  selectedKey,
  selectedContactId,
  contacts,
  entityLabel = 'Bairro',
  emptyLabel = 'Nenhum bairro nesta região.',
  onBack,
  backLabel = 'Voltar às cidades',
  onSelectRow,
  onSelectContact,
  onExportCsv,
  onLaunchCampaignForNeighborhood,
  onOpenContactsForNeighborhood,
}) => {
  const [contactLimit, setContactLimit] = useState(CONTACTS_PAGE);

  useEffect(() => {
    setContactLimit(CONTACTS_PAGE);
  }, [selectedKey]);

  const selectedRow = useMemo(() => rows.find((r) => r.key === selectedKey), [rows, selectedKey]);
  const visibleContacts = useMemo(
    () => contacts.slice(0, contactLimit),
    [contacts, contactLimit]
  );

  if (rows.length === 0) {
    return (
      <div className="zm-atlas-table zm-atlas-table--empty">
        <p>{emptyLabel}</p>
        {onBack && (
          <button type="button" className="zm-atlas-table__back" onClick={onBack}>
            {backLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="zm-atlas-table zm-atlas-table--split">
      {onBack && (
        <button type="button" className="zm-atlas-table__back zm-atlas-table__back--head" onClick={onBack}>
          ← {backLabel}
        </button>
      )}
      <div className="zm-atlas-table__head">
        <span>#</span>
        <span>{entityLabel}</span>
        <span>Contatos</span>
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
              <span className="zm-atlas-table__name">{capitalizeName(row.label)}</span>
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
            <div className="min-w-0">
              <span className="zm-atlas-table__contacts-title">{capitalizeName(selectedRow.label)}</span>
              <span className="zm-atlas-table__contacts-sub">
                {contacts.length.toLocaleString('pt-BR')} carregados
                {selectedRow.count > contacts.length
                  ? ` · ${selectedRow.count.toLocaleString('pt-BR')} no total`
                  : ''}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onLaunchCampaignForNeighborhood && (
                <button
                  type="button"
                  className="zm-atlas-table__action"
                  title="Campanha para este bairro"
                  onClick={() => onLaunchCampaignForNeighborhood(selectedRow)}
                >
                  <Rocket className="w-3.5 h-3.5" />
                </button>
              )}
              {onOpenContactsForNeighborhood && (
                <button
                  type="button"
                  className="zm-atlas-table__action"
                  title="Ver na Central"
                  onClick={() => onOpenContactsForNeighborhood(selectedRow)}
                >
                  <Users className="w-3.5 h-3.5" />
                </button>
              )}
              {onExportCsv && contacts.length > 0 && (
                <button type="button" className="zm-atlas-table__export" onClick={onExportCsv}>
                  <Download className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <ul className="zm-atlas-table__contacts zm-atlas-table__contacts--scroll">
            {contacts.length === 0 ? (
              <li className="zm-atlas-table__detail-empty">Sem contatos carregados neste bairro.</li>
            ) : (
              visibleContacts.map((c) => (
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
          {contacts.length > contactLimit && (
            <button
              type="button"
              className="zm-atlas-table__more"
              onClick={() => setContactLimit((n) => n + CONTACTS_PAGE)}
            >
              Ver mais ({Math.min(contactLimit + CONTACTS_PAGE, contacts.length)} de {contacts.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
};
