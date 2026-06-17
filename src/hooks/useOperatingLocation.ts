import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  fetchOperatingLocation,
  saveOperatingLocationFromGps,
  saveOperatingLocationFromIp,
  saveOperatingLocationManual,
  type OperatingLocation,
  type OperatingLocationSource
} from '../services/operatingLocationApi';
import {
  queryGeolocationPermission,
  requestBrowserGeolocation
} from '../utils/geolocationHelpers';

const CITY_PRESETS = [
  'Blumenau · SC',
  'Florianópolis · SC',
  'Joinville · SC',
  'Curitiba · PR',
  'São Paulo · SP',
  'Porto Alegre · RS'
];

export function useOperatingLocation(fallbackCity = 'Blumenau · SC') {
  const [cityLabel, setCityLabelState] = useState(fallbackCity);
  const [source, setSource] = useState<OperatingLocationSource | undefined>();
  const [loading, setLoading] = useState(true);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loc = await fetchOperatingLocation();
        if (cancelled) return;
        skipNextSave.current = true;
        setCityLabelState(loc.cityLabel || fallbackCity);
        setSource(loc.source);
      } catch {
        if (!cancelled) setCityLabelState(fallbackCity);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fallbackCity]);

  const persistManual = useCallback(async (label: string) => {
    const trimmed = label.trim();
    if (trimmed.length < 3) return;
    setSaving(true);
    try {
      const loc = await saveOperatingLocationManual(trimmed);
      setSource(loc.source || 'manual');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar a cidade.');
    } finally {
      setSaving(false);
    }
  }, []);

  const setCityLabel = useCallback(
    (next: string) => {
      setCityLabelState(next);
      if (skipNextSave.current) {
        skipNextSave.current = false;
        return;
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persistManual(next);
      }, 900);
    },
    [persistManual]
  );

  const useMyLocation = useCallback(() => {
    setGpsLoading(true);

    void (async () => {
      try {
        const permission = await queryGeolocationPermission();

        if (permission === 'granted') {
          try {
            const pos = await requestBrowserGeolocation({ enableHighAccuracy: true, timeout: 12_000 }).catch(
              (firstErr) => {
                if (
                  firstErr instanceof GeolocationPositionError &&
                  firstErr.code === firstErr.TIMEOUT
                ) {
                  return requestBrowserGeolocation({ enableHighAccuracy: false, timeout: 15_000 });
                }
                throw firstErr;
              }
            );
            const loc = await saveOperatingLocationFromGps(pos.coords.latitude, pos.coords.longitude);
            skipNextSave.current = true;
            setCityLabelState(loc.cityLabel);
            setSource('gps');
            toast.success(`Localização: ${loc.cityLabel}`);
            return;
          } catch {
            /* GPS falhou — tenta detecção automática pela rede */
          }
        }

        const loc = await saveOperatingLocationFromIp();
        skipNextSave.current = true;
        setCityLabelState(loc.cityLabel);
        setSource('ip');
        toast.success(`Localização detectada: ${loc.cityLabel}`);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Não foi possível detectar sua localização. Digite a cidade no campo.'
        );
      } finally {
        setGpsLoading(false);
      }
    })();
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  return {
    cityLabel,
    setCityLabel,
    source,
    loading,
    gpsLoading,
    saving,
    useMyLocation,
    cityPresets: CITY_PRESETS
  };
}

export type { OperatingLocation };
