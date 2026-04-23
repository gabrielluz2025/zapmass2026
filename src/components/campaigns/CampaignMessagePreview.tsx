import React, { useMemo, useState } from 'react';
import { Check, CheckCheck, Copy, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign } from '../../types';

interface CampaignMessagePreviewProps {
  campaign: Campaign;
}

export const CampaignMessagePreview: React.FC<CampaignMessagePreviewProps> = ({ campaign }) => {
  const initial = campaign.message || '';
  const stages = Array.isArray(campaign.messageStages) ? campaign.messageStages : [];
  const flowSteps = campaign.replyFlow?.enabled ? campaign.replyFlow.steps || [] : [];

  // Sequência completa: [inicial, ...stages extras, ...flowSteps (a partir da 2ª)]
  type SeqItem = { text: string; type: 'initial' | 'stage' | 'flow'; meta?: string };
  const sequence = useMemo<SeqItem[]>(() => {
    const out: SeqItem[] = [];
    if (initial) out.push({ text: initial, type: 'initial' });
    stages.forEach((s, idx) => {
      // stages[0] normalmente corresponde à mensagem inicial; ignoramos se for idêntica
      if (idx === 0 && s === initial) return;
      out.push({ text: s, type: 'stage', meta: `Etapa ${idx + 1}` });
    });
    flowSteps.forEach((step, idx) => {
      if (idx === 0) return; // a primeira etapa do flow já é a inicial
      const tokens = step.acceptAnyReply
        ? 'qualquer resposta'
        : (step.validTokens || []).join(' / ') || 'resposta válida';
      out.push({ text: step.body, type: 'flow', meta: `se responder: ${tokens}` });
    });
    return out;
  }, [initial, stages, flowSteps]);

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
    sequence.forEach((s) => scan(s.text));
    return Array.from(set);
  }, [sequence]);

  const totalChars = sequence.reduce((a, s) => a + s.text.length, 0);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Mensagem copiada.'),
      () => toast.error('Falha ao copiar.')
    );
  };

  const tNow = new Date(campaign.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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
            <h3 className="ui-title text-[14px]">Mensagem enviada</h3>
            <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
              {sequence.length} bolha{sequence.length === 1 ? '' : 's'} • {totalChars} caracteres
              {variables.length > 0 && ` • ${variables.length} variável${variables.length > 1 ? 'eis' : ''}`}
            </p>
          </div>
        </div>

        {hasMulti && (
          <div
            className="flex text-[10.5px] rounded-lg overflow-hidden p-0.5"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
          >
            <button
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
              onClick={() => setActiveTab('flow')}
              className="px-2 py-1 font-bold transition-colors rounded-md"
              style={{
                background: activeTab === 'flow' ? 'var(--surface-0)' : 'transparent',
                color: activeTab === 'flow' ? 'var(--text-1)' : 'var(--text-3)'
              }}
            >
              Fluxo ({sequence.length})
            </button>
          </div>
        )}
      </div>

      {/* "Telinha" estilo WhatsApp */}
      <div
        className="rounded-xl p-3 space-y-2 relative overflow-y-auto flex-1"
        style={{
          background: 'linear-gradient(180deg, #0b141a 0%, #111b21 100%)',
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 2px, transparent 2px, transparent 12px)',
          minHeight: 140,
          maxHeight: 300,
          border: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        {sequence.length === 0 ? (
          <div className="text-center text-[12px] py-6" style={{ color: 'rgba(255,255,255,0.4)' }}>
            (campanha sem mensagem configurada)
          </div>
        ) : (activeTab === 'single' ? sequence.slice(0, 1) : sequence).map((s, idx) => (
          <div key={idx} className="space-y-1">
            {s.meta && (
              <div className="flex justify-center">
                <span
                  className="text-[9.5px] font-mono px-2 py-0.5 rounded-full"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    color: 'rgba(255,255,255,0.55)'
                  }}
                >
                  {s.meta}
                </span>
              </div>
            )}
            <div className="flex justify-end">
              <div
                className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm text-[12.5px] whitespace-pre-wrap leading-relaxed"
                style={{
                  background: '#005c4b',
                  color: '#e9edef',
                  boxShadow: '0 1px 1px rgba(0,0,0,0.12)'
                }}
              >
                {s.text || <span className="opacity-60 italic">(vazio)</span>}
                <div className="text-[9.5px] mt-1 opacity-70 text-right flex items-center justify-end gap-0.5 font-mono">
                  <span>{tNow}</span>
                  {s.type === 'initial' ? (
                    <CheckCheck className="w-3 h-3" style={{ color: '#53bdeb' }} />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Rodapé com variáveis + copiar */}
      <div
        className="mt-3 pt-3 flex items-center justify-between gap-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div className="flex flex-wrap gap-1 min-w-0">
          {variables.length > 0 ? (
            variables.map((v) => (
              <span
                key={v}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(59,130,246,0.12)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.25)'
                }}
              >
                {`{{${v}}}`}
              </span>
            ))
          ) : (
            <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
              Sem variáveis dinâmicas
            </span>
          )}
        </div>
        <button
          onClick={() => copy(sequence.map((s) => s.text).join('\n\n---\n\n'))}
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
