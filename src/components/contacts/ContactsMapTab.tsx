/**
 * Aba dedicada — Mapa dos Contatos (Atlas territorial em tela cheia).
 */
import React, { useDeferredValue } from 'react';
import { TerritoryLeadsMap } from '../dashboard/TerritoryLeadsMap';
import { useZapMassCore } from '../../context/ZapMassContext';
import { useAppView } from '../../context/AppViewContext';

export const ContactsMapTab: React.FC = () => {
  const { setCurrentView } = useAppView();
  const { contacts, conversations, contactsSavedTotal, contactsHasMore, contactsLoadingMore } =
    useZapMassCore();
  const deferredConversations = useDeferredValue(conversations);

  return (
    <div className="zm-contacts-map-page flex min-h-0 flex-1 flex-col">
      <TerritoryLeadsMap
        variant="page"
        contacts={contacts}
        conversations={deferredConversations}
        contactsSavedTotal={contactsSavedTotal}
        contactsHasMore={contactsHasMore}
        contactsLoadingMore={contactsLoadingMore}
        onNavigate={setCurrentView}
      />
    </div>
  );
};
