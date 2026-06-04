import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
  launchMode,
  newStageOption,
  newMessageStage,
  onInsertInvalidVariable
}) => {
  const first = stages[0];
  const second = stages[1];
  const isConditional = !first?.acceptAnyReply && first?.optionsMode === 'conditional';
  const isAnyReply = Boolean(first?.acceptAnyReply);

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
    const opts = first?.options || [];
    patchFirst({ options: [...opts, newStageOption()] });
  };

  const removeOption = (optId: string) => {
    patchFirst({ options: (first?.options || []).filter((o) => o.id !== optId) });
  };

  const updateOption = (optId: string, patch: Partial<ReplyStageOption>) => {
    patchFirst({
      options: (first?.options || []).map((o) => (o.id === optId ? { ...o, ...patch } : o))
    });
  };

  return (
    <div className="cw-reply-flow">
      <div className="cw-reply-card">
        <div className="cw-reply-card-head">
          <span className="cw-reply-step-num cw-reply-step-num--1">1</span>
          <div>
            <h4 className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
              Mensagem de abertura
            </h4>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Enviada assim que a campanha começar para cada contato.
            </p>
          </div>
        </div>
        <div className="cw-reply-card-body">
          <CampaignMessageComposer
            label="Texto da abertura"
            placeholder="Olá {nome}! Responda 1 para Sim ou 2 para Não..."
            body={first?.body || ''}
            onBodyChange={(body) => patchFirst({ body })}
            textareaRef={msgRef}
            onInsertVariable={(variable) =>
              insertCampaignTokenIntoTextarea(msgRef.current, first?.body || '', variable, (next) =>
                patchFirst({ body: next })
              )
            }
            onApplyTemplate={(body) => patchFirst({ body })}
            showAttachment
            attachment={attachment}
            attachmentInputRef={attachmentInputRef}
            onPickAttachment={onPickAttachment}
            onRemoveAttachment={onRemoveAttachment}
            launchMode={launchMode}
          />
        </div>
      </div>

      <div className="cw-reply-connector" aria-hidden>
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
          <path d="M10 0v16M10 16l-4 4M10 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="cw-reply-card">
        <div className="cw-reply-card-head">
          <span className="cw-reply-step-num cw-reply-step-num--2">2</span>
          <div>
            <h4 className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
              Quando o contato responder
            </h4>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Escolha o tipo de regra antes de definir a próxima mensagem.
            </p>
          </div>
        </div>
        <div className="cw-reply-card-body space-y-3">
          <div className="cw-reply-choice-grid">
            <button
              type="button"
              className="cw-reply-choice"
              data-active={isAnyReply ? 'true' : 'false'}
              onClick={() => {
                setStages((prev) => {
                  const f = { ...prev[0], acceptAnyReply: true, optionsMode: 'linear' as const };
                  const s = prev[1] || newMessageStage();
                  return [f, s];
                });
              }}
            >
              <span className="text-[12.5px] font-bold" style={{ color: 'var(--text-1)' }}>
                Qualquer resposta
              </span>
              <span className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                Um texto de resposta dispara a próxima mensagem automática.
              </span>
            </button>
            <button
              type="button"
              className="cw-reply-choice"
              data-active={isConditional ? 'true' : 'false'}
              onClick={() => {
                setStages((prev) => {
                  const f = {
                    ...prev[0],
                    acceptAnyReply: false,
                    optionsMode: 'conditional' as const,
                    options:
                      prev[0]?.options && prev[0].options.length > 0 ? prev[0].options : [newStageOption()]
                  };
                  return [f];
                });
              }}
            >
              <span className="text-[12.5px] font-bold" style={{ color: 'var(--text-1)' }}>
                Menu de opções
              </span>
              <span className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                Ex.: digitou 1 → mensagem A; digitou 2 → mensagem B.
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="cw-reply-connector" aria-hidden>
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
          <path d="M10 0v16M10 16l-4 4M10 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="cw-reply-card">
        <div className="cw-reply-card-head">
          <span className="cw-reply-step-num cw-reply-step-num--3">3</span>
          <div>
            <h4 className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
              {isConditional ? 'Opções e respostas' : 'Próxima mensagem automática'}
            </h4>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {isConditional
                ? 'Configure cada opção válida e a mensagem de erro.'
                : 'Texto enviado logo após a resposta do contato.'}
            </p>
          </div>
        </div>
        <div className="cw-reply-card-body">
          {isAnyReply ? (
            <div className="space-y-3">
              <CampaignMessageComposer
                label="Texto da resposta automática"
                placeholder="Obrigado por responder! Aqui estão as informações..."
                body={second?.body || ''}
                onBodyChange={setSecondBody}
                onInsertVariable={(variable) =>
                  insertCampaignTokenIntoTextarea(null, second?.body || '', variable, setSecondBody)
                }
                variablesDensity="compact"
                showIdeas={false}
                minHeight={110}
              />
              <div className="pt-2 border-t border-[var(--border-subtle)]">
                <label className="cw-msg-section-title block mb-1">Efeito no CRM</label>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-[12px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface-0)',
                    color: 'var(--text-1)'
                  }}
                  value={first?.marketingEffect || 'none'}
                  onChange={(e) =>
                    patchFirst({ marketingEffect: e.target.value as ReplyMessageStage['marketingEffect'] })
                  }
                >
                  <option value="none">Nenhum efeito extra</option>
                  <option value="opt_in">Autorizou marketing (lead quente)</option>
                  <option value="opt_out">Lista negra — não autorizar disparos</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  {(first?.options || []).length} opção(ões)
                </p>
                <Button type="button" size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addOption}>
                  Adicionar opção
                </Button>
              </div>

              {(first?.options || []).length === 0 ? (
                <p className="text-center py-6 text-[12px] rounded-lg border border-dashed" style={{ color: 'var(--text-3)', borderColor: 'var(--border-subtle)' }}>
                  Adicione pelo menos uma opção (ex.: resposta &quot;1&quot;).
                </p>
              ) : (
                (first?.options || []).map((opt, oIdx) => (
                  <div
                    key={opt.id}
                    className="rounded-lg p-3 space-y-2.5"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-600)' }}>
                        Opção {oIdx + 1}
                      </span>
                      <button
                        type="button"
                        className="p-1 rounded text-red-500 hover:bg-red-500/10"
                        onClick={() => removeOption(opt.id)}
                        aria-label="Remover opção"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--text-3)' }}>
                          Se responder com
                        </label>
                        <Input
                          placeholder="1, sim"
                          value={opt.tokensText}
                          onChange={(e) => updateOption(opt.id, { tokensText: e.target.value })}
                          className="h-9"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--text-3)' }}>
                          Efeito CRM
                        </label>
                        <select
                          className="w-full rounded-lg border px-2 py-2 text-xs h-9"
                          style={{
                            borderColor: 'var(--border)',
                            background: 'var(--surface-0)',
                            color: 'var(--text-1)'
                          }}
                          value={opt.marketingEffect}
                          onChange={(e) =>
                            updateOption(opt.id, {
                              marketingEffect: e.target.value as ReplyStageOption['marketingEffect']
                            })
                          }
                        >
                          <option value="none">Nenhum</option>
                          <option value="opt_in">Lead quente</option>
                          <option value="opt_out">Lista negra</option>
                        </select>
                      </div>
                    </div>
                    <Textarea
                      placeholder="Mensagem enviada para esta opção..."
                      value={opt.reply}
                      onChange={(e) => updateOption(opt.id, { reply: e.target.value })}
                      style={{ minHeight: '64px' }}
                    />
                  </div>
                ))
              )}

              <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  Resposta inválida
                </p>
                <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  Se não bater com nenhuma opção acima.
                </p>
                <CampaignMessageVariableChips onInsert={onInsertInvalidVariable} density="compact" />
                <Textarea
                  ref={invalidReplyRef}
                  placeholder="Opção inválida. Digite 1 para sim ou 2 para não."
                  value={first?.invalidReplyBody || ''}
                  onChange={(e) => patchFirst({ invalidReplyBody: e.target.value })}
                  style={{ minHeight: '72px' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
