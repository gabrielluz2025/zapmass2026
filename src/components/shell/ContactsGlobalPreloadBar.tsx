import React from 'react';
import { Loader2 } from 'lucide-react';
import { useZapMassUiSnapshot } from '../../context/ZapMassContext';

/** Barra global de progresso — visível em qualquer aba enquanto a base de contatos hidrata. */
export const ContactsGlobalPreloadBar: React.FC = () => {
  const { contactsPreload } = useZapMassUiSnapshot();
  if (!contactsPreload.active) return null;

  return (
    <div
      className="relative z-[25] border-b px-3 sm:px-5 py-2"
      style={{
        background: 'var(--surface-1)',
        borderColor: 'var(--border-subtle)'
      }}
      role="status"
      aria-live="polite"
      aria-valuenow={contactsPreload.percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="mx-auto flex max-w-[1800px] items-center gap-3">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-emerald-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              Carregando base de contatos em segundo plano
            </p>
            <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: 'var(--brand-600)' }}>
              {contactsPreload.percent}%
            </span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--surface-2)' }}
            role="progressbar"
            aria-valuenow={contactsPreload.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{
                width: `${contactsPreload.percent}%`,
                background: 'linear-gradient(90deg, #10b981, #06b6d4)'
              }}
            />
          </div>
          <p className="text-[10px] mt-1 tabular-nums" style={{ color: 'var(--text-3)' }}>
            {contactsPreload.loaded.toLocaleString('pt-BR')} de {contactsPreload.total.toLocaleString('pt-BR')}{' '}
            contatos — você pode usar o sistema normalmente enquanto carrega
          </p>
        </div>
      </div>
    </div>
  );
};
