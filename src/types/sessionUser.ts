/** Utilizador autenticado na sessão (substitui `User` do Firebase Auth). */
export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}
