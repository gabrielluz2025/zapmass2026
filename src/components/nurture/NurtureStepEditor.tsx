import React, { useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Input } from '../ui';
import { NurturePhonePreview } from './NurturePhonePreview';
import { prepareCampaignAttachmentPayload, type CampaignMediaPayload } from '../../utils/campaignMediaLibrary';
import {
  WEEKDAY_LABELS,
  type NurtureJourneyDoc,
  type NurtureSocialLinks,
  type NurtureStep,
  type NurtureStepOption
} from '../../services/nurtureApi';

export type PendingStepMedia = CampaignMediaPayload & { previewUrl?: string };

type Props = {
  step: NurtureStep;
  index: number;
  doc: NurtureJourneyDoc;
  chipName?: string;
  socialLinks?: NurtureSocialLinks;
  pendingMedia?: PendingStepMedia | null;
  onChange: (patch: Partial<NurtureStep>) => void;
  onOptionsChange: (options: NurtureStepOption[]) => void;
  onSetKind: (kind: NurtureStep['kind']) => void;
  onPendingMedia: (payload: PendingStepMedia | null) => void;
  onRemove: () => void;
};

function defaultWaitReplyOptions(): NurtureStepOption[] {
  return [
    {
      id: '1',
      tokens: ['1', 'sim'],
      reply: 'Perfeito! Em breve alguém da equipe fala com você.',
      handoff: true
    },
    {
      id: '2',
      tokens: ['2', 'depois', 'nao', 'não'],
      reply: 'Sem problemas! Continuamos por aqui quando quiser.'
    }
  ];
}

function newWaitReplyOption(index: number): NurtureStepOption {
  return { id: String(index + 1), tokens: [String(index + 1)], reply: '', handoff: false };
}

