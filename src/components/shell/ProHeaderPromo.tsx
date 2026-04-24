import React, { useEffect, useMemo, useState } from 'react';
import { Timer, Zap } from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { useAuth } from '../../context/AuthContext';
import { firestoreTimeToMs } from '../../utils/firestoreTime';
import { clearTrialEndLocal, readTrialEndMsFromLocal } from '../../utils/trialLocalEnd';
import { isAdminUserEmail } from '../../utils/adminAccess';

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface ProHeaderPromoProps {
  showProActivePill: boolean;
  accessEndLabel: string | null;
}

/** Centro do header: apenas cronometro do teste ou pill Pro ativo (CTA fica na barra unificada a direita). */
export const ProHeaderPromo: React.FC<ProHeaderPromoProps> = ({ showProActivePill, accessEndLabel }) => {
  const { subscription } = useSubscription();
  const { user } = useAuth();
  const [, setTick] = useState(0);
  const isAdmin = isAdminUserEmail(user?.email ?? null);

  const trialEndMs = useMemo(() => {
    if (isAdmin) return null;
    const now = Date.now();
    const fromFs = firestoreTimeToMs(subscription?.trialEndsAt);
    const fromLocal = readTrialEndMsFromLocal();
    const ok = (t: number | null) => (t != null && Number.isFinite(t) && t > now ? t : null);
    const a = ok(fromFs);
    const b = ok(fromLocal);
    if (a != null && b != null) return Math.max(a, b);
    return a ?? b ?? null;
  }, [subscription, isAdmin]);

  const trialActive = trialEndMs != null && trialEndMs > Date.now();

  useEffect(() => {
    if (!trialActive) {
      if (trialEndMs != null && trialEndMs <= Date.now()) clearTrialEndLocal();
      return;
    }
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [trialActive, trialEndMs]);

  useEffect(() => {
    if (subscription?.status === 'active') clearTrialEndLocal();
  }, [subscription?.status]);

  const remainingSec =
    trialEndMs != null ? Math.max(0, Math.floor((trialEndMs - Date.now()) / 1000)) : 0;

  if (isAdmin) return null;

  if (showProActivePill && !trialActive) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg w-fit max-w-full"
        style={{
          background: 'rgba(16,185,129,0.1)',
          border: '1px solid rgba(16,185,129,0.28)'
        }}
      >
        <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        <span className="text-[10px] font-bold truncate" style={{ color: 'var(--brand-600)' }}>
          Pro ativo{accessEndLabel ? ` · ${accessEndLabel}` : ''}
        </span>
      </div>
    );
  }

  if (!trialActive) return null;

  return (
    <div className="relative w-fit max-w-[min(100%,280px)] mx-auto">
      <div
        className="absolute -inset-px rounded-lg opacity-90 z-0"
        style={{
          background: 'linear-gradient(120deg, #f59e0b, #ea580c, #db2777, #f59e0b)',
          backgroundSize: '200% 200%',
          animation: 'zm-shine 3s ease infinite'
        }}
      />
      <style>{`
        @keyframes zm-shine {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      <div
        className="relative z-[1] flex flex-row items-center gap-1.5 rounded-lg px-2 py-1"
        style={{
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface-0) 96%, #1e1b4b 4%), var(--surface-0))',
          border: '1px solid color-mix(in srgb, var(--border) 70%, #f97316 30%)',
          boxShadow: '0 4px 16px rgba(234, 88, 12, 0.12)'
        }}
      >
        <div
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.22), rgba(234,88,12,0.14))',
            border: '1px solid rgba(245, 158, 11, 0.35)'
          }}
        >
          <Timer className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden />
          <div className="flex flex-col min-w-0 leading-none">
            <span className="text-[8px] font-bold uppercase tracking-wide text-amber-200/85 truncate max-w-[6.5rem] sm:max-w-none">
              Teste grátis
            </span>
            <span
              className="text-[15px] sm:text-[17px] font-black tabular-nums text-white drop-shadow-sm mt-0.5"
              suppressHydrationWarning
            >
              {formatCountdown(remainingSec)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
