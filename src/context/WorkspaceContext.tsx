import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './AuthContext';

type WorkspaceContextValue = {
  /** Carregando snapshot de userWorkspaceLinks. */
  loading: boolean;
  /** UID do login Firebase. */
  authUid: string | null;
  /** UID usado em `users/{uid}/...` e assinatura (dono da conta partilhada ou o próprio utilizador). */
  effectiveWorkspaceUid: string | null;
  /** Convite aceite: o utilizador opera a conta de outro UID. */
  isTeamMember: boolean;
  /** UID do dono quando é membro da equipa (igual a effectiveWorkspaceUid nesse caso). */
  ownerUid: string | null;
  /** Rele o documento workspace (após resgatar código). */
  refresh: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue>({
  loading: true,
  authUid: null,
  effectiveWorkspaceUid: null,
  isTeamMember: false,
  ownerUid: null,
  refresh: () => {}
});

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [ownerFromLink, setOwnerFromLink] = useState<string | null>(null);

  const reset = useCallback(() => {
    setOwnerFromLink(null);
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      reset();
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = doc(db, 'userWorkspaceLinks', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const ou = snap.exists() ? (snap.data() as { ownerUid?: unknown }).ownerUid : null;
        setOwnerFromLink(typeof ou === 'string' && ou.trim() ? ou.trim() : null);
        setLoading(false);
      },
      (err) => {
        console.error('[WorkspaceContext]', err);
        setOwnerFromLink(null);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid, reset]);

  const value = useMemo((): WorkspaceContextValue => {
    const authUid = user?.uid ?? null;
    const effectiveWorkspaceUid =
      authUid != null ? (ownerFromLink != null && ownerFromLink.length > 0 ? ownerFromLink : authUid) : null;
    const isTeamMember =
      Boolean(authUid && ownerFromLink && ownerFromLink.length > 0 && ownerFromLink !== authUid);
    return {
      loading,
      authUid,
      effectiveWorkspaceUid,
      isTeamMember,
      ownerUid: isTeamMember ? ownerFromLink : null,
      refresh: () => {
        /* onSnapshot já actualiza; mantido para UX depois de resgatar */
      }
    };
  }, [user?.uid, ownerFromLink, loading]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = (): WorkspaceContextValue => useContext(WorkspaceContext);
