import React from 'react';
import { Crosshair, Loader2, MapPin } from 'lucide-react';
import { Button } from '../ui/Button';
import { useOperatingLocation } from '../../hooks/useOperatingLocation';

type Props = {
  compact?: boolean;
  className?: string;
};

export const OperatingLocationEditor: React.FC<Props> = ({ compact = false, className = '' }) => {
  const {
    cityLabel,
    setCityLabel,
    source,
    loading,
    gpsLoading,
    saving,
    useMyLocation,
    cityPresets
  } = useOperatingLocation();

  return (
    <div className={className}>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'mb-3'}`}>
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <MapPin className="w-4 h-4 text-indigo-500 shrink-0" />
          <input
            list="zm-operating-city-presets"
            value={cityLabel}
            disabled={loading}
            onChange={(e) => setCityLabel(e.target.value)}
            className="flex-1 min-w-0 rounded-xl border border-stone-200/80 bg-white/90 px-3 py-2 text-[13px] font-semibold text-stone-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50 disabled:opacity-60"
            placeholder="Cidade · UF (ex: Blumenau · SC)"
          />
          <datalist id="zm-operating-city-presets">
            {cityPresets.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={loading || gpsLoading}
          onClick={() => void useMyLocation()}
          title="Detectar minha localização automaticamente"
          leftIcon={
            gpsLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Crosshair className="w-3.5 h-3.5" />
            )
          }
        >
          Minha localização
        </Button>
      </div>

      {!compact && (
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          {loading
            ? 'A carregar região salva…'
            : saving
              ? 'A guardar…'
              : source === 'gps'
                ? 'Última atualização via GPS — usada no mapa territorial e filtros.'
                : source === 'ip'
                  ? 'Localização detectada automaticamente pela rede — usada no mapa territorial.'
                  : 'Cidade manual salva na sua conta — cada usuário vê a sua região.'}
        </p>
      )}
    </div>
  );
};
