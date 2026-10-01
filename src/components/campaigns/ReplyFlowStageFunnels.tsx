import React, { useMemo } from 'react';
import { Layers } from 'lucide-react';
import type { CampaignReplyFlowStep } from '../../types';
import type { ReplyFlowStageFunnel } from '../../utils/campaignReplyFlowStageMetrics';
import { buildReplyFlowStagePreviewItems } from '../../utils/campaignReplyFlowPreviewSequence';
import { PerformanceFunnel } from '../PerformanceFunnel';
import { ReplyFlowPreviewBubbleList } from './ReplyFlowPreviewBubbleList';

type Props = {
  stages: ReplyFlowStageFunnel[];
  totalContacts: number;
  flowSteps: CampaignReplyFlowStep[];
};

export const ReplyFlowStageFunnels: React.FC<Props> = ({ stages, totalContacts, flowSteps }) => {
  if (stages.length === 0) return null;

  const previewByStage = useMemo(
    () => stages.map((s) => buildReplyFlowStagePreviewItems(flowSteps, s.stageNumber - 1)),
    [stages, flowSteps]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.25)'
          }}
        >
          <Layers className="w-4 h-4" style={{ color: '#d97706' }} />
        </div>
        <div>
          <h3 className="ui-title text-[15px]">Funil por etapa (fluxo por resposta)</h3>
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Cada etapa conta <strong>contatos únicos</strong>, não o total de mensagens na fila. Abaixo de
            cada etapa, as <strong>bolhas</strong> mostram a mensagem e cada <strong>resposta</strong> do
            menu (como no WhatsApp). O funil principal acima reflete a <strong>Etapa 1</strong> (
            {totalContacts.toLocaleString('pt-BR')} contato{totalContacts !== 1 ? 's' : ''} na campanha).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {stages.map((stage, idx) => (
          <div
            key={stage.stageNumber}
            className="rounded-xl p-3 overflow-hidden flex flex-col gap-2"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-[12px] font-bold truncate" style={{ color: 'var(--text-1)' }} title={stage.label}>
              {stage.label}
            </p>

            <ReplyFlowPreviewBubbleList
              items={previewByStage[idx] ?? []}
              compact
              maxHeight={240}
            />

            <PerformanceFunnel
              sent={stage.sent}
              delivered={stage.delivered}
              read={stage.read}
              replied={stage.replied}
              height={200}
              showSidePanel={false}
              compact
            />
            <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[10px] tabular-nums" style={{ color: 'var(--text-3)' }}>
              <span>Entregue {stage.deliveryPct}%</span>
              <span>Lida {stage.readPct}%</span>
              <span>Resposta {stage.replyPct}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
