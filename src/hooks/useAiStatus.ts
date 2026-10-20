import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAgentStatus } from '../services/agentApi';
import { isPlatformAdminUser } from '../utils/adminAccess';
import { resolveProviderBadge, type AiProviderBadge } from '../utils/aiAssistantBranding';

export type { AiProviderBadge };

/**
 * Agente ZapMass admin (/api/agent, modo admin_full).
 * `configured`: admin plataforma + agente habilitado.
 * `legacyGeminiFab`: FAB legado /api/ai — GEMINI_LEGACY_ASSISTANT + chave.
 */
export function useAiStatus() {
  const { user } = useAuth();
  const isAdmin = isPlatformAdminUser(user);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [legacyGeminiFab, setLegacyGeminiFab] = useState<boolean | null>(null);
  const [providerBadge, setProviderBadge] = useState<AiProviderBadge>('deterministic');
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setConfigured(false);
      setLegacyGeminiFab(false);
      setProviderBadge('deterministic');
      setModel(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await fetchAgentStatus();
      const ok = !!s.ok && s.enabled && s.isPlatformAdmin;
      setConfigured(ok);
      setLegacyGeminiFab(!!s.legacyGeminiFabEnabled && s.isPlatformAdmin);
      setProviderBadge(resolveProviderBadge(s.provider));
      setModel(s.model);
    } catch {
      setConfigured(false);
      setLegacyGeminiFab(false);
      setProviderBadge('deterministic');
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { configured, legacyGeminiFab, providerBadge, model, loading, refresh, isAdmin };
}
