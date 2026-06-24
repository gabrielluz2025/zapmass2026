/**
 * Atalho compacto no painel — leva à aba Mapa dos Contatos.
 */
import React, { useMemo } from 'react';
import { ArrowUpRight, Globe2, MapPin, Users } from 'lucide-react';
import type { Contact } from '../../types';

type Props = {
  contacts: Contact[];
  contactsSavedTotal?: number | null;
  onOpenMap: () => void;
};

export const TerritoryMapTeaser: React.FC<Props> = ({ contacts, contactsSavedTotal, onOpenMap }) => {
  const stats = useMemo(() => {
    let withCoords = 0;
    let withNeighborhood = 0;
    for (const c of contacts) {
      if (c.latitude != null && c.longitude != null) withCoords += 1;
      if (c.neighborhood?.trim()) withNeighborhood += 1;
    }
    const total = contacts.length;
    const coordsPct = total > 0 ? Math.round((withCoords / total) * 100) : 0;
    const nbPct = total > 0 ? Math.round((withNeighborhood / total) * 100) : 0;
    return { total, coordsPct, nbPct };
  }, [contacts]);

  const displayTotal =
    contactsSavedTotal != null && contactsSavedTotal > stats.total
      ? contactsSavedTotal
      : stats.total;

  return (
    <section className="zm-map-teaser">
      <div className="zm-map-teaser__copy">
        <div className="zm-map-teaser__icon" aria-hidden>
          <Globe2 className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="zm-map-teaser__title">Mapa dos contatos</h2>
          <p className="zm-map-teaser__sub">
            Explore cidades, bairros e temperatura da base em um atlas interativo — campanhas por região e
            cobertura geográfica.
          </p>
        </div>
      </div>

      <div className="zm-map-teaser__kpis">
        <div className="zm-map-teaser__kpi">
          <Users className="w-3.5 h-3.5" />
          <span className="zm-map-teaser__kpi-val">{displayTotal.toLocaleString('pt-BR')}</span>
          <span className="zm-map-teaser__kpi-label">contatos</span>
        </div>
        <div className="zm-map-teaser__kpi">
          <MapPin className="w-3.5 h-3.5" />
          <span className="zm-map-teaser__kpi-val">{stats.nbPct}%</span>
          <span className="zm-map-teaser__kpi-label">com bairro</span>
        </div>
        <div className="zm-map-teaser__kpi">
          <Globe2 className="w-3.5 h-3.5" />
          <span className="zm-map-teaser__kpi-val">{stats.coordsPct}%</span>
          <span className="zm-map-teaser__kpi-label">no mapa</span>
        </div>
      </div>

      <button type="button" className="zm-map-teaser__cta" onClick={onOpenMap}>
        Abrir mapa
        <ArrowUpRight className="w-4 h-4" />
      </button>
    </section>
  );
};
