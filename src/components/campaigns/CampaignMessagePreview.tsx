import React, { useMemo, useState } from 'react';
import { Copy, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { Campaign } from '../../types';
import {
  buildReplyFlowPreviewSequence,
  type ReplyFlowPreviewItem
} from '../../utils/campaignReplyFlowPreviewSequence';
import { ReplyFlowPreviewBubbleList } from './ReplyFlowPreviewBubbleList';

interface CampaignMessagePreviewProps {
  campaign: Campaign;
}

type SeqItem = ReplyFlowPreviewItem;

export const CampaignMessagePreview: React.FC<CampaignMessagePreviewProps> = ({ campaign }) => {
  const initial = campaign.message || '';
  const stages = Array.isArray(campaign.messageStages) ? campaign.messageStages : [];
  const flowSteps = campaign.replyFlow?.enabled ? campaign.replyFlow.steps || [] : [];
  const isReplyFlow = flowSteps.length > 0;

  const sequence = useMemo<SeqItem[]>(() => {
    if (isReplyFlow) {
      return buildReplyFlowPreviewSequence(flowSteps);
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
              {(() => {
                if (!isReplyFlow) return `${sequence.filter(s => s.kind === 'out').length} etapa${sequence.filter(s => s.kind === 'out').length === 1 ? '' : 's'}`;
                const totalOptions = flowSteps.reduce((acc, s) => acc + (Array.isArray((s as any).options) ? (s as any).options.length : 0), 0);
                const label = totalOptions > 0
                  ? `${flowSteps.length} etapa${flowSteps.length === 1 ? '' : 's'} • ${totalOptions} opção${totalOptions === 1 ? '' : 'ões'}`
                  : `${flowSteps.length} etapa${flowSteps.length === 1 ? '' : 's'}`;
                return label;
              })()} • {totalChars} caracteres
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

      <div className="flex-1 min-h-0 flex flex-col">
        <ReplyFlowPreviewBubbleList
          items={visible}
          time={tNow}
          maxHeight={activeTab === 'flow' && isReplyFlow ? 400 : 320}
          emptyLabel="(campanha sem mensagem configurada)"
        />
        {activeTab === 'flow' && isReplyFlow && sequence.length > 6 ? (
          <p className="text-[10px] mt-1 text-center" style={{ color: 'var(--text-3)' }}>
            Role a prévia para ver todas as opções e respostas.
          </p>
        ) : null}
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
