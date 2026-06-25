import React, { useDeferredValue } from 'react';
import { TerritoryLeadsMap } from '../dashboard/TerritoryLeadsMap';
import { useZapMassCore, useZapMassConversations } from '../../context/ZapMassContext';
import { useAppView } from '../../context/AppViewContext';
import { PageShell, Badge } from '../ui';

export const ContactsMapTab: React.FC = () => {
  const { setCurrentView } = useAppView();
  const { contacts, contactsSavedTotal, contactsHasMore, contactsLoadingMore } = useZapMassCore();
  const conversations = useZapMassConversations();
  const deferredConversations = useDeferredValue(conversations);

  const totalLabel =
    contactsSavedTotal != null
      ? contactsSavedTotal.toLocaleString('pt-BR')
      : contacts.length.toLocaleString('pt-BR');

  return (
    <PageShell
      statusStrip={
        <>
          <Badge variant="neutral">Atlas</Badge>
          <span className="ui-caption tabular-nums">{totalLabel} contatos</span>
          {contactsHasMore && (
            <span className="ui-caption">Carregando base…</span>
          )}
        </>
      }
      className="zm-contacts-map-page flex min-h-0 flex-1 flex-col"
    >
      <TerritoryLeadsMap
        variant="page"
        contacts={contacts}
        conversations={deferredConversations}
        contactsSavedTotal={contactsSavedTotal}
        contactsHasMore={contactsHasMore}
        contactsLoadingMore={contactsLoadingMore}
        onNavigate={setCurrentView}
      />
    </PageShell>
  );
};
