import React, { useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { CampaignMessageComposer } from './CampaignMessageComposer';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import type { CampaignAttachmentState } from './CampaignAttachmentBlock';
import { Button, Input, Textarea } from '../ui';
import { insertCampaignTokenIntoTextarea } from '../../utils/campaignMessageVariables';

export type ReplyStageOption = {
  id: string;
  tokensText: string;
  reply: string;
  marketingEffect: 'none' | 'opt_in' | 'opt_out';
};

export type ReplyMessageStage = {
  id: string;
  body: string;
  acceptAnyReply: boolean;
  validTokensText: string;
  invalidReplyBody: string;
  marketingEffect: 'none' | 'opt_in' | 'opt_out';
  optionsMode?: 'linear' | 'conditional';
  options?: ReplyStageOption[];
};

type Props = {
  stages: ReplyMessageStage[];
  setStages: React.Dispatch<React.SetStateAction<ReplyMessageStage[]>>;
  msgRef: React.RefObject<HTMLTextAreaElement | null>;
  invalidReplyRef: React.RefObject<HTMLTextAreaElement | null>;
  attachment: CampaignAttachmentState | null;
  attachmentInputRef: React.RefObject<HTMLInputElement | null>;
  onPickAttachment: (file: File | null) => void;
  onRemoveAttachment: () => void;
  followUpAttachment?: CampaignAttachmentState | null;
  followUpAttachmentInputRef?: React.RefObject<HTMLInputElement | null>;
  onPickFollowUpAttachment?: (file: File | null) => void;
  onRemoveFollowUpAttachment?: () => void;
  launchMode?: 'now' | 'schedule';
  newStageOption: () => ReplyStageOption;
  newMessageStage: () => ReplyMessageStage;
  onInsertInvalidVariable: (token: string) => void;
};

export const CampaignReplyFlowEditor: React.FC<Props> = ({
  stages,
  setStages,
  msgRef,
  invalidReplyRef,
  attachment,
  attachmentInputRef,
  onPickAttachment,
  onRemoveAttachment,
  followUpAttachment,
  followUpAttachmentInputRef,
  onPickFollowUpAttachment,
  onRemoveFollowUpAttachment,
  launchMode,
  newStageOption,
  newMessageStage,
  onInsertInvalidVariable,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const first = stages[0];
  const second = stages[1];
  const isConditional = !first?.acceptAnyReply && first?.optionsMode === 'conditional';
  const isAnyReply = Boolean(first?.acceptAnyReply ?? true);
  const hasOpening = Boolean(first?.body?.trim());

  const patchFirst = (patch: Partial<ReplyMessageStage>) => {
    setStages((prev) => prev.map((s, i) => (i === 0 ? { ...s, ...patch } : s)));
  };

  const setSecondBody = (body: string) => {
    setStages((prev) => {
      const copy = [...prev];
      if (!copy[1]) copy[1] = newMessageStage();
      copy[1] = { ...copy[1], body };
      return copy;
    });
  };

  const addOption = () => {
    patchFirst({ options: [...(first?.options || []), newStageOption()] });
  };

  const removeOption = (optId: string) => {
    patchFirst({ options: (first?.options || []).filter((o) => o.id !== optId) });
  };

  const updateOption = (optId: string, patch: Partial<ReplyStageOption>) => {
    patchFirst({
      options: (first?.options || []).map((o) => (o.id === optId ? { ...o, ...patch } : o)),
    });
  };

  const enableMenuMode = () => {
    setStages((prev) => {
      const f = {
        ...prev[0],
        acceptAnyReply: false,
        optionsMode: 'conditional' as const,
        options: prev[0]?.options?.length ? prev[0].options : [newStageOption()],
      };
      return [f];
    });
    setShowAdvanced(true);
  };

  const enableAnyReplyMode = () => {
    setStages((prev) => {
      const f = { ...prev[0], acceptAnyReply: true, optionsMode: 'linear' as const };
      const s = prev[1] || newMessageStage();
      return [f, s];
    });
  };

  return (
    <div className="cw-reply-flow cw-reply-flow--simple">
      {/* Etapa 1 — Abertura */}
      <section className="cw-reply-panel">
        <header className="cw-reply-panel__head">
          <span className="cw-reply-panel__num" style={{ background: '#10b981' }}>1</span>
          <div>
            <h4 className="cw-reply-panel__title">Mensagem de abertura</h4>
            <p className="cw-reply-panel__sub">Primeiro texto que o contato recebe quando a campanha iniciar.</p>
          </div>
        </header>
        <CampaignMessageComposer
          label="Texto da abertura"
          placeholder="Olá {nome}! Tudo bem? Responda esta mensagem que te envio mais detalhes."
          body={first?.body || ''}
          onBodyChange={(body) => patchFirst({ body })}
          textareaRef={msgRef}
          onInsertVariable={(variable) =>
            insertCampaignTokenIntoTextarea(msgRef.current, first?.body || '', variable, (next) =>
              patchFirst({ body: next })
            )
          }
          showIdeas={false}
          showGreetingPicker={false}
          variablesDensity="compact"
          variablesCollapsible
          showAttachment
          attachment={attachment}
          attachmentInputRef={attachmentInputRef}
          onPickAttachment={onPickAttachment}
          onRemoveAttachment={onRemoveAttachment}
          launchMode={launchMode}
          minHeight={120}
        />
      </section>

      {hasOpening && (
        <>
          <div className="cw-reply-connector" aria-hidden>
            <svg width="20" height="28" viewBox="0 0 20 28" fill="none">
              <path d="M10 0v20M10 20l-4 4M10 20l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              contato responde
            </span>
          </div>

          {/* Etapa 2 — Resposta automática */}
          <section className="cw-reply-panel">
            <header className="cw-reply-panel__head">
              <span className="cw-reply-panel__num" style={{ background: '#6366f1' }}>2</span>
              <div className="flex-1 min-w-0">
                <h4 className="cw-reply-panel__title">Resposta automática</h4>
                <p className="cw-reply-panel__sub">O que enviar logo depois que o contato mandar qualquer mensagem.</p>
              </div>
            </header>

            <div className="cw-reply-mode-pills">
              <button
                type="button"
                className="cw-reply-mode-pill"
                data-active={isAnyReply ? 'true' : 'false'}
                onClick={enableAnyReplyMode}
              >
                Qualquer resposta
              </button>
              <button
                type="button"
                className="cw-reply-mode-pill"
                data-active={isConditional ? 'true' : 'false'}
                onClick={enableMenuMode}
              >
                Menu 1 / 2 / 3
              </button>
            </div>

            {isAnyReply ? (
              <div className="space-y-3 mt-3">
                <CampaignMessageComposer
                  label="Texto após a resposta"
                  placeholder="{horario} {nome}! Obrigado pelo retorno. Seguem as informações..."
                  body={second?.body || ''}
                  onBodyChange={setSecondBody}
                  onInsertVariable={(variable) =>
                    insertCampaignTokenIntoTextarea(null, second?.body || '', variable, setSecondBody)
                  }
                  variablesDensity="compact"
                  variablesCollapsible
                  showIdeas={false}
                  showGreetingPicker={false}
                  showAttachment={Boolean(
                    followUpAttachmentInputRef && onPickFollowUpAttachment && onRemoveFollowUpAttachment
                  )}
                  attachment={followUpAttachment ?? null}
                  attachmentInputRef={followUpAttachmentInputRef}
                  onPickAttachment={onPickFollowUpAttachment}
                  onRemoveAttachment={onRemoveFollowUpAttachment}
                  launchMode={launchMode}
                  minHeight={100}
                />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                    Opções do menu
                  </p>
                  <Button type="button" size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addOption}>
                    Opção
                  </Button>
                </div>
                {(first?.options || []).map((opt, oIdx) => (
                  <div key={opt.id} className="cw-reply-option-row">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-600)' }}>
                        Se responder {oIdx + 1}
                      </span>
                      <button type="button" className="p-1 rounded text-red-500 hover:bg-red-500/10" onClick={() => removeOption(opt.id)} aria-label="Remover">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2">
                      <Input
                        placeholder="1, sim"
                        value={opt.tokensText}
                        onChange={(e) => updateOption(opt.id, { tokensText: e.target.value })}
                        className="h-9"
                      />
                      <Textarea
                        placeholder="Mensagem para esta opção..."
                        value={opt.reply}
                        onChange={(e) => updateOption(opt.id, { reply: e.target.value })}
                        style={{ minHeight: '64px' }}
                      />
                    </div>
                  </div>
                ))}
                <details className="cw-reply-advanced" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
                  <summary className="cw-reply-advanced__summary">
                    <span>Resposta quando a opção for inválida</span>
                    <ChevronDown className="w-4 h-4" />
                  </summary>
                  <div className="pt-2 space-y-2">
                    <CampaignMessageVariableChips onInsert={onInsertInvalidVariable} density="compact" collapsible />
                    <Textarea
                      ref={invalidReplyRef}
                      placeholder="Não entendi. Digite 1 para sim ou 2 para não."
                      value={first?.invalidReplyBody || ''}
                      onChange={(e) => patchFirst({ invalidReplyBody: e.target.value })}
                      style={{ minHeight: '64px' }}
                    />
                  </div>
                </details>
              </div>
            )}
          </section>
        </>
      )}

      {!hasOpening && (
        <p className="text-center text-[12px] py-4 rounded-xl border border-dashed" style={{ color: 'var(--text-3)', borderColor: 'var(--border-subtle)' }}>
          Escreva a mensagem de abertura para configurar a resposta automática.
        </p>
      )}
    </div>
  );
};
