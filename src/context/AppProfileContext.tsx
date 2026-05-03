import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { isAdminUserEmail } from '../utils/adminAccess';
import {
  DEFAULT_USE_SEGMENT,
  isValidUseSegment,
  type UseSegmentId
} from '../constants/useSegments';

type AppProfileContextValue = {
  loading: boolean;
  /** Valor persistido no Firestore; `null` se ainda não há doc ou campo inválido. */
  savedSegment: UseSegmentId | null;
  /**
   * Segmento para UI e futuras personalizações: sempre um id válido
   * (equipa herda o do dono; se ausente, `general`).
   */
  segment: UseSegmentId;
  /** Só o dono da workspace (não membro Google nem funcionário) precisa preencher no primeiro acesso. */
  needsSegmentOnboarding: boolean;
  saveSegment: (id: UseSegmentId) => Promise<void>;
};

const AppProfileContext = createContext<AppProfileContextValue>({
  loading: true,
  savedSegment: null,
  segment: DEFAULT_USE_SEGMENT,
  needsSegmentOnboarding: false,
  saveSegment: async () => {
    /* noop */
  }
});

export const AppProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { effectiveWorkspaceUid, loading: workspaceLoading, authUid } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [savedSegment, setSavedSegment] = useState<UseSegmentId | null>(null);

  const workspaceUid = effectiveWorkspaceUid;

  useEffect(() => {
    if (workspaceLoading || !user || !workspaceUid) {
      setSavedSegment(null);
      setLoading(!user || workspaceLoading);
      return;
    }

    setLoading(true);
    const ref = doc(db, 'users', workspaceUid, 'app_profile', 'main');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const raw = snap.exists() ? (snap.data() as { useSegment?: unknown }).useSegment : undefined;
        setSavedSegment(isValidUseSegment(raw) ? raw : null);
        setLoading(false);
      },
      (err) => {
        console.error('[AppProfileContext]', err);
        setSavedSegment(null);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user, workspaceUid, workspaceLoading]);

  const segment: UseSegmentId = savedSegment ?? DEFAULT_USE_SEGMENT;

  const needsSegmentOnboarding = useMemo(() => {
    if (workspaceLoading || loading || !user || !workspaceUid || !authUid) return false;
    if (isAdminUserEmail(user.email)) return false;
    /** Só o dono grava `app_profile`; equipa herda leitura do doc do dono. */
    if (authUid !== workspaceUid) return false;
    return savedSegment === null;
  }, [workspaceLoading, loading, user, workspaceUid, authUid, savedSegment]);

  /** Grava só `useSegment` em `app_profile/main` (merge). Não toca em contatos, listas, campanhas nem assinatura. */
  const saveSegment = useCallback(
    async (id: UseSegmentId) => {
      if (!user || !workspaceUid) throw new Error('Sem sessão.');
      if (user.uid !== workspaceUid) {
        throw new Error('Apenas o dono da conta pode alterar o segmento.');
      }
      const ref = doc(db, 'users', workspaceUid, 'app_profile', 'main');
      await setDoc(ref, { useSegment: id }, { merge: true });
    },
    [user, workspaceUid]
  );

  const value = useMemo(
    () => ({
      loading: workspaceLoading || (Boolean(user && workspaceUid) && loading),
      savedSegment,
      segment,
      needsSegmentOnboarding,
      saveSegment
    }),
    [workspaceLoading, loading, user, workspaceUid, savedSegment, segment, needsSegmentOnboarding, saveSegment]
  );

  return <AppProfileContext.Provider value={value}>{children}</AppProfileContext.Provider>;
};

export const useAppProfile = (): AppProfileContextValue => useContext(AppProfileContext);
