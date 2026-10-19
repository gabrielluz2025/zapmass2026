import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAgentStatus } from '../services/agentApi';
import { isPlatformAdminUser } from '../utils/adminAccess';

/** Assistente legado /api/ai (Gemini) — opt-in via GEMINI_LEGACY_ASSISTANT; só admins. */
export function useAiStatus() {
  const { user } = useAuth();
  const isAdmin = isPlatformAdminUser(user);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setConfigured(false);
      setModel(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchAgentStatus();
      setConfigured(!!s.legacyGeminiFabEnabled && s.isPlatformAdmin);
      setModel(s.model);
    } catch {
      setConfigured(false);
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { configured, model, loading, refresh, isAdmin };
}
