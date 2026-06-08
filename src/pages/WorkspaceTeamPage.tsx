import React from 'react';
import { Shield, Users } from 'lucide-react';
import { WorkspaceTeamSection } from '../components/settings/WorkspaceTeamSection';

export const WorkspaceTeamPage: React.FC = () => {
  return (
    <div className="max-w-[960px] mx-auto space-y-6 px-1">
      <header
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--brand-500), #6366f1)' }} />
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 text-white"
            style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
          >
            <Users className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--brand-600)' }}>
              Gestão de acesso
            </p>
            <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
              Funcionários
            </h1>
            <p className="text-[13px] mt-2 leading-relaxed max-w-2xl" style={{ color: 'var(--text-2)' }}>
              Adicione pessoas à sua conta, troque senhas, revogue acessos e envie instruções de login — tudo num só lugar.
            </p>
          </div>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-semibold shrink-0"
            style={{ background: 'rgba(99,102,241,0.08)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)' }}
          >
            <Shield className="w-4 h-4" />
            Plano da conta principal
          </div>
        </div>
      </header>
      <WorkspaceTeamSection variant="standalone" />
    </div>
  );
};
