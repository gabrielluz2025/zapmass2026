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
import { getVpsAuthUser } from '../services/vpsAuth';

type WorkspaceContextValue = {
  loading: boolean;
  authUid: string | null;
  effectiveWorkspaceUid: string | null;
  isTeamMember: boolean;
  ownerUid: string | null;
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
  const [revision, setRevision] = useState(0);

  const reset = useCallback(() => {
    setOwnerFromLink(null);
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      reset();
      setLoading(false);
      return;
    }
    const vu = getVpsAuthUser();
    if (vu?.role === 'staff' && vu.ownerUid) {
      setOwnerFromLink(vu.ownerUid);
    } else {
      setOwnerFromLink(null);
    }
    setLoading(false);
  }, [user?.uid, revision, reset]);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  const value = useMemo((): WorkspaceContextValue => {
    const authUid = user?.uid ?? null;
    const ownerUid = ownerFromLink;
    const isTeamMember = Boolean(ownerUid && authUid && ownerUid !== authUid);
    const effectiveWorkspaceUid = isTeamMember ? ownerUid : authUid;
    return {
      loading,
      authUid,
      effectiveWorkspaceUid,
      isTeamMember,
      ownerUid: isTeamMember ? ownerUid : null,
      refresh
    };
  }, [user?.uid, ownerFromLink, loading, refresh]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => useContext(WorkspaceContext);
