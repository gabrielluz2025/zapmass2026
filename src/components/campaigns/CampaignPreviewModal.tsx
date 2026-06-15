/**
 * CampaignPreviewModal
 *
 * Exibe preview da mensagem para até 3 contatos de amostra antes do disparo.
 * Substitui variáveis {{nome}}, {{nome_completo}}, etc., e mostra o resultado final.
 */
import React, { useMemo } from 'react';
import { Eye, Send, Users, Smartphone, Clock, X, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { campaignRecipientNameVars } from '../../utils/contactNameNormalize';
import { campaignClockVars } from '../../utils/campaignClockVars';

// ── helpers de personalização ────────────────────────────────────────────────

function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const k = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return vars[k] ?? vars[key] ?? `{{${key}}}`;
  });
}

function resolveSpintax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_, inner) => {
    const options = inner.split('|');
    return options[Math.floor(Math.random() * options.length)] ?? '';
  });
}

function renderMessage(template: string, recipientVars: Record<string, string>): string {
  const clockVars = campaignClockVars();
  const merged: Record<string, string> = {};
  Object.entries(clockVars).forEach(([k, v]) => { merged[k.toLowerCase()] = String(v); });
  Object.entries(recipientVars).forEach(([k, v]) => { merged[k.toLowerCase()] = v; });
  const withVars = applyVars(template, merged);
  return resolveSpintax(withVars);
}

// ── tipos ────────────────────────────────────────────────────────────────────

interface SampleRecipient {
  phone: string;
  vars: Record<string, string>;
  name?: string;
}

interface CampaignPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  campaignName: string;
  message: string;
  messageStages?: string[];
  chipCount: number;
  contactCount: number;
  delaySeconds: number;
  launchMode?: 'now' | 'schedule';
  sampleRecipients: SampleRecipient[];
  isLoading?: boolean;
}

// ── componente ───────────────────────────────────────────────────────────────

export const CampaignPreviewModal: React.FC<CampaignPreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  campaignName,
  message,
  messageStages = [],
  chipCount,
  contactCount,
  delaySeconds,
  launchMode = 'now',
  sampleRecipients,
  isLoading = false,
}) => {
  const allMessages = useMemo(() => {
    const stages = [message, ...messageStages].filter(Boolean);
    return stages;
  }, [message, messageStages]);

  const samples = useMemo(() => {
    return sampleRecipients.slice(0, 3).map((r) => ({
      ...r,
      preview: allMessages.map((tmpl) => renderMessage(tmpl, r.vars)),
    }));
  }, [sampleRecipients, allMessages]);

  const delayLabel =
    delaySeconds < 60
      ? `${delaySeconds}s entre mensagens`
      : `${Math.round(delaySeconds / 60)}min entre mensagens`;

  const estimatedMinutes = Math.ceil((contactCount * delaySeconds) / 60);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="lg"
    >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#3b82f620,#10b98120)' }}
          >
            <Eye className="w-5 h-5" style={{ color: 'var(--brand)' }} />
          </div>
          <div>
            <h2 className="font-black text-[17px]" style={{ color: 'var(--text-1)' }}>
              Preview da campanha
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Confirme como as mensagens aparecerão antes de disparar
            </p>
          </div>
        </div>

        {/* Meta resumo */}
        <div
          className="rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-2"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          {[
            { icon: <Send className="w-3.5 h-3.5" />, label: 'Nome', value: campaignName, span: true },
            { icon: <Users className="w-3.5 h-3.5" />, label: 'Contatos', value: contactCount.toLocaleString('pt-BR') },
            { icon: <Smartphone className="w-3.5 h-3.5" />, label: 'Chips', value: String(chipCount) },
            { icon: <Clock className="w-3.5 h-3.5" />, label: 'Duração', value: `~${estimatedMinutes}min` },
          ].map((s, i) => (
            <div key={i} className={s.span ? 'col-span-2 sm:col-span-4' : ''}>
              <div className="flex items-center gap-1.5 mb-0.5" style={{ color: 'var(--text-3)' }}>
                {s.icon}
                <span className="text-[10px] font-semibold uppercase tracking-wider">{s.label}</span>
              </div>
              <div
                className="text-[13px] font-bold truncate"
                style={{ color: 'var(--text-1)' }}
              >
                {s.value}
              </div>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4 text-[11px]" style={{ color: 'var(--text-3)' }}>
            ⏱ {delayLabel} &nbsp;·&nbsp;
            {allMessages.length > 1
              ? `${allMessages.length} mensagens em sequência (multi-etapas)`
              : '1 mensagem por contato'}
          </div>
        </div>

        {/* Previews por contato */}
        {samples.length > 0 ? (
          <div className="space-y-3">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-3)' }}>
              Amostra para os {samples.length} primeiros contatos:
            </p>
            {samples.map((s, idx) => (
              <div
                key={s.phone}
                className="rounded-xl overflow-hidden"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                {/* Header do contato */}
                <div
                  className="px-3 py-2 flex items-center gap-2 border-b"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black text-white shrink-0"
                    style={{ background: `hsl(${(idx * 127) % 360}, 60%, 55%)` }}
                  >
                    {(s.name || s.phone).charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                    {s.name || s.phone}
                  </span>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--text-3)' }}>
                    {s.phone}
                  </span>
                </div>

                {/* Bolhas de mensagem */}
                <div className="px-3 py-3 space-y-2">
                  {s.preview.map((msg, mIdx) => (
                    <div key={mIdx} className="flex justify-end">
                      <div
                        className="max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words shadow-sm"
                        style={{ background: '#25d36620', color: 'var(--text-1)', border: '1px solid #25d36630' }}
                      >
                        {msg}
                        {allMessages.length > 1 && (
                          <span
                            className="block mt-1 text-[9px] font-bold uppercase tracking-wider opacity-60"
                          >
                            etapa {mIdx + 1}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="rounded-xl px-4 py-8 flex flex-col items-center gap-2 text-center"
            style={{ background: 'var(--surface-1)' }}
          >
            <Eye className="w-8 h-8 opacity-20" />
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              Sem contatos de amostra disponíveis
            </p>
          </div>
        )}

        {/* Aviso de variáveis não resolvidas */}
        {samples.some((s) => s.preview.some((p) => p.includes('{{') && p.includes('}}'))) && (
          <div
            className="rounded-xl px-3 py-2.5 text-[12px]"
            style={{ background: '#f59e0b18', border: '1px solid #f59e0b40', color: '#d97706' }}
          >
            ⚠️ Algumas variáveis (<code>{'{{nome}}'}</code>) não foram substituídas — verifique se os contatos têm o campo preenchido.
          </div>
        )}

        {/* Ações */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} leftIcon={<X className="w-4 h-4" />}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            loading={isLoading}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            {launchMode === 'schedule' ? 'Confirmar agendamento' : 'Confirmar e disparar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
