import React from 'react';
import { AlertCircle, Database, MapPin, Rocket, Users } from 'lucide-react';

type Props = {
  regionLabel: string;
  regionTotal: number;
  serverRegionTotal: number | null;
  globalContactsLoaded: number;
  globalContactsTotal: number | null;
  contactsHydrating: boolean;
  scopeContactCount: number;
  withNeighborhoodPct: number;
  withCoordsPct: number;
  onLaunchCampaign: () => void;
  onOpenContacts: () => void;
};

export const TerritoryAtlasMeta: React.FC<Props> = ({
  regionLabel,
  regionTotal,
  serverRegionTotal,
  globalContactsLoaded,
  globalContactsTotal,
  contactsHydrating,
  scopeContactCount,
  withNeighborhoodPct,
  withCoordsPct,
  onLaunchCampaign,
  onOpenContacts,
}) => {
  const displayRegionTotal = serverRegionTotal ?? regionTotal;
  const globalLabel =
    globalContactsTotal != null
      ? `${globalContactsLoaded.toLocaleString('pt-BR')} de ${globalContactsTotal.toLocaleString('pt-BR')} na base`
      : `${globalContactsLoaded.toLocaleString('pt-BR')} carregados`;

  return (
    <div className="zm-atlas-meta">
      <div className="zm-atlas-meta__context">
        <p className="zm-atlas-meta__line">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong>{displayRegionTotal.toLocaleString('pt-BR')}</strong> contatos em{' '}
            <strong>{regionLabel}</strong>
            {globalContactsTotal != null && displayRegionTotal !== globalContactsTotal && (
              <>
                {' '}
                · base global: <strong>{globalContactsTotal.toLocaleString('pt-BR')}</strong>
              </>
            )}
          </span>
        </p>
        {contactsHydrating && (
          <p className="zm-atlas-meta__sync">
            <Database className="w-3.5 h-3.5 shrink-0 animate-pulse" />
            Sincronizando base… {globalLabel}
            {scopeContactCount < displayRegionTotal && (
              <span className="zm-atlas-meta__sync-note">
                {' '}
                — temperaturas usam {scopeContactCount.toLocaleString('pt-BR')} contatos já carregados na região
              </span>
            )}
          </p>
        )}
        {!contactsHydrating && scopeContactCount < displayRegionTotal && displayRegionTotal > 0 && (
          <p className="zm-atlas-meta__warn">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Contagens por bairro vêm do servidor; temperatura usa {scopeContactCount.toLocaleString('pt-BR')} contatos
            carregados nesta região.
          </p>
        )}
      </div>

      <div className="zm-atlas-meta__health">
        <span title="Contatos com bairro cadastrado">Bairro {withNeighborhoodPct}%</span>
        <span className="zm-atlas-meta__sep">·</span>
        <span title="Contatos com coordenada no mapa">Mapa {withCoordsPct}%</span>
      </div>

      <div className="zm-atlas-meta__actions">
        <button type="button" className="zm-atlas-meta__btn zm-atlas-meta__btn--primary" onClick={onLaunchCampaign}>
          <Rocket className="w-3.5 h-3.5" />
          Campanha na região
        </button>
        <button type="button" className="zm-atlas-meta__btn" onClick={onOpenContacts}>
          <Users className="w-3.5 h-3.5" />
          Central de contatos
        </button>
      </div>
    </div>
  );
};
