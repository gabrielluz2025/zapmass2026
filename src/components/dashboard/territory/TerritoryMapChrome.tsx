import React from 'react';
import {
  Crosshair,
  Flame,
  Layers,
  MapPin,
  Maximize2,
  Thermometer,
  Users,
} from 'lucide-react';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { ContactViz, MapTileId, NeighborhoodViz } from './territoryMapPro';
import type { TerritoryViewMode } from './territoryConstants';

type MapViewMode = 'neighborhoods' | 'contacts';

type Props = {
  mapViewMode: MapViewMode;
  onMapViewModeChange: (mode: MapViewMode) => void;
  neighborhoodViz: NeighborhoodViz;
  onNeighborhoodVizChange: (viz: NeighborhoodViz) => void;
  contactViz: ContactViz;
  onContactVizChange: (viz: ContactViz) => void;
  territoryViewMode: TerritoryViewMode;
  onTerritoryViewModeChange: (mode: TerritoryViewMode) => void;
  mapTile: MapTileId;
  onMapTileChange: (tile: MapTileId) => void;
  onFitBounds: () => void;
  onRecenter: () => void;
  focusMode: boolean;
  neighborhoodsModeLabel?: string;
  showMunicipioBorders?: boolean;
  statsLine: string;
};

const TILE_LABELS: Record<MapTileId, string> = {
  voyager: 'Voyager',
  light: 'Claro',
  dark: 'Escuro',
};

export const TerritoryMapChrome: React.FC<Props> = ({
  mapViewMode,
  onMapViewModeChange,
  neighborhoodViz,
  onNeighborhoodVizChange,
  contactViz,
  onContactVizChange,
  territoryViewMode,
  onTerritoryViewModeChange,
  mapTile,
  onMapTileChange,
  onFitBounds,
  onRecenter,
  focusMode,
  neighborhoodsModeLabel = 'Bairros',
  showMunicipioBorders = false,
  statsLine,
}) => {
  const vizModes: Array<[NeighborhoodViz, string]> = showMunicipioBorders
    ? [
        ['borders', 'Contornos'],
        ['heat', 'Calor'],
        ['bubbles', 'Bolhas'],
        ['labels', 'Rótulos'],
      ]
    : [
        ['heat', 'Calor'],
        ['bubbles', 'Bolhas'],
        ['labels', 'Rótulos'],
      ];

  return (
    <div className="zm-atlas-map-chrome">
      <div className="zm-atlas-map-chrome__row zm-atlas-map-chrome__row--primary">
        <div className="zm-atlas-map-chrome__modes" role="tablist" aria-label="Camada do mapa">
          <button
            type="button"
            role="tab"
            aria-selected={mapViewMode === 'neighborhoods'}
            className={`zm-atlas-map-chrome__mode${mapViewMode === 'neighborhoods' ? ' zm-atlas-map-chrome__mode--on' : ''}`}
            onClick={() => onMapViewModeChange('neighborhoods')}
          >
            <Layers className="w-3.5 h-3.5" />
            {neighborhoodsModeLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mapViewMode === 'contacts'}
            className={`zm-atlas-map-chrome__mode${mapViewMode === 'contacts' ? ' zm-atlas-map-chrome__mode--on' : ''}`}
            onClick={() => onMapViewModeChange('contacts')}
          >
            <Users className="w-3.5 h-3.5" />
            Contatos
          </button>
        </div>

        {!focusMode && mapViewMode === 'neighborhoods' && (
          <div className="zm-atlas-map-chrome__sub" role="group" aria-label="Visualização de bairros">
            {vizModes.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`zm-atlas-map-chrome__chip${neighborhoodViz === id ? ' zm-atlas-map-chrome__chip--on' : ''}`}
                onClick={() => onNeighborhoodVizChange(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!focusMode && mapViewMode === 'contacts' && (
          <div className="zm-atlas-map-chrome__sub" role="group" aria-label="Visualização de contatos">
            {(
              [
                ['heat', 'Densidade'],
                ['pins', 'Pins'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`zm-atlas-map-chrome__chip${contactViz === id ? ' zm-atlas-map-chrome__chip--on' : ''}`}
                onClick={() => onContactVizChange(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!focusMode && (
          <div className="zm-atlas-map-chrome__sub" role="group" aria-label="Colorir por">
            <button
              type="button"
              className={`zm-atlas-map-chrome__chip${territoryViewMode === 'temperature' ? ' zm-atlas-map-chrome__chip--on' : ''}`}
              onClick={() => onTerritoryViewModeChange('temperature')}
              title="Cor por temperatura dominante"
            >
              <Thermometer className="w-3 h-3" />
              Temp.
            </button>
            <button
              type="button"
              className={`zm-atlas-map-chrome__chip${territoryViewMode === 'volume' ? ' zm-atlas-map-chrome__chip--on' : ''}`}
              onClick={() => onTerritoryViewModeChange('volume')}
              title="Cor por volume de contatos"
            >
              <Flame className="w-3 h-3" />
              Volume
            </button>
          </div>
        )}

        <div className="zm-atlas-map-chrome__actions">
          <button type="button" className="zm-atlas-map-chrome__icon-btn" onClick={onFitBounds} title="Ajustar zoom">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="zm-atlas-map-chrome__icon-btn" onClick={onRecenter} title="Centralizar região">
            <Crosshair className="w-3.5 h-3.5" />
          </button>
          <select
            className="zm-atlas-map-chrome__tile"
            value={mapTile}
            onChange={(e) => onMapTileChange(e.target.value as MapTileId)}
            title="Estilo do mapa base"
            aria-label="Estilo do mapa base"
          >
            {(Object.keys(TILE_LABELS) as MapTileId[]).map((id) => (
              <option key={id} value={id}>
                {TILE_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="zm-atlas-map-chrome__row zm-atlas-map-chrome__row--meta">
        <span className="zm-atlas-map-chrome__stats">
          <MapPin className="w-3 h-3 shrink-0" />
          {statsLine}
        </span>
        <div className="zm-atlas-map-chrome__legend" aria-label="Legenda de temperatura">
          {(['hot', 'warm', 'cold', 'new'] as const).map((t) => (
            <span key={t} className="zm-atlas-map-chrome__legend-item">
              <span className="zm-atlas-map-chrome__legend-dot" style={{ background: TEMP_COLOR[t] }} />
              {CONTACT_TEMP_LABEL[t]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
