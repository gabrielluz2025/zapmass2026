import React from 'react';
import { useZapMassUiSnapshot } from '../../context/ZapMassContext';

/**
 * Indicador micro de sincronização de contatos.
 * Linha de 2 px no topo absoluto da viewport — não desloca nenhum layout,
 * não exibe texto, não bloqueia interação. Fica invisível quando inativo.
 */
export const ContactsGlobalPreloadBar: React.FC = () => {
  const { contactsPreload } = useZapMassUiSnapshot();
  if (!contactsPreload.active) return null;

  const pct = contactsPreload.percent;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        background: 'transparent',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #10b981, #06b6d4)',
          transition: 'width 600ms ease-out',
          borderRadius: '0 2px 2px 0',
        }}
      />
    </div>
  );
};
