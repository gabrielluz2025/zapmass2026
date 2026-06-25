import React from 'react';
import { Shield } from 'lucide-react';
import { WorkspaceTeamSection } from '../components/settings/WorkspaceTeamSection';
import { PageShell, Badge } from '../components/ui';

export const WorkspaceTeamPage: React.FC = () => {
  return (
    <PageShell
      statusStrip={
        <>
          <Badge variant="info" dot>
            Equipa
          </Badge>
          <span className="ui-caption hidden sm:inline">Convites, senhas e acessos partilhados</span>
        </>
      }
      actions={
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ui-caption font-semibold"
          style={{ background: 'rgba(99,102,241,0.08)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)' }}
        >
          <Shield className="w-3.5 h-3.5" />
          Plano da conta principal
        </span>
      }
    >
      <div className="max-w-[960px] mx-auto">
        <WorkspaceTeamSection variant="standalone" />
      </div>
    </PageShell>
  );
};
