import { useCallback, useEffect, useState } from 'react';
import { fetchAiStatus } from '../services/aiApi';

export function useAiStatus() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchAiStatus();
      setConfigured(s.configured);
      setModel(s.model);
    } catch {
      setConfigured(false);
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { configured, model, loading, refresh };
}
