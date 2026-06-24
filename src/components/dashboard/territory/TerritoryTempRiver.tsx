import React from 'react';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { TempFilter } from './types';
import type { StateMunicipalityCoverage } from './stateMunicipalityCoverage';
import { formatMunicipalityCoverageLine } from './stateMunicipalityCoverage';

type Props = {
  totals: Record<ContactTemperature, number>;
  activeFilter: TempFilter;
  onFilterChange: (f: TempFilter) => void;
  /** Total autoritativo da região (servidor), quando diferente da soma de temperaturas. */
  regionTotalLabel?: number | null;
  contactsHydrating?: boolean;
  municipalityCoverage?: StateMunicipalityCoverage | null;
};

const SEGMENTS: ContactTemperature[] = ['hot', 'warm', 'cold', 'new'];

export const TerritoryTempRiver: React.FC<Props> = ({
  totals,
  activeFilter,
  onFilterChange,
  regionTotalLabel,
  contactsHydrating,
  municipalityCoverage,
}) => {
  const tempSum = totals.hot + totals.warm + totals.cold + totals.new;
  const displayTotal = regionTotalLabel ?? tempSum;
  const newDominant = tempSum > 0 && totals.new / tempSum > 0.85;

  return (
    <div className="zm-atlas-river">
      <div className="zm-atlas-river__head">
        <span className="zm-atlas-river__title">Composição da região</span>
        <button
          type="button"
          className={`zm-atlas-river__all${activeFilter === 'all' ? ' zm-atlas-river__all--on' : ''}`}
          onClick={() => onFilterChange('all')}
        >
          {displayTotal.toLocaleString('pt-BR')} contatos
        </button>
      </div>

      {contactsHydrating && (
        <p className="zm-atlas-river__hint">Atualizando temperaturas conforme a base carrega…</p>
      )}

      {municipalityCoverage && (
        <p className="zm-atlas-river__hint zm-atlas-river__hint--muni">
          <strong>Municípios ({municipalityCoverage.total} no estado):</strong>{' '}
          {formatMunicipalityCoverageLine(municipalityCoverage)}
          {municipalityCoverage.unmappedContactCities > 0 && (
            <>
              {' '}
              · {municipalityCoverage.unmappedContactCities.toLocaleString('pt-BR')} cidade(s) cadastrada(s)
              fora do catálogo IBGE
            </>
          )}
        </p>
      )}

      {newDominant && !contactsHydrating && (
        <p className="zm-atlas-river__hint zm-atlas-river__hint--info">
          A maioria está sem histórico de conversa — dispare campanhas ou aguarde respostas para classificar
          quente/morno/frio.
        </p>
      )}

      <div className="zm-atlas-river__bar" role="group" aria-label="Filtrar por temperatura">
        {tempSum === 0 ? (
          <div className="zm-atlas-river__empty" />
        ) : (
          SEGMENTS.map((temp) => {
            const pct = Math.max((totals[temp] / tempSum) * 100, totals[temp] > 0 ? 2 : 0);
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
