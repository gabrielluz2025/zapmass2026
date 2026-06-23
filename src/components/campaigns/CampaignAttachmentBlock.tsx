import React from 'react';
import { FileSpreadsheet, Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui';
import type { CampaignMediaPayload } from '../../utils/campaignMediaLibrary';

export type CampaignAttachmentState = {
  file: File;
  previewUrl: string | null;
  sendAsDocument?: boolean;
  /** Payload pronto para envio — evita reler o File depois (referência pode expirar). */
  mediaPayload?: CampaignMediaPayload;
  preparing?: boolean;
};

type Props = {
  attachment: CampaignAttachmentState | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void;
  onRemove: () => void;
  launchMode?: 'now' | 'schedule';
  compact?: boolean;
};

export const CampaignAttachmentBlock: React.FC<Props> = ({
  attachment,
  inputRef,
  onPick,
  onRemove,
  launchMode,
  compact
}) => (
  <div className={compact ? 'pt-3 mt-1 border-t border-[var(--border-subtle)]' : 'mt-3'}>
    <div
      className="rounded-xl p-3"
      style={{
        background: 'var(--surface-1)',
        border: '1px dashed var(--border-subtle)'
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Anexo {compact ? '(opcional)' : 'da campanha'}
          </p>
          <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            Foto, vídeo ou arquivo na 1ª mensagem. O texto acima vira legenda.
          </p>
        </div>
        {!attachment && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,application/*"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                onPick(file);
                e.target.value = '';
              }}
            />
            <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
              Anexar
            </Button>
          </>
        )}
      </div>

      {attachment ? (
        <div
          className="flex items-start gap-3 rounded-lg p-2.5"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
        >
          <div
            className="rounded-md overflow-hidden flex items-center justify-center shrink-0"
            style={{
              width: compact ? 60 : 72,
              height: compact ? 60 : 72,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            {attachment.file.type.startsWith('image/') && attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt="" className="w-full h-full object-cover" />
            ) : attachment.file.type.startsWith('video/') && attachment.previewUrl ? (
              <video src={attachment.previewUrl} className="w-full h-full object-cover" muted playsInline />
            ) : (
              <FileSpreadsheet className="w-8 h-8" style={{ color: 'var(--text-3)' }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }} title={attachment.file.name}>
              {attachment.file.name}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {(attachment.file.size / (1024 * 1024)).toFixed(2)} MB
              {attachment.file.type ? ` · ${attachment.file.type}` : ''}
              {attachment.preparing ? ' · preparando…' : attachment.mediaPayload ? ' · pronto' : ''}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Button type="button" size="xs" variant="ghost" onClick={onRemove} disabled={attachment.preparing}>
                Remover
              </Button>
              {attachment.preparing && (
                <span className="text-[10px] font-semibold inline-flex items-center gap-1" style={{ color: '#0ea5e9' }}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Preparando anexo…
                </span>
              )}
              {launchMode === 'schedule' && (
                <span className="text-[10px] font-semibold" style={{ color: '#f59e0b' }}>
                  Anexos só em disparo imediato
                </span>
              )}
              {attachment.sendAsDocument && (
                <span className="text-[10px] font-semibold" style={{ color: '#0ea5e9' }}>
                  Envio como documento
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[10.5px] flex items-start gap-2" style={{ color: 'var(--text-3)' }}>
          <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
          <span>
            Para <strong>links</strong>, cole a URL no texto — o WhatsApp gera o preview automaticamente.
          </span>
        </p>
      )}
    </div>
  </div>
);
