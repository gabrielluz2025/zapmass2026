import React from 'react';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { TempFilter } from './types';

type Props = {
  totals: Record<ContactTemperature, number>;
  activeFilter: TempFilter;
  onFilterChange: (f: TempFilter) => void;
};

const SEGMENTS: ContactTemperature[] = ['hot', 'warm', 'cold', 'new'];

export const TerritoryTempRiver: React.FC<Props> = ({ totals, activeFilter, onFilterChange }) => {
  const total = totals.hot + totals.warm + totals.cold + totals.new;

  return (
    <div className="zm-atlas-river">
      <div className="zm-atlas-river__head">
        <span className="zm-atlas-river__title">Composição da região</span>
        <button
          type="button"
          className={`zm-atlas-river__all${activeFilter === 'all' ? ' zm-atlas-river__all--on' : ''}`}
          onClick={() => onFilterChange('all')}
        >
          {total.toLocaleString('pt-BR')} contatos
        </button>
      </div>

      <div
        className="zm-atlas-river__bar"
        role="group"
        aria-label="Filtrar por temperatura"
      >
        {total === 0 ? (
          <div className="zm-atlas-river__empty" />
        ) : (
          SEGMENTS.filter((t) => totals[t] > 0).map((temp) => {
            const pct = (totals[temp] / total) * 100;
            const active = activeFilter === temp;
            return (
              <button
                key={temp}
                type="button"
                aria-pressed={active}
                title={`${CONTACT_TEMP_LABEL[temp]}: ${totals[temp]}`}
                className={`zm-atlas-river__seg${active ? ' zm-atlas-river__seg--on' : ''}`}
                style={{ width: `${pct}%`, background: TEMP_COLOR[temp] }}
                onClick={() => onFilterChange(active ? 'all' : temp)}
              />
            );
          })
        )}
      </div>

      <div className="zm-atlas-river__legend">
        {SEGMENTS.map((temp) => (
          <button
            key={temp}
            type="button"
            className={`zm-atlas-river__key${activeFilter === temp ? ' zm-atlas-river__key--on' : ''}`}
            onClick={() => onFilterChange(activeFilter === temp ? 'all' : temp)}
          >
            <span className="zm-atlas-river__dot" style={{ background: TEMP_COLOR[temp] }} />
            <span>{CONTACT_TEMP_LABEL[temp]}</span>
            <strong>{totals[temp].toLocaleString('pt-BR')}</strong>
          </button>
        ))}
      </div>
    </div>
  );
};
