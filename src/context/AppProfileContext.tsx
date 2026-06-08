import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { useAuth } from './AuthContext';
import { fetchAppProfile, saveAppProfileSegment } from '../services/appProfileApi';
import { useWorkspace } from './WorkspaceContext';
import { isPlatformAdminUser } from '../utils/adminAccess';
import {
  DEFAULT_USE_SEGMENT,
  isValidUseSegment,
  type UseSegmentId
} from '../constants/useSegments';

type AppProfileContextValue = {
  loading: boolean;
  savedSegment: UseSegmentId | null;
  segment: UseSegmentId;
  needsSegmentOnboarding: boolean;
  saveSegment: (id: UseSegmentId) => Promise<void>;
};

const AppProfileContext = createContext<AppProfileContextValue>({
  loading: true,
  savedSegment: null,
  segment: DEFAULT_USE_SEGMENT,
  needsSegmentOnboarding: false,
  saveSegment: async () => {}
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

    let cancelled = false;
    const load = async () => {
      try {
        const seg = await fetchAppProfile();
        if (!cancelled) setSavedSegment(seg);
      } catch (e) {
        console.error('[AppProfileContext]', e);
        if (!cancelled) setSavedSegment(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, workspaceUid, workspaceLoading]);

  const segment: UseSegmentId = savedSegment ?? DEFAULT_USE_SEGMENT;

  const needsSegmentOnboarding = useMemo(() => {
    if (workspaceLoading || loading || !user || !workspaceUid || !authUid) return false;
    if (isPlatformAdminUser(user)) return false;
    if (authUid !== workspaceUid) return false;
    return savedSegment === null;
  }, [workspaceLoading, loading, user, workspaceUid, authUid, savedSegment]);

  const saveSegment = useCallback(
    async (id: UseSegmentId) => {
      if (!user || !workspaceUid) throw new Error('Sem sessão.');
      if (user.uid !== workspaceUid) {
        throw new Error('Apenas o dono da conta pode alterar o segmento.');
      }
      await saveAppProfileSegment(id);
      setSavedSegment(id);
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
