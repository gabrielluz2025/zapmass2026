import React, { useState, useMemo } from 'react';
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

function parseSpintax(text: string): { variations: number; sample: string } {
  if (!text) return { variations: 1, sample: '' };
  
  // Encontra padrões como {Oi|Olá|E aí}
  const regex = /\{([^{}]+)\}/g;
  let match;
  let variations = 1;
  let sampleText = text;
  
  while ((match = regex.exec(text)) !== null) {
    const options = match[1].split('|');
    variations *= options.length;
    // Escolhe uma opção para simulação
    const chosen = options[Math.floor(Math.random() * options.length)] || options[0] || '';
    sampleText = sampleText.replace(match[0], chosen);
  }
  
  return { variations, sample: sampleText };
}

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

  const spintaxInfo = useMemo(() => parseSpintax(body), [body]);

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

      {spintaxInfo.variations > 1 && (
        <div className="p-3.5 rounded-xl border border-emerald-500/15 bg-emerald-500/5 flex flex-col gap-1.5 animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30">🛡️ Assistente de Spintax</span>
            <span className="text-[11px] font-bold">Excelente para evitar banimentos!</span>
          </div>
          <p className="text-[11px] text-slate-300">
            Seu texto possui <strong>{spintaxInfo.variations}</strong> variações possíveis para envio.
          </p>
          <div className="text-[11px] p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 font-mono text-slate-300 whitespace-pre-wrap leading-tight">
            <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">Exemplo de variação gerada:</span>
            "{spintaxInfo.sample}"
          </div>
        </div>
      )}
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
