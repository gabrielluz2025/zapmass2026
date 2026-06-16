import React from 'react';
import { Textarea } from '../ui';
import { CampaignAttachmentBlock, type CampaignAttachmentState } from './CampaignAttachmentBlock';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';

type Props = {
  body: string;
  onBodyChange: (body: string) => void;
  onInsertVariable: (variable: string) => void;
  msgRef: React.RefObject<HTMLTextAreaElement | null>;
  attachment: CampaignAttachmentState | null;
  attachmentInputRef: React.RefObject<HTMLInputElement | null>;
  onPickAttachment: (file?: File | null) => void;
  onRemoveAttachment: () => void;
  launchMode?: 'now' | 'schedule';
};

/** Editor simplificado — uma mensagem, sem etapas nem fluxo de resposta. */
export const CampaignSingleMessageEditor: React.FC<Props> = ({
  body,
  onBodyChange,
  onInsertVariable,
  msgRef,
  attachment,
  attachmentInputRef,
  onPickAttachment,
  onRemoveAttachment,
  launchMode,
}) => (
  <div
    className="rounded-xl p-4 space-y-3"
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <div>
      <p className="text-[13px] font-bold mb-1" style={{ color: 'var(--text-1)' }}>
        Mensagem única
      </p>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
        Cada contato recebe só este texto. Respostas do contato não disparam novas mensagens.
      </p>
      <Textarea
        ref={msgRef}
        rows={6}
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        placeholder="Olá {{nome}}, tudo bem?"
        className="text-[13px]"
      />
    </div>
    <CampaignMessageVariableChips onInsert={onInsertVariable} />
    <CampaignAttachmentBlock
      attachment={attachment}
      inputRef={attachmentInputRef}
      onPick={onPickAttachment}
      onRemove={onRemoveAttachment}
      launchMode={launchMode}
      compact
    />
  </div>
);
