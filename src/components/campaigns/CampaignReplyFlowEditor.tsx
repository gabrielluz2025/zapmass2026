import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  GitBranch,
  Lightbulb,
  ListOrdered,
  MessageSquare,
  Plus,
  Smartphone,
  Sparkles,
  Trash2
} from 'lucide-react';
import { CampaignMessageComposer } from './CampaignMessageComposer';
import { CampaignMessageQuickStarters } from './CampaignMessageQuickStarters';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import type { CampaignAttachmentState } from './CampaignAttachmentBlock';
import { Button, Textarea } from '../ui';
import { applyCampaignMessagePreviewVars, insertCampaignTokenIntoTextarea } from '../../utils/campaignMessageVariables';

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
  campaignBrief?: string;
  previewDisplayName?: string;
};

const MENU_QUICK_TEMPLATES: Array<{ label: string; options: Array<{ tokens: string; reply: string }> }> = [
  {
    label: 'Sim / Não',
    options: [
      { tokens: '1, sim', reply: 'Ótimo! Seguem os detalhes que você pediu…' },
      { tokens: '2, não', reply: 'Sem problemas! Se mudar de ideia, é só responder aqui.' }
    ]
  },
  {
    label: '3 opções',
    options: [
      { tokens: '1', reply: 'Opção 1 — descreva aqui a resposta.' },
      { tokens: '2', reply: 'Opção 2 — descreva aqui a resposta.' },
      { tokens: '3', reply: 'Opção 3 — descreva aqui a resposta.' }
    ]
  }
];

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
  campaignBrief = '',
  previewDisplayName = 'Maria',
}) => {
  const [, setInvalidOpen] = useState(false); // kept for compat; menu mode always shows the field
  const first = stages[0];
  const second = stages[1];
  const isConditional = !first?.acceptAnyReply && first?.optionsMode === 'conditional';
  const isAnyReply = Boolean(first?.acceptAnyReply ?? true);
  const hasOpening = Boolean(first?.body?.trim());
  const menuOptions = first?.options || [];

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
    patchFirst({ options: [...menuOptions, newStageOption()] });
  };

  const removeOption = (optId: string) => {
    if (menuOptions.length <= 1) return;
    patchFirst({ options: menuOptions.filter((o) => o.id !== optId) });
  };

  const updateOption = (optId: string, patch: Partial<ReplyStageOption>) => {
    patchFirst({
      options: menuOptions.map((o) => (o.id === optId ? { ...o, ...patch } : o)),
    });
  };

  const applyMenuTemplate = (idx: number) => {
    const tpl = MENU_QUICK_TEMPLATES[idx];
    if (!tpl) return;
    patchFirst({
      options: tpl.options.map((o) => ({
        ...newStageOption(),
        tokensText: o.tokens,
        reply: o.reply
      }))
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
    setInvalidOpen(false);
  };

  const enableAnyReplyMode = () => {
    setStages((prev) => {
      const f = { ...prev[0], acceptAnyReply: true, optionsMode: 'linear' as const };
      const s = prev[1] || newMessageStage();
      return [f, s];
    });
  };

  const menuPreviewLines = useMemo(
    () =>
      menuOptions.map((opt, i) => {
        const trigger = (opt.tokensText || String(i + 1)).split(/[,;]/)[0]?.trim() || String(i + 1);
        const preview = opt.reply.trim() || '…';
        return { trigger, preview, num: i + 1 };
      }),
    [menuOptions]
  );

  const openingPreview = applyCampaignMessagePreviewVars(first?.body || '', { nome: previewDisplayName });
  const followUpPreview = applyCampaignMessagePreviewVars(second?.body || '', { nome: previewDisplayName });

  return (
    <div className="cw-reply-flow cw-reply-flow--simple">
      <CampaignMessageQuickStarters onPick={(body) => patchFirst({ body })} />

      <div className="cw-reply-tips">
        <Lightbulb className="w-4 h-4 shrink-0" aria-hidden />
        <p>
          <strong>Dica:</strong> no fluxo por respostas, só a abertura sai no disparo. O follow-up ou menu só dispara
          depois que o contato responder — evite textos genéricos como &quot;oi&quot; sozinho.
        </p>
      </div>

      <section className="cw-reply-panel">
        <header className="cw-reply-panel__head">
          <span className="cw-reply-panel__num cw-reply-panel__num--open">1</span>
          <div>
            <h4 className="cw-reply-panel__title">Mensagem de abertura</h4>
            <p className="cw-reply-panel__sub">Primeiro texto que o contato recebe quando a campanha iniciar.</p>
          </div>
        </header>
        <div className="cw-reply-panel__body cw-reply-panel__body--split">
          <div className="cw-reply-panel__editor">
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
              showGreetingPicker
              variablesDensity="compact"
              variablesCollapsible
              showAttachment
              attachment={attachment}
              attachmentInputRef={attachmentInputRef}
              onPickAttachment={onPickAttachment}
              onRemoveAttachment={onRemoveAttachment}
              launchMode={launchMode}
              minHeight={168}
              campaignBrief={campaignBrief}
            />
          </div>
          <aside className="cw-reply-mini-preview" aria-label="Prévia da abertura">
            <div className="cw-reply-mini-preview__head">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Como chega no WhatsApp</span>
            </div>
            <div className="cw-reply-mini-preview__phone">
              {openingPreview.trim() ? (
                <div className="cw-wa-bubble cw-wa-bubble--out">{openingPreview}</div>
              ) : (
                <p className="cw-reply-mini-preview__empty">Digite acima para ver a bolha</p>
              )}
            </div>
          </aside>
        </div>
      </section>

      {hasOpening ? (
        <>
          <div className="cw-reply-connector" aria-hidden>
            <div className="cw-reply-connector__line" />
            <span className="cw-reply-connector__label">contato responde</span>
            <div className="cw-reply-connector__line" />
          </div>

          <section className="cw-reply-panel cw-reply-panel--step2">
            <header className="cw-reply-panel__head">
              <span className="cw-reply-panel__num cw-reply-panel__num--reply">2</span>
              <div className="flex-1 min-w-0">
                <h4 className="cw-reply-panel__title">Resposta automática</h4>
                <p className="cw-reply-panel__sub">
                  {isAnyReply
                    ? 'Envia o mesmo texto para qualquer mensagem que o contato mandar.'
                    : 'Envia um texto diferente conforme o número ou palavra que o contato digitar.'}
                </p>
              </div>
            </header>

            <div className="cw-reply-panel__body space-y-4">
              <div className="cw-reply-mode-grid" role="group" aria-label="Tipo de resposta automática">
                <button
                  type="button"
                  className="cw-reply-mode-card"
                  data-active={isAnyReply ? 'true' : 'false'}
                  onClick={enableAnyReplyMode}
                >
                  <span className="cw-reply-mode-card__icon cw-reply-mode-card__icon--any">
                    <MessageSquare className="w-4 h-4" />
                  </span>
                  <span className="cw-reply-mode-card__title">Qualquer resposta</span>
                  <span className="cw-reply-mode-card__desc">Um único texto de follow-up</span>
                </button>
                <button
                  type="button"
                  className="cw-reply-mode-card"
                  data-active={isConditional ? 'true' : 'false'}
                  onClick={enableMenuMode}
                >
                  <span className="cw-reply-mode-card__icon cw-reply-mode-card__icon--menu">
                    <ListOrdered className="w-4 h-4" />
                  </span>
                  <span className="cw-reply-mode-card__title">Por palavra ou número</span>
                  <span className="cw-reply-mode-card__desc">Gatilhos (1, sim, oi…) → resposta com variáveis</span>
                </button>
              </div>

              {isAnyReply ? (
                <div className="cw-reply-followup-wrap">
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
                  minHeight={140}
                  campaignBrief={campaignBrief}
                  />
                  {followUpPreview.trim() ? (
                    <div className="cw-reply-followup-preview">
                      <span className="cw-reply-followup-preview__label">Prévia do follow-up</span>
                      <div className="cw-wa-bubble cw-wa-bubble--out cw-wa-bubble--sm">{followUpPreview}</div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="cw-reply-menu-builder">
                  <div className="cw-reply-menu-builder__toolbar">
                    <div className="flex items-center gap-2 min-w-0">
                      <GitBranch className="w-4 h-4 shrink-0 text-indigo-400" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
                          Rotas do menu
                        </p>
                        <p className="text-[10.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
                          O contato digita o gatilho; você define a mensagem com {'{nome}'}, {'{cidade}'}, etc.
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      leftIcon={<Plus className="w-3.5 h-3.5" />}
                      onClick={addOption}
                    >
                      Adicionar
                    </Button>
                  </div>

                  <div className="cw-reply-menu-templates">
                    <Sparkles className="w-3 h-3 shrink-0 text-amber-500" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      Modelos rápidos
                    </span>
                    {MENU_QUICK_TEMPLATES.map((tpl, i) => (
                      <button key={tpl.label} type="button" className="cw-reply-menu-template-btn" onClick={() => applyMenuTemplate(i)}>
                        {tpl.label}
                      </button>
                    ))}
                  </div>

                  <div className="cw-reply-menu-list">
                    {menuOptions.map((opt, oIdx) => (
                      <article key={opt.id} className="cw-reply-menu-item">
                        <div className="cw-reply-menu-item__badge" aria-hidden>
                          {oIdx + 1}
                        </div>
                        <div className="cw-reply-menu-item__fields">
                          <div className="cw-reply-menu-item__row">
                            <label className="cw-reply-menu-field">
                              <span className="cw-reply-menu-field__label">Gatilhos (vírgula)</span>
                              <input
                                type="text"
                                className="cw-reply-menu-field__input cw-reply-menu-field__input--trigger"
                                placeholder={`Ex.: ${oIdx + 1}, sim, oi`}
                                value={opt.tokensText}
                                onChange={(e) => updateOption(opt.id, { tokensText: e.target.value })}
                              />
                            </label>
                            <label className="cw-reply-menu-field cw-reply-menu-field--grow">
                              <span className="cw-reply-menu-field__label">Mensagem enviada</span>
                              <textarea
                                className="cw-reply-menu-field__textarea"
                                placeholder="Texto com variáveis — ex.: Ótimo {nome}! Seguem os detalhes…"
                                value={opt.reply}
                                rows={4}
                                onChange={(e) => updateOption(opt.id, { reply: e.target.value })}
                              />
                            </label>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="cw-reply-menu-item__remove"
                          onClick={() => removeOption(opt.id)}
                          disabled={menuOptions.length <= 1}
                          aria-label={`Remover opção ${oIdx + 1}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </article>
                    ))}
                  </div>

                  <div className="cw-reply-menu-preview">
                    <p className="cw-reply-menu-preview__title">Prévia do fluxo</p>
                    <div className="cw-reply-menu-preview__wa">
                      {openingPreview.trim() ? (
                        <div className="cw-wa-bubble cw-wa-bubble--out cw-wa-bubble--sm">{openingPreview}</div>
                      ) : null}
                      {isConditional && menuOptions.length > 0 && (
                        <div className="cw-reply-menu-chips" role="list" aria-label="Opções do menu">
                          {menuOptions.map((opt, i) => {
                            const trigger =
                              (opt.tokensText || String(i + 1)).split(/[,;]/)[0]?.trim() || String(i + 1);
                            return (
                              <span key={opt.id} className="cw-reply-menu-chip" role="listitem">
                                {trigger}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div className="cw-wa-bubble cw-wa-bubble--in">1</div>
                      {menuPreviewLines.map((line) =>
                        line.preview !== '…' ? (
                          <div key={line.num} className="cw-reply-menu-preview__step">
                            <span className="cw-reply-menu-preview__trigger">&quot;{line.trigger}&quot;</span>
                            <span className="cw-reply-menu-preview__arrow" aria-hidden>→</span>
                            <span className="cw-reply-menu-preview__msg">{line.preview}</span>
                          </div>
                        ) : null
                      )}
                    </div>
                  </div>

                  <div className="cw-reply-invalid cw-reply-invalid--always-open">
                    <div className="cw-reply-invalid__header">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-warn, #f59e0b)' }} aria-hidden />
                      <span>Resposta não reconhecida</span>
                      <span className="cw-reply-invalid__required">obrigatório</span>
                    </div>
                    <div className="cw-reply-invalid__body">
                      <p className="text-[10.5px] mb-2 leading-snug" style={{ color: 'var(--text-3)' }}>
                        Enviada quando o contato digitar algo fora das opções configuradas acima.
                      </p>
                      <CampaignMessageVariableChips
                        onInsert={onInsertInvalidVariable}
                        density="compact"
                        collapsible
                      />
                      <Textarea
                        ref={invalidReplyRef}
                        placeholder="Não entendi. Digite 1 para sim ou 2 para não."
                        value={first?.invalidReplyBody || ''}
                        onChange={(e) => patchFirst({ invalidReplyBody: e.target.value })}
                        className="mt-2"
                        style={{ minHeight: '72px', borderColor: !first?.invalidReplyBody?.trim() ? 'var(--accent-warn, #f59e0b)' : undefined }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <p className="cw-reply-empty-hint">
          Escreva a mensagem de abertura para configurar a resposta automática.
        </p>
      )}
    </div>
  );
};
