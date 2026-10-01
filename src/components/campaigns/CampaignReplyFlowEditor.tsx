import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Lightbulb,
  ListOrdered,
  MessageSquare,
  Image,
  Plus,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { CampaignMessageComposer } from './CampaignMessageComposer';
import { CampaignMessageQuickStarters } from './CampaignMessageQuickStarters';
import { CampaignMessageVariableChips } from './CampaignMessageVariableChips';
import type { CampaignAttachmentState } from './CampaignAttachmentBlock';
import { Button, Textarea } from '../ui';
import type { ReplyMatchMode } from '../../../shared/replyFlowMatch';
import { DEFAULT_GLOBAL_OPT_OUT_KEYWORDS, simulateReplyFlowMatch } from '../../../shared/replyFlowMatch';
import { applyCampaignMessagePreviewVars, insertCampaignTokenIntoTextarea } from '../../utils/campaignMessageVariables';
import { formatReplyFlowOptionTrigger } from '../../utils/campaignReplyFlowPreviewSequence';

export type ReplyStageOption = {
  id: string;
  tokensText: string;
  reply: string;
  marketingEffect: 'none' | 'opt_in' | 'opt_out';
  priority?: number;
  matchMode?: ReplyMatchMode;
  mediaStorageKey?: string;
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
  matchMode?: ReplyMatchMode;
  timeoutHours?: number;
  timeoutMessage?: string;
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
  globalOptOutEnabled?: boolean;
  globalOptOutKeywordsText?: string;
  onGlobalOptOutChange?: (patch: { enabled?: boolean; keywordsText?: string }) => void;
  politeGreetingEnabled?: boolean;
  onPoliteGreetingChange?: (enabled: boolean) => void;
  optionImagePreviewUrl?: (optionId: string) => string | null;
  onPickOptionImage?: (optionId: string, file: File) => void;
  onRemoveOptionImage?: (optionId: string) => void;
};

const MATCH_MODE_OPTIONS: Array<{ value: ReplyMatchMode; label: string }> = [
  { value: 'word', label: 'Palavra (padrão)' },
  { value: 'phrase', label: 'Frase exata' },
  { value: 'contains', label: 'Contém' },
  { value: 'numeric_exact', label: 'Número exato' },
];

const MENU_QUICK_TEMPLATES: Array<{ label: string; options: Array<{ tokens: string; reply: string }> }> = [
  {
    label: 'Sim / Não',
    options: [
      { tokens: '1, sim', reply: 'Ótimo! Seguem os detalhes que você pediu…' },
      { tokens: '2, não', reply: 'Sem problemas! Se mudar de ideia, é só responder aqui.' },
    ],
  },
  {
    label: '3 opções',
    options: [
      { tokens: '1', reply: 'Opção 1 — descreva aqui a resposta.' },
      { tokens: '2', reply: 'Opção 2 — descreva aqui a resposta.' },
      { tokens: '3', reply: 'Opção 3 — descreva aqui a resposta.' },
    ],
  },
];

// ─── Sub-componente: menu de gatilhos (reutilizável por etapa) ────────────────

type MenuBuilderProps = {
  stageIdx: number;
  stage: ReplyMessageStage;
  previewBody: string;
  newStageOption: () => ReplyStageOption;
  onInsertInvalidVariable: (token: string) => void;
  politeGreetingEnabled?: boolean;
  onPatch: (patch: Partial<ReplyMessageStage>) => void;
  optionImagePreviewUrl?: (optionId: string) => string | null;
  onPickOptionImage?: (optionId: string, file: File) => void;
  onRemoveOptionImage?: (optionId: string) => void;
};

