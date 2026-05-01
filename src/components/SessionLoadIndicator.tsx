import React from 'react';
import { Activity, Cpu, Clock } from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';

/**
 * Indicador discreto da carga de sessão no servidor:
 *  - Workers vivos
 *  - Slots ocupados / máximos (concorrência local do worker actual)
 *  - Comandos a aguardar slot
 * Não aparece quando ainda não chegou o primeiro evento.
 */
export const SessionLoadIndicator: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { sessionLiveStats } = useZapMass();
  if (!sessionLiveStats) return null;
  const { workersAlive, inFlight, waiting, maxConcurrent, busRemote } = sessionLiveStats;

  const heavy = waiting > 0;
  const occupied = maxConcurrent > 0 ? Math.min(inFlight, maxConcurrent) : inFlight;

  return (
    <div
      className={`inline-flex items-center gap-2.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${
        heavy
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-emerald-50 border-emerald-200 text-emerald-700'
      }`}
      title={
        busRemote
          ? `${workersAlive} worker(s) | ${occupied}/${maxConcurrent} slot(s) ocupado(s) | ${waiting} na fila`
          : 'Modo monolítico (API+worker no mesmo processo)'
      }
      aria-label="Carga de sessão"
    >
      <span className="inline-flex items-center gap-1">
        <Cpu className="w-3 h-3" />
        {workersAlive} {workersAlive === 1 ? 'worker' : 'workers'}
      </span>
      {!compact && <span className="text-slate-300">·</span>}
      <span className="inline-flex items-center gap-1">
        <Activity className="w-3 h-3" />
        {occupied}/{maxConcurrent}
      </span>
      {waiting > 0 && (
        <>
          <span className="text-amber-300">·</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {waiting} na fila
          </span>
        </>
      )}
    </div>
  );
};
