import React, { useEffect, useRef } from 'react';
import type { ScheduledOutbound } from '../../../utils/chatInboxPrefs';

type Props = {
  scheduled: ScheduledOutbound[];
  onDue: (item: ScheduledOutbound) => void;
};

/** Dispara mensagens agendadas quando o horário chega (browser aberto). */
export function useScheduledOutboundDispatch({ scheduled, onDue }: Props): void {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const item of scheduled) {
        if (item.sendAt > now) continue;
        if (firedRef.current.has(item.id)) continue;
        firedRef.current.add(item.id);
        onDue(item);
      }
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [scheduled, onDue]);
}