function StageMenuBuilder({
  stageIdx,
  stage,
  previewBody,
  newStageOption,
  onInsertInvalidVariable,
  politeGreetingEnabled,
  onPatch,
  optionImagePreviewUrl,
  onPickOptionImage,
  onRemoveOptionImage,
}: MenuBuilderProps) {
  const [simulatorInput, setSimulatorInput] = useState('');
  const options = stage.options || [];

  const addOption = () => onPatch({ options: [...options, newStageOption()] });
  const removeOption = (id: string) => {
    if (options.length <= 1) return;
    onPatch({ options: options.filter((o) => o.id !== id) });
  };
  const updateOption = (id: string, patch: Partial<ReplyStageOption>) =>
    onPatch({ options: options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });

  const applyTemplate = (idx: number) => {
    const tpl = MENU_QUICK_TEMPLATES[idx];
    if (!tpl) return;
    onPatch({
      options: tpl.options.map((o) => ({ ...newStageOption(), tokensText: o.tokens, reply: o.reply })),
    });
  };

  const simulatorResult = useMemo(() => {
    if (!simulatorInput.trim()) return null;
    return simulateReplyFlowMatch({
      bodyText: simulatorInput,
      acceptAnyReply: false,
      options: options.map((o) => ({
        tokens: (o.tokensText || '').split(/[,;\n\r]+/).map((t) => t.trim()).filter(Boolean),
        reply: o.reply,
        priority: o.priority ?? 0,
        matchMode: o.matchMode,
      })),
      invalidReplyBody: stage.invalidReplyBody,
      politeGreetingEnabled,
    });
  }, [simulatorInput, options, stage.invalidReplyBody, politeGreetingEnabled]);

  return (
    <div className="cw-reply-menu-builder">
      <div className="cw-reply-menu-builder__toolbar">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 shrink-0 text-indigo-400" />
          <div className="min-w-0">
            <p className="text-[12px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
              Rotas do menu
            </p>
            <p className="text-[10.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
              Sinônimos separados por vírgula (ex.: 1, sim, oi). Modo e prioridade definem desempate.
            </p>
          </div>
        </div>
        <Button type="button" size="sm" variant="secondary" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={addOption}>
          Adicionar
        </Button>
      </div>

      {/* Templates rápidos */}
      <div className="cw-reply-menu-templates">
        <Sparkles className="w-3 h-3 shrink-0 text-amber-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          Modelos rápidos
        </span>
        {MENU_QUICK_TEMPLATES.map((tpl, i) => (
          <button key={tpl.label} type="button" className="cw-reply-menu-template-btn" onClick={() => applyTemplate(i)}>
            {tpl.label}
          </button>
        ))}
      </div>

      {/* Lista de opções */}
      <div className="cw-reply-menu-list">
        {options.map((opt, oIdx) => (
          <article key={opt.id} className="cw-reply-menu-item">
            <div className="cw-reply-menu-item__badge" aria-hidden>{oIdx + 1}</div>
            <div className="cw-reply-menu-item__fields">
              <div className="cw-reply-menu-item__row">
                <div className="flex flex-col gap-2.5 shrink-0 w-[170px]">
                  <label className="cw-reply-menu-field">
                    <span className="cw-reply-menu-field__label">Gatilhos / sinônimos</span>
                    <input
                      type="text"
                      className="cw-reply-menu-field__input cw-reply-menu-field__input--trigger"
                      placeholder={`Ex.: ${oIdx + 1}, sim, oi`}
                      value={opt.tokensText}
                      onChange={(e) => updateOption(opt.id, { tokensText: e.target.value })}
                    />
                  </label>
                  <label className="cw-reply-menu-field">
                    <span className="cw-reply-menu-field__label">Modo de match</span>
                    <select
                      className="cw-reply-menu-field__input py-1 px-2 text-xs"
                      value={opt.matchMode || 'word'}
                      onChange={(e) => updateOption(opt.id, { matchMode: e.target.value as ReplyMatchMode })}
                    >
                      {MATCH_MODE_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="cw-reply-menu-field">
                    <span className="cw-reply-menu-field__label">Prioridade</span>
                    <input
                      type="number" min={0} max={999}
                      className="cw-reply-menu-field__input"
                      value={opt.priority ?? 0}
                      onChange={(e) => updateOption(opt.id, { priority: Number(e.target.value) || 0 })}
                    />
                  </label>
                  <label className="cw-reply-menu-field">
                    <span className="cw-reply-menu-field__label">Ação ao escolher</span>
                    <select
                      className="cw-reply-menu-field__input py-1 px-2 text-xs text-slate-900 bg-white border border-slate-300 dark:border-slate-700 rounded-lg"
                      value={opt.marketingEffect || 'none'}
                      onChange={(e) => updateOption(opt.id, { marketingEffect: e.target.value as 'none' | 'opt_in' | 'opt_out' })}
                    >
                      <option value="none">🔵 Sem ação extra</option>
                      <option value="opt_in">🔥 Lead Quente + plano semanal</option>
                      <option value="opt_out">🚫 Lista Negra (para tudo)</option>
                    </select>
                  </label>
                </div>
                <label className="cw-reply-menu-field cw-reply-menu-field--grow">
                  <span className="cw-reply-menu-field__label">Mensagem enviada</span>
                  <textarea
                    className="cw-reply-menu-field__textarea"
                    placeholder="Texto com variáveis — ex.: Ótimo {nome}! Seguem os detalhes…"
                    value={opt.reply}
                    rows={4}
                    onChange={(e) => updateOption(opt.id, { reply: e.target.value })}
                  />
                  {onPickOptionImage ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        id={`opt-photo-${opt.id}`}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) onPickOptionImage(opt.id, file);
                        }}
                      />
                      <label
                        htmlFor={`opt-photo-${opt.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer"
                        style={{ borderColor: 'var(--border-1)', color: 'var(--text-2)' }}
                      >
                        <Image className="w-3.5 h-3.5" />
                        {optionImagePreviewUrl?.(opt.id) || opt.mediaStorageKey ? 'Trocar foto' : 'Foto junto com a mensagem'}
                      </label>
                      {(optionImagePreviewUrl?.(opt.id) || opt.mediaStorageKey) && onRemoveOptionImage ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold"
                          style={{ color: 'var(--accent-warn, #f59e0b)' }}
                          onClick={() => onRemoveOptionImage(opt.id)}
                        >
                          Remover foto
                        </button>
                      ) : null}
                      {optionImagePreviewUrl?.(opt.id) ? (
                        <img
                          src={optionImagePreviewUrl(opt.id) || ''}
                          alt=""
                          className="h-14 w-14 rounded-lg object-cover border"
                          style={{ borderColor: 'var(--border-1)' }}
                        />
                      ) : opt.mediaStorageKey ? (
                        <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                          Foto já salva — sai junto com este texto
                        </span>
                      ) : (
                        <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                          Opcional. A foto vai na mesma mensagem, com o texto como legenda.
                        </span>
                      )}
                    </div>
                  ) : null}
                </label>
              </div>
            </div>
            <button
              type="button"
              className="cw-reply-menu-item__remove"
              onClick={() => removeOption(opt.id)}
              disabled={options.length <= 1}
              aria-label={`Remover opção ${oIdx + 1}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </article>
        ))}
      </div>

      {/* Resposta inválida */}
      <div className="cw-reply-invalid cw-reply-invalid--always-open mt-3">
        <div className="cw-reply-invalid__header">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-warn, #f59e0b)' }} aria-hidden />
          <span>Resposta não reconhecida</span>
          <span className="cw-reply-invalid__required">obrigatório</span>
        </div>
        <div className="cw-reply-invalid__body">
          <p className="text-[10.5px] mb-2 leading-snug" style={{ color: 'var(--text-3)' }}>
            Enviada quando o contato digitar algo fora das opções configuradas acima.
          </p>
          <CampaignMessageVariableChips onInsert={onInsertInvalidVariable} density="compact" collapsible />
          <Textarea
            placeholder="Não entendi. Digite 1 para sim ou 2 para não."
            value={stage.invalidReplyBody || ''}
            onChange={(e) => onPatch({ invalidReplyBody: e.target.value })}
            className="mt-2"
            style={{
              minHeight: '72px',
              borderColor: !stage.invalidReplyBody?.trim() ? 'var(--accent-warn, #f59e0b)' : undefined,
            }}
          />
        </div>
      </div>

      {/* Simulador */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 mt-4">
        <p className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
          Testar resposta (simulador da etapa {stageIdx + 1})
        </p>
        <input
          type="text"
          className="cw-reply-menu-field__input w-full"
          placeholder='Ex.: OI 1, quero, "sim"'
          value={simulatorInput}
          onChange={(e) => setSimulatorInput(e.target.value)}
        />
        {simulatorResult && (
          <p
            className="text-[11px] leading-snug"
            style={{
              color:
                simulatorResult.kind === 'invalid' || simulatorResult.kind === 'empty'
                  ? 'var(--accent-warn, #f59e0b)'
                  : 'var(--brand-600)',
            }}
          >
            {simulatorResult.kind === 'option' &&
              `✅ Rota ${(simulatorResult.optionIndex ?? 0) + 1} — gatilho "${simulatorResult.matchedToken}" (${simulatorResult.matchMode || 'word'})`}
            {simulatorResult.kind === 'any' && '✅ Qualquer resposta → avança'}
            {simulatorResult.kind === 'gate' && '✅ Gate reconhecido'}
            {simulatorResult.kind === 'greeting' && `👋 Saudação educada: ${simulatorResult.message}`}
            {simulatorResult.kind === 'invalid' && `⚠️ Fallback: ${simulatorResult.message}`}
            {simulatorResult.kind === 'empty' && simulatorResult.message}
          </p>
        )}
      </div>

      {/* Prévia do fluxo desta etapa */}
      {previewBody.trim() ? (
        <div className="cw-reply-menu-preview mt-3">
          <p className="cw-reply-menu-preview__title">Prévia da etapa {stageIdx + 1}</p>
          <div className="cw-reply-menu-preview__wa flex flex-col gap-1">
            <div className="cw-wa-bubble cw-wa-bubble--out cw-wa-bubble--sm">{previewBody}</div>
            {options.map((o, i) => {
              const trigger = formatReplyFlowOptionTrigger({ tokensText: o.tokensText }, i);
              const replyPreview = o.reply.trim() ? applyCampaignMessagePreviewVars(o.reply.trim()) : '';
              if (!replyPreview.trim()) return null;
              return (
                <React.Fragment key={o.id}>
                  <div className="cw-wa-bubble cw-wa-bubble--in cw-wa-bubble--sm">{trigger}</div>
                  <div className="cw-wa-bubble cw-wa-bubble--out cw-wa-bubble--sm">{replyPreview}</div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Editor principal ─────────────────────────────────────────────────────────

export const CampaignReplyFlowEditor: React.FC<Props> = ({
  stages,
  setStages,
  msgRef,
  invalidReplyRef: _invalidReplyRef,
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
  globalOptOutEnabled = true,
  globalOptOutKeywordsText = '',
  onGlobalOptOutChange,
  politeGreetingEnabled = true,
  onPoliteGreetingChange,
  optionImagePreviewUrl,
  onPickOptionImage,
  onRemoveOptionImage,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const patchStage = (idx: number, patch: Partial<ReplyMessageStage>) => {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addIntermediateStage = (afterIdx: number) => {
    setStages((prev) => {
      const next = [...prev];
      next.splice(afterIdx + 1, 0, {
        ...newMessageStage(),
        acceptAnyReply: true,
        optionsMode: 'linear',
        options: [],
      });
      return next;
    });
  };

  const removeStage = (idx: number) => {
    if (stages.length <= 1) return;
    setStages((prev) => prev.filter((_, i) => i !== idx));
  };

  const enableMenuOnStage = (idx: number) => {
    patchStage(idx, {
      acceptAnyReply: false,
      optionsMode: 'conditional',
      options: stages[idx]?.options?.length ? stages[idx].options : [newStageOption()],
    });
  };

  const enableAnyReplyOnStage = (idx: number) => {
    patchStage(idx, { acceptAnyReply: true, optionsMode: 'linear' });
  };

  // ── Renderização de cada etapa ───────────────────────────────────────────────

  const hasOpening = Boolean(stages[0]?.body?.trim());
  const totalStages = stages.length;

  const renderStageConnector = (fromIdx: number) => {
    const stage = stages[fromIdx];
    const isConditional = !stage?.acceptAnyReply && (stage?.options?.length ?? 0) > 0;
    return (
      <div className="cw-reply-connector" aria-hidden>
        <div className="cw-reply-connector__line" />
        <span className="cw-reply-connector__label">
          {isConditional ? '↳ contato digita gatilho' : 'contato responde qualquer coisa'}
        </span>
        <div className="cw-reply-connector__line" />
      </div>
    );
  };

  return (
    <div className="cw-reply-flow cw-reply-flow--simple">
      <CampaignMessageQuickStarters onPick={(body) => patchStage(0, { body })} />

      <div className="cw-reply-tips">
        <Lightbulb className="w-4 h-4 shrink-0" aria-hidden />
        <p>
          <strong>Fluxo conversacional:</strong> a abertura dispara primeiro. Cada etapa aguarda a resposta do
          contato antes de enviar a próxima. Use <strong>Adicionar etapa</strong> para criar quantas mensagens quiser.
        </p>
      </div>

      {/* ── Etapas ─────────────────────────────────────────────────────────── */}
      {stages.map((stage, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === totalStages - 1;
        const isConditional = !stage.acceptAnyReply && (stage.options?.length ?? 0) > 0;
        const previewBody = applyCampaignMessagePreviewVars(stage.body || '', { nome: previewDisplayName });
        const stagePhotoEnabled =
          !isFirst &&
          idx === 1 &&
          followUpAttachmentInputRef &&
          onPickFollowUpAttachment &&
          onRemoveFollowUpAttachment;
        const composerAttachment = isFirst ? attachment : stagePhotoEnabled ? followUpAttachment : null;
        const composerShowAttachment = isFirst
          ? Boolean(attachmentInputRef && onPickAttachment && onRemoveAttachment)
          : Boolean(stagePhotoEnabled);
        const stagePreviewImageUrl =
          (isFirst ? attachment?.previewUrl : stagePhotoEnabled ? followUpAttachment?.previewUrl : null) ||
          null;

        return (
          <React.Fragment key={stage.id}>
            <section
              className={`cw-reply-panel ${idx > 0 ? 'cw-reply-panel--step2' : ''}`}
              style={{ position: 'relative' }}
            >
              {/* Botão remover (não na abertura) */}
              {!isFirst && (
                <button
                  type="button"
                  title="Remover esta etapa"
                  onClick={() => removeStage(idx)}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-3)',
                    padding: 4,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  aria-label="Remover etapa"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              <header className="cw-reply-panel__head">
                <span className={`cw-reply-panel__num ${isFirst ? 'cw-reply-panel__num--open' : 'cw-reply-panel__num--reply'}`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="cw-reply-panel__title">
                    {isFirst
                      ? 'Mensagem de abertura'
                      : isLast && !isFirst
                      ? `Etapa ${idx + 1} — resposta final`
                      : `Etapa ${idx + 1}`}
                  </h4>
                  <p className="cw-reply-panel__sub">
                    {isFirst
                      ? 'Primeiro texto que o contato recebe quando a campanha iniciar.'
                      : isConditional
                      ? 'Enviada após a etapa anterior. Configure gatilhos para dirigir a conversa.'
                      : 'Enviada quando o contato responder a etapa anterior.'}
                  </p>
                </div>
              </header>

              <div className="cw-reply-panel__body space-y-4">
                {/* Editor de texto da etapa */}
                <div className="cw-reply-panel__body cw-reply-panel__body--split">
                  <div className="cw-reply-panel__editor">
                    <CampaignMessageComposer
                      label={isFirst ? 'Texto da abertura' : `Texto da etapa ${idx + 1}`}
                      placeholder={
                        isFirst
                          ? 'Olá {nome}! Tudo bem? Responda esta mensagem que te envio mais detalhes.'
                          : idx === 1
                          ? 'Aqui é a empresa X! Temos uma oferta especial para você:\n\n1 - Quero saber mais\n2 - Não tenho interesse'
                          : 'Continue o diálogo aqui…'
                      }
                      body={stage.body}
                      onBodyChange={(body) => patchStage(idx, { body })}
                      textareaRef={isFirst ? msgRef : undefined}
                      onInsertVariable={(variable) => {
                        if (isFirst) {
                          insertCampaignTokenIntoTextarea(msgRef.current, stage.body, variable, (next) =>
                            patchStage(idx, { body: next })
                          );
                        } else {
                          patchStage(idx, {
                            body: stage.body + `{${variable}}`,
                          });
                        }
                      }}
                      showIdeas={false}
                      showGreetingPicker={isFirst}
                      variablesDensity="compact"
                      variablesCollapsible
                      showAttachment={composerShowAttachment}
                      attachment={composerAttachment ?? null}
                      attachmentInputRef={
                        isFirst ? attachmentInputRef : stagePhotoEnabled ? followUpAttachmentInputRef : undefined
                      }
                      onPickAttachment={
                        isFirst ? onPickAttachment : stagePhotoEnabled ? onPickFollowUpAttachment : undefined
                      }
                      onRemoveAttachment={
                        isFirst ? onRemoveAttachment : stagePhotoEnabled ? onRemoveFollowUpAttachment : undefined
                      }
                      launchMode={launchMode}
                      minHeight={isFirst ? 168 : 130}
                      campaignBrief={campaignBrief}
                    />
                  </div>
                  <aside className="cw-reply-mini-preview" aria-label={`Prévia da etapa ${idx + 1}`}>
                    <div className="cw-reply-mini-preview__head">
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Como chega</span>
                    </div>
                    <div className="cw-reply-mini-preview__phone">
                      {stagePreviewImageUrl ? (
                        <img
                          src={stagePreviewImageUrl}
                          alt=""
                          className="cw-wa-bubble cw-wa-bubble--out max-w-full rounded-lg mb-1 object-cover max-h-32"
                        />
                      ) : null}
                      {previewBody.trim() ? (
                        <div className="cw-wa-bubble cw-wa-bubble--out">{previewBody}</div>
                      ) : (
                        <p className="cw-reply-mini-preview__empty">Digite acima para ver a bolha</p>
                      )}
                    </div>
                  </aside>
                </div>

                {/* Configuração do modo de resposta — só se tem opening e não é etapa de abertura muda a mode */}
                {(isLast || !isFirst) && stage.body.trim() ? (
                  <div className="space-y-3">
                    <div className="cw-reply-mode-grid" role="group" aria-label="Como o contato deve responder a esta etapa">
                      <button
                        type="button"
                        className="cw-reply-mode-card"
                        data-active={stage.acceptAnyReply || (stage.options?.length ?? 0) === 0 ? 'true' : 'false'}
                        onClick={() => enableAnyReplyOnStage(idx)}
                      >
                        <span className="cw-reply-mode-card__icon cw-reply-mode-card__icon--any">
                          <MessageSquare className="w-4 h-4" />
                        </span>
                        <span className="cw-reply-mode-card__title">
                          {isLast ? 'Encerrar em qualquer resposta' : 'Qualquer resposta → próxima etapa'}
                        </span>
                        <span className="cw-reply-mode-card__desc">
                          {isLast
                            ? 'Encerra o fluxo; texto opcional de despedida'
                            : 'Avança independente do que o contato escrever'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="cw-reply-mode-card"
                        data-active={isConditional ? 'true' : 'false'}
                        onClick={() => enableMenuOnStage(idx)}
                      >
                        <span className="cw-reply-mode-card__icon cw-reply-mode-card__icon--menu">
                          <ListOrdered className="w-4 h-4" />
                        </span>
                        <span className="cw-reply-mode-card__title">Gatilhos por palavra ou número</span>
                        <span className="cw-reply-mode-card__desc">
                          Rotas diferentes para cada resposta (1, sim, não…)
                        </span>
                      </button>
                    </div>

                    {/* Se "qualquer resposta" na última etapa + follow-up opcional */}
                    {stage.acceptAnyReply && isLast && (
                      <div className="cw-reply-followup-wrap">
                        <CampaignMessageComposer
                          label="Mensagem de encerramento (opcional)"
                          placeholder="{horario} {nome}! Obrigado pelo retorno. Seguem as informações..."
                          body={stages[idx + 1]?.body || ''}
                          onBodyChange={(body) => {
                            setStages((prev) => {
                              const copy = [...prev];
                              if (!copy[idx + 1]) copy[idx + 1] = newMessageStage();
                              copy[idx + 1] = { ...copy[idx + 1]!, body };
                              return copy;
                            });
                          }}
                          onInsertVariable={(variable) => {
                            const nextBody = stages[idx + 1]?.body || '';
                            setStages((prev) => {
                              const copy = [...prev];
                              if (!copy[idx + 1]) copy[idx + 1] = newMessageStage();
                              copy[idx + 1] = { ...copy[idx + 1]!, body: nextBody + `{${variable}}` };
                              return copy;
                            });
                          }}
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
                          campaignBrief={campaignBrief}
                        />

                        {/* Ação de marketing no encerramento */}
                        <div className="mt-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 flex flex-col gap-3 shadow-inner">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">Ação ao responder</p>
                          <div className="flex flex-wrap gap-2">
                            {(
                              [
                                { value: 'none', emoji: '🔵', label: 'Sem ação', desc: 'Só envia a resposta' },
                                { value: 'opt_in', emoji: '🔥', label: 'Lead Quente', desc: 'Entra em jornada de follow-up' },
                                { value: 'opt_out', emoji: '🚫', label: 'Lista Negra', desc: 'Para todos os disparos' },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                className="flex-1 min-w-[140px] rounded-lg border px-3 py-2 text-left transition-all"
                                style={
                                  (stage.marketingEffect || 'none') === opt.value
                                    ? {
                                        borderColor:
                                          opt.value === 'opt_out' ? '#ef4444' : opt.value === 'opt_in' ? '#f59e0b' : '#6366f1',
                                        background:
                                          opt.value === 'opt_out' ? '#fef2f2' : opt.value === 'opt_in' ? '#fffbeb' : '#eef2ff',
                                      }
                                    : { borderColor: 'var(--border-1)', background: 'transparent' }
                                }
                                onClick={() => patchStage(idx, { marketingEffect: opt.value })}
                              >
                                <span className="text-sm font-bold block leading-tight">{opt.emoji} {opt.label}</span>
                                <span className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>{opt.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Menu de gatilhos */}
                    {isConditional && (
                      <StageMenuBuilder
                        stageIdx={idx}
                        stage={stage}
                        previewBody={previewBody}
                        newStageOption={newStageOption}
                        onInsertInvalidVariable={onInsertInvalidVariable}
                        politeGreetingEnabled={politeGreetingEnabled}
                        onPatch={(patch) => patchStage(idx, patch)}
                        optionImagePreviewUrl={optionImagePreviewUrl}
                        onPickOptionImage={onPickOptionImage}
                        onRemoveOptionImage={onRemoveOptionImage}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            </section>

            {/* Botão "Adicionar etapa" — mostrado entre etapas e depois da última se não for condicional */}
            {!isConditional && (isFirst || !isLast) && stage.body.trim() && (
              <>
                {renderStageConnector(idx)}
                {isLast && (
                  <button
                    type="button"
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed transition-all text-[13px] font-semibold"
                    style={{
                      borderColor: 'var(--brand-400, #34d399)',
                      color: 'var(--brand-600, #059669)',
                      background: 'transparent',
                    }}
                    onClick={() => addIntermediateStage(idx)}
                    title="Adicionar nova etapa ao fluxo"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar etapa de mensagem
                  </button>
                )}
              </>
            )}

            {/* Conector entre etapas quando há próxima */}
            {isConditional && !isLast && renderStageConnector(idx)}
          </React.Fragment>
        );
      })}

      {/* ── Configurações avançadas globais ──────────────────────────────────── */}
      {hasOpening && (
        <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-[12px] font-semibold"
            style={{ color: 'var(--text-2)', background: 'var(--surface-1)' }}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <span>⚙️ Configurações globais do fluxo</span>
            {advancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {advancedOpen && (
            <div className="px-4 pb-4 space-y-4 pt-2">
              {/* Saudação educada */}
              <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/10 p-4 space-y-2">
                <label className="flex items-center gap-2 text-[12px] font-bold cursor-pointer" style={{ color: 'var(--text-1)' }}>
                  <input
                    type="checkbox"
                    checked={politeGreetingEnabled !== false}
                    onChange={(e) => onPoliteGreetingChange?.(e.target.checked)}
                  />
                  Retribuir saudações educadamente
                </label>
                <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  Se o contato responder com &quot;Bom dia&quot;, &quot;Olá&quot; ou &quot;Tudo bem&quot;, responde com saudação amigável antes de solicitar a opção.
                </p>
              </div>

              {/* Opt-out global */}
              <div className="rounded-xl border border-rose-200/60 dark:border-rose-900/40 bg-rose-50/30 dark:bg-rose-950/10 p-4 space-y-3">
                <label className="flex items-center gap-2 text-[12px] font-bold cursor-pointer" style={{ color: 'var(--text-1)' }}>
                  <input
                    type="checkbox"
                    checked={globalOptOutEnabled !== false}
                    onChange={(e) => onGlobalOptOutChange?.({ enabled: e.target.checked })}
                  />
                  Opt-out global (sair, excluir, parar…)
                </label>
                <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                  Padrão: {DEFAULT_GLOBAL_OPT_OUT_KEYWORDS.slice(0, 6).join(', ')}… Marca lista negra antes do menu.
                </p>
                <input
                  type="text"
                  className="cw-reply-menu-field__input w-full"
                  placeholder="Palavras extras (vírgula): cancelar promoções"
                  value={globalOptOutKeywordsText || ''}
                  onChange={(e) => onGlobalOptOutChange?.({ keywordsText: e.target.value })}
                />
              </div>

              {/* Timeout */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <p className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>Timeout sem resposta (etapa 1)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="cw-reply-menu-field">
                    <span className="cw-reply-menu-field__label">Horas sem resposta (0 = off)</span>
                    <input
                      type="number" min={0} max={168}
                      className="cw-reply-menu-field__input"
                      value={stages[0]?.timeoutHours ?? 0}
                      onChange={(e) => patchStage(0, { timeoutHours: Number(e.target.value) || 0 })}
                    />
                  </label>
                </div>
                {(stages[0]?.timeoutHours ?? 0) > 0 && (
                  <Textarea
                    placeholder="Mensagem enviada se o contato não responder no prazo…"
                    value={stages[0]?.timeoutMessage || ''}
                    onChange={(e) => patchStage(0, { timeoutMessage: e.target.value })}
                    style={{ minHeight: '64px' }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
