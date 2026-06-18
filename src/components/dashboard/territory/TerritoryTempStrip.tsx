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

const FILTERS: { id: TempFilter; temp?: ContactTemperature; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'hot', temp: 'hot', label: CONTACT_TEMP_LABEL.hot },
  { id: 'warm', temp: 'warm', label: CONTACT_TEMP_LABEL.warm },
  { id: 'cold', temp: 'cold', label: CONTACT_TEMP_LABEL.cold },
];

export const TerritoryTempStrip: React.FC<Props> = ({ totals, activeFilter, onFilterChange }) => {
  return (
    <div className="zm-geo-temps" role="group" aria-label="Filtrar por temperatura">
      {FILTERS.map((f) => {
        const count = f.id === 'all' ? totals.hot + totals.warm + totals.cold + totals.new : totals[f.temp!];
        const active = activeFilter === f.id;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={active}
            onClick={() => onFilterChange(f.id)}
            className={`zm-geo-temps__chip${active ? ' zm-geo-temps__chip--active' : ''}`}
          >
            {f.temp && (
              <span className="zm-geo-temps__dot" style={{ background: TEMP_COLOR[f.temp] }} aria-hidden />
            )}
            <span className="zm-geo-temps__label">{f.label}</span>
            <span className="zm-geo-temps__count">{count.toLocaleString('pt-BR')}</span>
          </button>
        );
      })}
    </div>
  );
};
