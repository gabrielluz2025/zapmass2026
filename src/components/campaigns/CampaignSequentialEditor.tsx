/**
 * Editor de etapas para o modo SEQUENCIAL (sequência automática).
 *
 * Diferente do CampaignReplyFlowEditor (que depende de respostas), aqui cada
 * etapa é só um texto que será enviado em fila, com o intervalo anti-ban entre
 * cada uma — sem esperar o contato responder.
 *
 * Reaproveita o mesmo array `ReplyMessageStage[]` do wizard; no modo sequencial
 * apenas o campo `body` de cada etapa é relevante.
 */
import React from 'react';
import { Plus, Trash2, ArrowDown, Clock, Zap, MessageCircle } from 'lucide-react';
import { CampaignMessageComposer } from './CampaignMessageComposer';
import type { CampaignAttachmentState } from './CampaignAttachmentBlock';
import type { ReplyMessageStage } from './CampaignReplyFlowEditor';
import type { CampaignStageTriggerType } from '../../types';
import { Button } from '../ui';
import { insertCampaignTokenIntoTextarea } from '../../utils/campaignMessageVariables';

type StageTriggerCfg = { type: CampaignStageTriggerType; timeoutHours?: number };

type Props = {
  stages: ReplyMessageStage[];
  setStages: React.Dispatch<React.SetStateAction<ReplyMessageStage[]>>;
  msgRef: React.RefObject<HTMLTextAreaElement | null>;
  attachment: CampaignAttachmentState | null;
  attachmentInputRef: React.RefObject<HTMLInputElement | null>;
  onPickAttachment: (file: File | null) => void;
  onRemoveAttachment: () => void;
  launchMode?: 'now' | 'schedule';
  newMessageStage: () => ReplyMessageStage;
  delaySeconds: number;
  advancedTriggers: boolean;
  onToggleAdvancedTriggers: (on: boolean) => void;
  stageTriggers: Record<string, StageTriggerCfg>;
  onChangeStageTrigger: (stageId: string, cfg: StageTriggerCfg) => void;
};

