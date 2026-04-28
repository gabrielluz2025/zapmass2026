import React from 'react';
import { WorkspaceTeamSection } from '../components/settings/WorkspaceTeamSection';

/**
 * Página própria para convites de equipa (mais visível do que só dentro de Configurações).
 */
export const WorkspaceTeamPage: React.FC = () => {
  return (
    <div className="max-w-[720px] mx-auto space-y-6 px-1">
      <header className="rounded-2xl p-5 sm:p-6 border text-center sm:text-left"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.09), rgba(59,130,246,0.06))',
          borderColor: 'rgba(16,185,129,0.28)'
        }}
      >
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--brand-600)' }}>
          Conta partilhada
        </p>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
          Funcionários na sua conta
        </h1>
        <p className="text-[13px] mt-2 leading-relaxed max-w-xl" style={{ color: 'var(--text-2)' }}>
          Escolha <strong>sou o responsável</strong> para convites ou usuário/senha, ou{' '}
          <strong>recebi um código</strong> para ativar o convite. O plano é sempre o da conta principal.
        </p>
      </header>
      <WorkspaceTeamSection variant="standalone" />
    </div>
  );
};
