import React, { useEffect, useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { firestoreTimeToMs } from '../../utils/firestoreTime';

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Contagem regressiva do teste gratuito (1h) no cabecalho. */
export const TrialHeaderCountdown: React.FC = () => {
  const { subscription } = useSubscription();
  const [, setTick] = useState(0);

  const trialEndMs = useMemo(() => {
    if (subscription?.status !== 'trialing') return null;
    return firestoreTimeToMs(subscription.trialEndsAt);
  }, [subscription]);

  useEffect(() => {
    if (trialEndMs == null) return;
    if (trialEndMs <= Date.now()) return;
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [trialEndMs]);

  if (trialEndMs == null) return null;

  const remainingSec = Math.max(0, Math.floor((trialEndMs - Date.now()) / 1000));

  return (
    <div
      className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-lg flex-shrink-0"
      style={{
        background: 'rgba(245, 158, 11, 0.14)',
        border: '1px solid rgba(245, 158, 11, 0.35)'
      }}
      title="Tempo restante do teste gratuito"
    >
      <Timer className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden />
      <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
        Teste
      </span>
      <span
        className="text-[12px] sm:text-[13px] font-bold tabular-nums tracking-tight text-amber-950 dark:text-amber-100"
        suppressHydrationWarning
      >
        {formatCountdown(remainingSec)}
      </span>
    </div>
  );
};
