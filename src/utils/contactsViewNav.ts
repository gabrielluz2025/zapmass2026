/** Handshake lido por `ContactsTab` ao abrir import ou sync vindo de outras telas. */
export const CONTACTS_OPEN_ACTION_KEY = 'zapmass.contactsOpenAction';

export type ContactsOpenAction = 'import' | 'sync';

export function navigateToContacts(
  setCurrentView: (view: string) => void,
  action?: ContactsOpenAction
): void {
  if (action) {
    try {
      sessionStorage.setItem(CONTACTS_OPEN_ACTION_KEY, action);
    } catch {
      /* ignore */
    }
  }
  setCurrentView('contacts');
}