export const NurtureStepEditor: React.FC<Props> = ({
  step,
  index,
  doc,
  chipName,
  socialLinks,
  pendingMedia,
  onChange,
  onOptionsChange,
  onSetKind,
  onPendingMedia,
  onRemove
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mediaBusy, setMediaBusy] = useState(false);

  const mediaPreviewUrl =
    pendingMedia?.previewUrl ||
    (step.media?.mimeType?.startsWith('image/') ? step.media.url : undefined) ||
    (step.media?.mimeType?.startsWith('video/') ? step.media.url : undefined);

  const handlePickMedia = async (file: File | null) => {
    if (!file) return;
    setMediaBusy(true);
    try {
      const prepared = await prepareCampaignAttachmentPayload(file);
      const previewUrl =
        file.type.startsWith('image/') || file.type.startsWith('video/')
          ? URL.createObjectURL(file)
          : undefined;
      onPendingMedia({
        dataBase64: prepared.dataBase64,
        mimeType: prepared.mimeType,
        fileName: prepared.fileName,
        sendMediaAsDocument: prepared.sendMediaAsDocument,
        previewUrl
      });
      onChange({
        media: {
          url: previewUrl || step.media?.url || '',
          mimeType: prepared.mimeType,
          fileName: prepared.fileName,
          sendAsDocument: prepared.sendMediaAsDocument
        }
      });
      toast.success('Anexo pronto — salve a jornada para publicar.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao preparar anexo.');
    } finally {
      setMediaBusy(false);
    }
  };

  const clearMedia = () => {
    onPendingMedia(null);
    onChange({ media: undefined });
  };

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] gap-6">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <span className="w-8 h-8 rounded-full bg-teal-500 text-white text-sm font-black flex items-center justify-center shrink-0">
              {index + 1}
            </span>
            <Input
              value={step.label || ''}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder={`Passo ${index + 1}`}
              className="font-semibold"
            />
          </div>
          <button type="button" onClick={onRemove} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={step.kind}
            onChange={(e) => onSetKind(e.target.value as NurtureStep['kind'])}
            className="text-xs font-bold rounded-lg border px-2 py-1.5 dark:bg-slate-900"
          >
            <option value="message">Mensagem automática</option>
            <option value="wait_reply">Aguardar resposta</option>
          </select>
          {doc.scheduleMode === 'relative' ? (
            <label className="text-xs font-bold text-slate-500 flex items-center gap-1">
              +Horas
              <input
                type="number"
                min={0}
                max={336}
                value={step.delayHours ?? 0}
                onChange={(e) => onChange({ delayHours: Number(e.target.value) || 0 })}
                className="w-16 rounded border px-2 py-1 dark:bg-slate-900"
              />
            </label>
          ) : (
            <>
              <select
                value={step.calendar?.weekday ?? 1}
                onChange={(e) =>
                  onChange({
                    calendar: { weekday: Number(e.target.value), time: step.calendar?.time || '09:00' }
                  })
                }
                className="text-xs rounded border px-2 py-1 dark:bg-slate-900"
              >
                {WEEKDAY_LABELS.map((l, i) => (
                  <option key={l} value={i}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={step.calendar?.time || '09:00'}
                onChange={(e) =>
                  onChange({
                    calendar: { weekday: step.calendar?.weekday ?? 1, time: e.target.value }
                  })
                }
                className="text-xs rounded border px-2 py-1 dark:bg-slate-900"
              />
            </>
          )}
        </div>

        <textarea
          value={step.body}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={5}
          placeholder="Texto — vira legenda se houver mídia. {nome}, {saudacao}…"
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm dark:bg-slate-900"
        />

        <div className="grid sm:grid-cols-2 gap-3">
          <div
            className="rounded-xl p-3 border border-dashed"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <ImagePlus className="w-3.5 h-3.5" /> Foto / vídeo / PDF
              </span>
              {!step.media && !pendingMedia && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept="image/*,video/*,.pdf"
                    onChange={(e) => void handlePickMedia(e.target.files?.[0] || null)}
                  />
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={mediaBusy}
                    onClick={() => fileRef.current?.click()}
                  >
                    {mediaBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Anexar'}
                  </Button>
                </>
              )}
            </div>
            {(step.media || pendingMedia) && (
              <div className="flex items-center gap-2">
                {mediaPreviewUrl && step.media?.mimeType?.startsWith('image/') && (
                  <img src={mediaPreviewUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{step.media?.fileName || 'Anexo'}</p>
                  <p className="text-[10px] text-slate-500">{step.media?.mimeType}</p>
                </div>
                <button type="button" onClick={clearMedia} className="p-1 text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5" /> Link
            </span>
            <Input
              value={step.linkUrl || ''}
              onChange={(e) => onChange({ linkUrl: e.target.value.trim() || undefined })}
              placeholder="https://…"
            />
          </label>
        </div>

        {step.kind === 'wait_reply' && (
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500">Opções 1 / 2 / 3</p>
              <button
                type="button"
                onClick={() =>
                  onOptionsChange([...(step.options || []), newWaitReplyOption((step.options || []).length)])
                }
                className="text-xs font-bold text-teal-600 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Opção
              </button>
            </div>
            {(step.options || []).length === 0 ? (
              <button type="button" onClick={() => onOptionsChange(defaultWaitReplyOptions())} className="text-xs underline text-slate-500">
                Opções padrão
              </button>
            ) : (
              (step.options || []).map((opt, optIndex) => (
                <div key={opt.id || optIndex} className="p-3 rounded-lg border space-y-2 dark:border-slate-700">
                  <div className="flex justify-between">
                    <span className="text-xs font-black">Opção {optIndex + 1}</span>
                    <button
                      type="button"
                      onClick={() => onOptionsChange((step.options || []).filter((_, i) => i !== optIndex))}
                      className="text-xs text-red-500"
                    >
                      Remover
                    </button>
                  </div>
                  <Input
                    value={(opt.tokens || []).join(', ')}
                    onChange={(e) => {
                      const tokens = e.target.value.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
                      const next = [...(step.options || [])];
                      next[optIndex] = { ...opt, tokens };
                      onOptionsChange(next);
                    }}
                  />
                  <textarea
                    value={opt.reply || ''}
                    onChange={(e) => {
                      const next = [...(step.options || [])];
                      next[optIndex] = { ...opt, reply: e.target.value };
                      onOptionsChange(next);
                    }}
                    rows={2}
                    className="w-full rounded-lg border p-2 text-sm dark:bg-slate-900"
                  />
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!opt.handoff}
                      onChange={(e) => {
                        const next = [...(step.options || [])];
                        next[optIndex] = { ...opt, handoff: e.target.checked };
                        onOptionsChange(next);
                      }}
                    />
                    Handoff humano
                  </label>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="lg:sticky lg:top-4 self-start">
        <NurturePhonePreview
          body={step.body}
          mediaUrl={mediaPreviewUrl}
          mediaMimeType={step.media?.mimeType}
          linkUrl={step.linkUrl}
          socialLinks={socialLinks}
          chipName={chipName}
          stepLabel={step.label || `Passo ${index + 1}`}
        />
      </div>
    </div>
  );
};
