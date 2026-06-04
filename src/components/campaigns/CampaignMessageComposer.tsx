import React from 'react';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import { SegmentCampaignIdeas } from '../segment/SegmentCampaignIdeas';
import { Textarea } from '../ui';
import type { CampaignAttachmentState } from './CampaignAttachmentBlock';
import { CampaignAttachmentBlock } from './CampaignAttachmentBlock';

type Props = {
  label: string;
  placeholder: string;
  body: string;
  onBodyChange: (value: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  textareaKey?: string;
  onInsertVariable: (token: string) => void;
  variablesDensity?: 'full' | 'compact';
  showIdeas?: boolean;
  onApplyTemplate?: (body: string) => void;
  showAttachment?: boolean;
  attachment?: CampaignAttachmentState | null;
  attachmentInputRef?: React.RefObject<HTMLInputElement | null>;
  onPickAttachment?: (file: File | null) => void;
  onRemoveAttachment?: () => void;
  launchMode?: 'now' | 'schedule';
  minHeight?: number;
};

export const CampaignMessageComposer: React.FC<Props> = ({
  label,
  placeholder,
  body,
  onBodyChange,
  textareaRef,
  textareaKey,
  onInsertVariable,
  variablesDensity = 'full',
  showIdeas = true,
  onApplyTemplate,
  showAttachment,
  attachment,
  attachmentInputRef,
  onPickAttachment,
  onRemoveAttachment,
  launchMode,
  minHeight = 140
}) => (
  <div className="cw-composer">
    <div className="cw-composer-head">
      <span className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
        {label}
      </span>
      <span className="cw-char-badge">{body.length} caracteres</span>
    </div>
    <div className="cw-composer-body space-y-2">
      <CampaignMessageVariableChips
        onInsert={onInsertVariable}
        density={variablesDensity}
        collapsible={variablesDensity === 'full'}
      />
      {showIdeas && onApplyTemplate && <SegmentCampaignIdeas onApplyTemplate={onApplyTemplate} />}
      <Textarea
        key={textareaKey}
        ref={textareaRef}
        placeholder={placeholder}
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        style={{ minHeight: `${minHeight}px` }}
      />
      {showAttachment &&
        attachmentInputRef &&
        onPickAttachment &&
        onRemoveAttachment && (
          <CampaignAttachmentBlock
            attachment={attachment ?? null}
            inputRef={attachmentInputRef}
            onPick={onPickAttachment}
            onRemove={onRemoveAttachment}
            launchMode={launchMode}
            compact
          />
        )}
    </div>
  </div>
);