export const CampaignSequentialEditor: React.FC<Props> = ({
  stages,
  setStages,
  msgRef,
  attachment,
  attachmentInputRef,
  onPickAttachment,
  onRemoveAttachment,
  launchMode,
  newMessageStage,
  delaySeconds,
  advancedTriggers,
  onToggleAdvancedTriggers,
  stageTriggers,
  onChangeStageTrigger,
}) => {
  const patchStageBody = (idx: number, body: string) => {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, body } : s)));
  };

  const addStage = () => {
    setStages((prev) => [...prev, newMessageStage()]);
  };

  const removeStage = (idx: number) => {
    setStages((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const intervalLabel =
    delaySeconds >= 60
      ? `${Math.round(delaySeconds / 60)} min`
      : `${delaySeconds}s`;

  return (
    <div className="space-y-2">
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-3)' }}
      >
        <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-600)' }} />
        <span>
          Cada contato recebe <strong>todas as etapas em sequência</strong>, com intervalo de ~{intervalLabel} entre
          envios — sem depender de resposta.
        </span>
      </div>

      <label
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
      >
        <input
          type="checkbox"
          checked={advancedTriggers}
          onChange={(e) => onToggleAdvancedTriggers(e.target.checked)}
        />
        <span className="flex-1">
          <span className="block text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Gatilhos avançados por etapa
          </span>
          <span className="block text-[10.5px]" style={{ color: 'var(--text-3)' }}>
            Defina, em cada etapa, como avançar: por intervalo, imediatamente ou só quando o contato responder.
          </span>
        </span>
        <Zap className="w-4 h-4 shrink-0" style={{ color: advancedTriggers ? '#8b5cf6' : 'var(--text-3)' }} />
      </label>

      {stages.map((stage, idx) => (
        <React.Fragment key={stage.id}>
          <div
            className="rounded-xl p-3"
            style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}
                >
                  {idx + 1}
                </span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                  {idx === 0 ? 'Mensagem de abertura' : `Etapa ${idx + 1}`}
                </span>
              </div>
              {stages.length > 1 && (
                <button
                  type="button"
                  className="p-1 rounded text-red-500 hover:bg-red-500/10"
                  onClick={() => removeStage(idx)}
                  aria-label={`Remover etapa ${idx + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <CampaignMessageComposer
              label={idx === 0 ? 'Texto da abertura' : 'Texto desta etapa'}
              placeholder={
                idx === 0
                  ? 'Olá {nome}! Temos uma novidade para você...'
                  : 'Conteúdo da próxima mensagem automática...'
              }
              body={stage.body || ''}
              onBodyChange={(body) => patchStageBody(idx, body)}
              textareaRef={idx === 0 ? msgRef : undefined}
              onInsertVariable={(variable) =>
                insertCampaignTokenIntoTextarea(
                  idx === 0 ? msgRef.current : null,
                  stage.body || '',
                  variable,
                  (next) => patchStageBody(idx, next)
                )
              }
              onApplyTemplate={(body) => patchStageBody(idx, body)}
              variablesDensity={idx === 0 ? 'full' : 'compact'}
              showIdeas={idx === 0}
              showGreetingPicker
              showAttachment={idx === 0}
              attachment={idx === 0 ? attachment : null}
              attachmentInputRef={idx === 0 ? attachmentInputRef : undefined}
              onPickAttachment={idx === 0 ? onPickAttachment : undefined}
              onRemoveAttachment={idx === 0 ? onRemoveAttachment : undefined}
              launchMode={launchMode}
              minHeight={idx === 0 ? 120 : 90}
            />
          </div>
          {idx < stages.length - 1 && (
            advancedTriggers ? (
              (() => {
                const cfg = stageTriggers[stage.id] || { type: 'delay' as CampaignStageTriggerType };
                const opts: Array<{ v: CampaignStageTriggerType; label: string; icon: React.ReactNode }> = [
                  { v: 'delay', label: `Após ~${intervalLabel}`, icon: <Clock className="w-3 h-3" /> },
                  { v: 'immediate', label: 'Imediato', icon: <ArrowDown className="w-3 h-3" /> },
                  { v: 'any_reply', label: 'Se responder', icon: <MessageCircle className="w-3 h-3" /> },
                ];
                return (
                  <div
                    className="rounded-lg px-3 py-2 space-y-2"
                    style={{ background: 'var(--surface-1)', border: '1px dashed var(--border)' }}
                  >
                    <p className="text-[10.5px] font-semibold" style={{ color: 'var(--text-3)' }}>
                      Avançar para a etapa {idx + 2} quando:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {opts.map((o) => {
                        const active = cfg.type === o.v;
                        return (
                          <button
                            key={o.v}
                            type="button"
                            onClick={() => onChangeStageTrigger(stage.id, { ...cfg, type: o.v })}
                            className="flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full border transition-colors"
                            style={{
                              borderColor: active ? 'rgba(139,92,246,0.5)' : 'var(--border-subtle)',
                              background: active ? 'rgba(139,92,246,0.12)' : 'var(--surface-0)',
                              color: active ? '#8b5cf6' : 'var(--text-3)',
                            }}
                          >
                            {o.icon}
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                    {cfg.type === 'any_reply' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                          Esperar até
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={168}
                          value={cfg.timeoutHours ?? 24}
                          onChange={(e) =>
                            onChangeStageTrigger(stage.id, {
                              ...cfg,
                              timeoutHours: Math.max(1, Math.min(168, Number(e.target.value) || 24)),
                            })
                          }
                          className="w-16 rounded border px-2 py-1 text-[11px]"
                          style={{ borderColor: 'var(--border)', background: 'var(--surface-0)', color: 'var(--text-1)' }}
                        />
                        <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                          horas pela resposta (depois segue mesmo assim)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="flex justify-center" aria-hidden>
                <div
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}
                >
                  <ArrowDown className="w-3 h-3" />
                  aguarda ~{intervalLabel}
                </div>
              </div>
            )
          )}
        </React.Fragment>
      ))}

      <Button
        type="button"
        size="sm"
        variant="secondary"
        leftIcon={<Plus className="w-3.5 h-3.5" />}
        onClick={addStage}
        className="w-full"
      >
        Adicionar etapa
      </Button>
    </div>
  );
};
