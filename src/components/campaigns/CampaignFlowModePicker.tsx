import React from 'react';
import { ChevronDown, GitBranch, ListOrdered, MessageSquare } from 'lucide-react';

export type CampaignFlowMode = 'single' | 'sequential' | 'reply';

type Props = {
  mode: CampaignFlowMode;
  onChange: (mode: CampaignFlowMode) => void;
};

export const CampaignFlowModePicker: React.FC<Props> = ({ mode, onChange }) => (
  <div className="cw-msg-section">
    <p className="cw-msg-section-title">Como as mensagens serão enviadas</p>
    <div className="cw-flow-segment cw-flow-segment-3" role="group" aria-label="Modo das etapas">
      <button
        type="button"
        className="cw-flow-segment-btn"
        data-active={mode === 'single' ? 'true' : 'false'}
        onClick={() => onChange('single')}
      >
        <span className="cw-flow-segment-icon" aria-hidden>
          <MessageSquare className="w-4 h-4" />
        </span>
        <span>
          <span className="block text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Disparo único
          </span>
          <span className="block text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
            Uma mensagem por contato — sem etapas nem respostas automáticas.
          </span>
        </span>
      </button>
      <button
        type="button"
        className="cw-flow-segment-btn"
        data-active={mode === 'sequential' ? 'true' : 'false'}
        onClick={() => onChange('sequential')}
      >
        <span className="cw-flow-segment-icon" aria-hidden>
          <ListOrdered className="w-4 h-4" />
        </span>
        <span>
          <span className="block text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Sequência automática
          </span>
          <span className="block text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
            Várias etapas em fila, sem esperar resposta.
          </span>
        </span>
      </button>
      <button
        type="button"
        className="cw-flow-segment-btn"
        data-active={mode === 'reply' ? 'true' : 'false'}
        onClick={() => onChange('reply')}
      >
        <span className="cw-flow-segment-icon" aria-hidden>
          <GitBranch className="w-4 h-4" />
        </span>
        <span>
          <span className="block text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Fluxo por respostas
          </span>
          <span className="block text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
            Próxima mensagem só depois que o contato responder.
          </span>
        </span>
      </button>
    </div>

    <details className="cw-flow-help">
      <summary>
        <span>Como funciona este modo?</span>
        <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
      </summary>
      <div className="cw-flow-help-body">
        {mode === 'single' ? (
          <p>
            Envia <strong>apenas uma mensagem</strong> para cada contato. Se o contato responder, o ZapMass{' '}
            <strong>não envia</strong> mensagem de follow-up automaticamente.
          </p>
        ) : mode === 'sequential' ? (
          <p>
            Cada contato recebe a etapa 1, depois a 2 e assim por diante, <strong>sem precisar responder</strong>. O
            intervalo anti-ban vale entre cada envio.
          </p>
        ) : (
          <p>
            A <strong>primeira</strong> mensagem sai na abertura. As seguintes só após a resposta do contato, conforme as
            regras que você definir abaixo (qualquer texto, menu 1/2, CRM, etc.).
          </p>
        )}
      </div>
    </details>
  </div>
);
