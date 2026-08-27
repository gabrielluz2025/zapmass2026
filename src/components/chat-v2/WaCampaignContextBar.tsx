import React from 'react';
import { Megaphone } from 'lucide-react';
import type { Conversation } from '../../types';
import type { getConversationPipelineAgg } from './lib/chatPreview';
import { conversationHasCampaignMessages } from './lib/inboxFilter';

type PipelineAgg = NonNullable<ReturnType<typeof getConversationPipelineAgg>>;

type Props = {
  conversation: Conversation;
  pipelineAgg: PipelineAgg | null;
  connectionName?: string | null;
};

export const WaCampaignContextBar: React.FC<Props> = ({
  conversation,
  pipelineAgg,
  connectionName,
}) => {
  const fromCampaign = conversationHasCampaignMessages(conversation);
  if (!fromCampaign && !pipelineAgg) return null;

  const sent = pipelineAgg?.sent ?? 0;
  const replies = pipelineAgg?.replies ?? 0;
  const read = pipelineAgg?.read ?? 0;

  return (
    <div className="wa-campaign-bar">
      <Megaphone className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--wa-green-strong)' }} />
      <div className="min-w-0 flex-1">
        <p className="wa-campaign-bar__title">
          {fromCampaign ? 'Lead de campanha' : 'Histórico de disparos'}
          {connectionName ? ` · ${connectionName}` : ''}
        </p>
        {pipelineAgg && (
          <p className="wa-campaign-bar__sub">
            Enviadas {sent} · Lidas {read} · Respostas {replies}
          </p>
        )}
      </div>
    </div>
  );
};
