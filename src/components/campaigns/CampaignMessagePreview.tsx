import React, { useMemo, useState } from 'react';
import { ArrowDown, Check, CheckCheck, Copy, MessageSquare, Reply } from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign } from '../../types';

interface CampaignMessagePreviewProps {
  campaign: Campaign;
}

type SeqItem = {
  text: string;
  kind: 'out' | 'gate' | 'in';
  meta?: string;
  stepLabel?: string;
};

export const CampaignMessagePreview: React.FC<CampaignMessagePreviewProps> = ({ campaign }) => {
  const initial = campaign.message || '';
  const stages = Array.isArray(campaign.messageStages) ? campaign.messageStages : [];
  const flowSteps = campaign.replyFlow?.enabled ? campaign.replyFlow.steps || [] : [];
  const isReplyFlow = flowSteps.length > 0;

  const sequence = useMemo<SeqItem[]>(() => {
    if (isReplyFlow) {
      const out: SeqItem[] = [];
      flowSteps.forEach((step, idx) => {
        out.push({
          text: step.body,
          kind: 'out',
          stepLabel: `Etapa ${idx + 1}`,
          meta: idx === 0 ? 'Enviada ao iniciar' : 'Enviada após resposta'
        });
        if (idx < flowSteps.length - 1) {
          const gate = step.acceptAnyReply
            ? 'qualquer resposta'
            : (step.validTokens || []).join(' / ') || 'resposta válida';
          out.push({
            text: '',
            kind: 'gate',
            meta: `Aguardando: ${gate}`
          });
        }
      });
      return out;
    }

    const out: SeqItem[] = [];
    if (initial) out.push({ text: initial, kind: 'out', stepLabel: 'Inicial' });
    stages.forEach((s, idx) => {
      if (idx === 0 && s === initial) return;
      out.push({ text: s, kind: 'out', stepLabel: `Etapa ${idx + 1}` });
    });
    return out;
  }, [initial, stages, flowSteps, isReplyFlow]);

  const hasMulti = sequence.length > 1;
  const [activeTab, setActiveTab] = useState<'single' | 'flow'>(hasMulti ? 'flow' : 'single');

  const variables = useMemo(() => {
    const set = new Set<string>();
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    const scan = (txt: string) => {
      let m: RegExpExecArray | null;
      const localRe = new RegExp(re.source, 'g');
      while ((m = localRe.exec(txt)) !== null) set.add(m[1]);
    };
    sequence.filter((s) => s.kind === 'out').forEach((s) => scan(s.text));
    return Array.from(set);
  }, [sequence]);

  const totalChars = sequence.filter((s) => s.kind === 'out').reduce((a, s) => a + s.text.length, 0);
  const _createdDate = new Date(campaign.createdAt);
  const tNow = isNaN(_createdDate.getTime())
    ? new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : _createdDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Mensagem copiada.'),
      () => toast.error('Falha ao copiar.')
    );
  };

  const visible = activeTab === 'single' ? sequence.filter((s) => s.kind === 'out').slice(0, 1) : sequence;

  return (
    <div
      className="rounded-2xl p-4 h-full flex flex-col"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.08))',
              border: '1px solid rgba(16,185,129,0.3)'
            }}
          >
            <MessageSquare className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <h3 className="ui-title text-[14px]">
              {isReplyFlow ? 'Fluxo por resposta' : 'Mensagem enviada'}
            </h3>
            <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              {flowSteps.length || sequence.filter((s) => s.kind === 'out').length} etapa
              {(flowSteps.length || 1) === 1 ? '' : 's'} • {totalChars} caracteres
            </p>
          </div>
        </div>

        {hasMulti && (
          <div
            className="flex text-[10.5px] rounded-lg overflow-hidden p-0.5"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('single')}
              className="px-2 py-1 font-bold transition-colors rounded-md"
              style={{
                background: activeTab === 'single' ? 'var(--surface-0)' : 'transparent',
                color: activeTab === 'single' ? 'var(--text-1)' : 'var(--text-3)'
              }}
            >
              Inicial
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('flow')}
              className="px-2 py-1 font-bold transition-colors rounded-md"
              style={{
                background: activeTab === 'flow' ? 'var(--surface-0)' : 'transparent',
                color: activeTab === 'flow' ? 'var(--text-1)' : 'var(--text-3)'
              }}
            >
              Fluxo
            </button>
          </div>
        )}
      </div>

      <div
        className="rounded-xl p-3 space-y-2 relative overflow-y-auto flex-1"
        style={{
          background: 'linear-gradient(180deg, #0b141a 0%, #111b21 100%)',
          minHeight: 160,
          maxHeight: 320,
          border: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        {visible.length === 0 ? (
          <div className="text-center text-[12px] py-6" style={{ color: 'rgba(255,255,255,0.4)' }}>
            (campanha sem mensagem configurada)
          </div>
        ) : (
          visible.map((s, idx) => {
            if (s.kind === 'gate') {
              return (
                <div key={idx} className="flex flex-col items-center gap-1 py-1">
                  <ArrowDown className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.35)' }} />
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
                    style={{
                      background: 'rgba(245,158,11,0.15)',
                      border: '1px solid rgba(245,158,11,0.35)',
                      color: '#fcd34d'
                    }}
                  >
                    <Reply className="w-3 h-3 shrink-0" />
                    {s.meta}
                  </div>
                </div>
              );
            }

            return (
              <div key={idx} className="space-y-1">
                {s.stepLabel && (
                  <div className="flex justify-center">
                    <span
                      className="text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        color: 'rgba(255,255,255,0.65)'
                      }}
                    >
                      {s.stepLabel}
                    </span>
                  </div>
                )}
                <div className="flex justify-end">
                  <div
                    className="max-w-[88%] px-3 py-2 rounded-2xl rounded-br-sm text-[12.5px] whitespace-pre-wrap leading-relaxed"
                    style={{
                      background: '#005c4b',
                      color: '#e9edef',
                      boxShadow: '0 1px 1px rgba(0,0,0,0.12)'
                    }}
                  >
                    {s.text || <span className="opacity-60 italic">(vazio)</span>}
                    <div className="text-[9.5px] mt-1 opacity-70 text-right flex items-center justify-end gap-0.5 font-mono">
                      <span>{tNow}</span>
                      {idx === 0 ? (
                        <CheckCheck className="w-3 h-3" style={{ color: '#53bdeb' }} />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div
        className="mt-3 pt-3 flex items-center justify-between gap-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
          {isReplyFlow
            ? 'A etapa 2 só dispara quando o contato responde à etapa 1.'
            : variables.length > 0
            ? `${variables.length} variável${variables.length > 1 ? 'eis' : ''}`
            : 'Sem variáveis dinâmicas'}
        </span>
        <button
          type="button"
          onClick={() =>
            copy(
              sequence
                .filter((s) => s.kind === 'out')
                .map((s) => s.text)
                .join('\n\n---\n\n')
            )
          }
          className="text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md transition-colors hover:bg-[var(--surface-2)] shrink-0"
          style={{ color: 'var(--text-2)' }}
        >
          <Copy className="w-3 h-3" />
          Copiar
        </button>
      </div>
    </div>
  );
};
