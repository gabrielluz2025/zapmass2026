import React, { useMemo } from 'react';
import { CheckCheck, Link2, Smartphone } from 'lucide-react';
import { applyCampaignMessagePreviewVars } from '../../utils/campaignMessageVariables';
import { resolveCampaignSpintax } from '../../../shared/campaignSpintax';

type Props = {
  body: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  linkUrl?: string;
  chipName?: string;
  stepLabel?: string;
  compact?: boolean;
};

function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

export const NurturePhonePreview: React.FC<Props> = ({
  body,
  mediaUrl,
  mediaMimeType,
  linkUrl,
  chipName,
  stepLabel,
  compact
}) => {
  const previewText = useMemo(() => {
    let t = applyCampaignMessagePreviewVars(body || '');
    t = resolveCampaignSpintax(t, 0);
    const link = linkUrl?.trim();
    if (link) t = t.trim() ? `${t.trim()}\n\n${link}` : link;
    return t;
  }, [body, linkUrl]);

  const timeNow = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const isImage = mediaMimeType?.startsWith('image/');
  const isVideo = mediaMimeType?.startsWith('video/');

  return (
    <div
      className={`rounded-2xl overflow-hidden flex flex-col ${compact ? '' : 'shadow-lg border border-slate-200/80 dark:border-slate-700/80'}`}
      style={{ background: 'var(--surface-0)' }}
    >
      <div
        className="px-3 py-2 flex items-center gap-2 border-b"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
            Prévia no celular
          </p>
          <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
            {chipName ? `Chip: ${chipName}` : 'Como o contato verá'}
            {stepLabel ? ` · ${stepLabel}` : ''}
          </p>
        </div>
      </div>

      <div
        className="p-3 space-y-2 relative overflow-y-auto"
        style={{
          background: 'linear-gradient(180deg, #0b141a 0%, #111b21 100%)',
          minHeight: compact ? 140 : 220,
          maxHeight: compact ? 240 : 360
        }}
      >
        {(mediaUrl || previewText.trim()) ? (
          <div className="flex justify-end">
            <div className="max-w-[88%] space-y-1">
              {mediaUrl && (
                <div
                  className="rounded-xl overflow-hidden border border-white/10"
                  style={{ background: 'rgba(0,0,0,0.25)' }}
                >
                  {isImage ? (
                    <img src={mediaUrl} alt="" className="w-full max-h-40 object-cover" />
                  ) : isVideo ? (
                    <video src={mediaUrl} className="w-full max-h-40 object-cover" muted playsInline />
                  ) : (
                    <div className="px-3 py-4 text-[11px] text-white/70">📎 Anexo</div>
                  )}
                </div>
              )}
              {previewText.trim() && (
                <div
                  className="px-3 py-2 rounded-2xl rounded-br-sm text-[12.5px] whitespace-pre-wrap leading-relaxed"
                  style={{ background: '#005c4b', color: '#e9edef' }}
                >
                  {previewText}
                  <div className="text-[9.5px] mt-1 opacity-70 text-right flex items-center justify-end gap-0.5 font-mono">
                    <span>{timeNow}</span>
                    <CheckCheck className="w-3 h-3" style={{ color: '#53bdeb' }} />
                  </div>
                </div>
              )}
              {linkUrl?.trim() && !previewText.includes(linkUrl.trim()) && (
                <div
                  className="rounded-lg px-2.5 py-2 text-[11px] border border-white/10"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#aebac1' }}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-[#53bdeb]">
                    <Link2 className="w-3 h-3 shrink-0" />
                    {linkDomain(linkUrl)}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center text-[12px] py-8" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Escreva o texto ou anexe uma mídia para ver a prévia
          </div>
        )}
      </div>
    </div>
  );
};
