import React from 'react';
import { MessageCircle } from 'lucide-react';
import { Textarea } from '../ui';
import { CampaignAttachmentBlock, type CampaignAttachmentState } from './CampaignAttachmentBlock';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import { CampaignMessageQuickStarters } from './CampaignMessageQuickStarters';

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
}) => {
  const charCount = body.length;
  const hasBody = body.trim().length > 0;

  const spintaxInfo = React.useMemo(() => parseSpintax(body), [body]);

  return (
    <div className="cw-single-editor space-y-4">
      <CampaignMessageQuickStarters onPick={onBodyChange} />

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between gap-3"
          style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-0)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#25d366,#128c7e)', color: '#fff' }}
            >
              <MessageCircle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                Sua mensagem
              </p>
              <p className="text-[10.5px] truncate" style={{ color: 'var(--text-3)' }}>
                {hasBody ? 'Prévia atualiza ao vivo à direita' : 'Escreva ou escolha um modelo acima'}
              </p>
            </div>
          </div>
          <span
            className="text-[10px] font-semibold tabular-nums shrink-0 px-2 py-1 rounded-lg"
            style={{
              background: charCount > 900 ? 'rgba(245,158,11,0.12)' : 'var(--surface-2)',
              color: charCount > 900 ? '#d97706' : 'var(--text-3)',
            }}
          >
            {charCount} caracteres
          </span>
        </div>

        <div className="p-4 space-y-3">
          <Textarea
            ref={msgRef}
            rows={7}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            placeholder={'Olá {nome}, tudo bem?\n\nEscreva como se fosse uma conversa no WhatsApp — use {nome}, {cidade} e outras variáveis para personalizar.'}
            className="text-[13.5px] leading-relaxed cw-single-editor__textarea"
          />
          <CampaignMessageVariableChips onInsert={onInsertVariable} collapsible />
          
          {spintaxInfo.variations > 1 && (
            <div className="p-3.5 rounded-xl border border-emerald-500/15 bg-emerald-500/5 flex flex-col gap-1.5 animate-in fade-in duration-200 mt-2">
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
        </div>
      </div>

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
};
