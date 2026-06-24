import React, { useState } from 'react';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import { CampaignGreetingPicker } from './CampaignGreetingPicker';
import { insertCampaignTokenIntoTextarea } from '../../utils/campaignMessageVariables';
import { SegmentCampaignIdeas } from '../segment/SegmentCampaignIdeas';
import { Textarea } from '../ui';
import type { CampaignAttachmentState } from './CampaignAttachmentBlock';
import { CampaignAttachmentBlock } from './CampaignAttachmentBlock';
import { AiSparkButton } from '../ai/AiSparkButton';
import { useAiStatus } from '../../hooks/useAiStatus';
import { useAppProfile } from '../../context/AppProfileContext';
import { aiSuggestCampaignMessage } from '../../services/aiApi';
import toast from 'react-hot-toast';

type Props = {
  label: string;
  placeholder: string;
  body: string;
  onBodyChange: (value: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  textareaKey?: string;
  onInsertVariable: (token: string) => void;
  variablesDensity?: 'full' | 'compact';
  variablesCollapsible?: boolean;
  showIdeas?: boolean;
  onApplyTemplate?: (body: string) => void;
  showAttachment?: boolean;
  attachment?: CampaignAttachmentState | null;
  attachmentInputRef?: React.RefObject<HTMLInputElement | null>;
  onPickAttachment?: (file: File | null) => void;
  onRemoveAttachment?: () => void;
  launchMode?: 'now' | 'schedule';
  minHeight?: number;
  showGreetingPicker?: boolean;
  campaignBrief?: string;
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
  variablesCollapsible,
  showIdeas = true,
  onApplyTemplate,
  showAttachment,
  attachment,
  attachmentInputRef,
  onPickAttachment,
  onRemoveAttachment,
  launchMode,
  minHeight = 140,
  showGreetingPicker = true,
  campaignBrief = '',
}) => {
  const { configured: aiConfigured } = useAiStatus();
  const { segment } = useAppProfile();
  const [aiLoading, setAiLoading] = useState(false);

  const suggestWithAi = async () => {
    if (!aiConfigured || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await aiSuggestCampaignMessage(campaignBrief, body, segment);
      if (!res.ok) throw new Error(res.error || 'Falha na IA');
      if (res.message?.trim()) onBodyChange(res.message.trim());
      else throw new Error('A IA não retornou texto.');
      if (res.variants?.length) {
        toast(`Variações: ${res.variants.slice(0, 2).join(' | ')}`, { icon: '✨', duration: 6000 });
      } else {
        toast.success('Mensagem sugerida pela IA.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na IA.');
    } finally {
      setAiLoading(false);
    }
  };

  const insertGreeting = (text: string) => {
    if (textareaRef?.current) {
      insertCampaignTokenIntoTextarea(textareaRef.current, body, text, onBodyChange);
    } else {
      onBodyChange(body + (body.length > 0 && !body.endsWith(' ') ? ' ' : '') + text);
    }
  };

  return (
  <div className="cw-composer">
    <div className="cw-composer-head">
      <span className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        {aiConfigured && (
          <AiSparkButton
            label="IA sugerir"
            size="sm"
            variant="ghost"
            loading={aiLoading}
            disabled={aiLoading}
            onClick={() => void suggestWithAi()}
            title="Gemini escreve uma mensagem curta para WhatsApp com base no texto atual"
          />
        )}
        <span className="cw-char-badge">{body.length} caracteres</span>
      </div>
    </div>
    <div className="cw-composer-body space-y-2">
      {showGreetingPicker && <CampaignGreetingPicker onInsert={insertGreeting} />}
      <CampaignMessageVariableChips
        onInsert={onInsertVariable}
        density={variablesDensity}
        collapsible={variablesCollapsible ?? variablesDensity === 'full'}
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
};
