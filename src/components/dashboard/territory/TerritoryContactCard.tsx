import React from 'react';
import { X } from 'lucide-react';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { MapContactPin } from './types';

type Props = {
  contact: MapContactPin;
  onClose: () => void;
};

export const TerritoryContactCard: React.FC<Props> = ({ contact, onClose }) => {
  const address = [contact.street, contact.number].filter(Boolean).join(', ');
  const place = [contact.neighborhood, contact.city, contact.state].filter(Boolean).join(' · ');

  return (
    <div className="zm-atlas-contact-card" role="dialog" aria-label={`Contato ${contact.name}`}>
      <button type="button" className="zm-atlas-contact-card__close" onClick={onClose} aria-label="Fechar">
        <X className="w-4 h-4" />
      </button>
      <div className="zm-atlas-contact-card__head">
        <span className="zm-atlas-contact-card__dot" style={{ background: TEMP_COLOR[contact.temp] }} />
        <div>
          <p className="zm-atlas-contact-card__name">{contact.name}</p>
          <p className="zm-atlas-contact-card__phone">{contact.phone || 'Sem telefone'}</p>
        </div>
        <span
          className="zm-atlas-contact-card__badge"
          style={{ color: TEMP_COLOR[contact.temp], borderColor: `${TEMP_COLOR[contact.temp]}55` }}
        >
          {CONTACT_TEMP_LABEL[contact.temp]}
        </span>
      </div>
      {(address || place || contact.zipCode) && (
        <div className="zm-atlas-contact-card__body">
          {address && <p>{address}</p>}
          {place && <p>{place}</p>}
          {contact.zipCode && <p className="zm-atlas-contact-card__cep">CEP {contact.zipCode}</p>}
          {contact.approximate && (
            <p className="zm-atlas-contact-card__approx">Posição aproximada no bairro</p>
          )}
        </div>
      )}
    </div>
  );
};
