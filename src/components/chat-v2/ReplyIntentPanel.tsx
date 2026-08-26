import React, { useCallback, useEffect, useState } from 'react';
import { Flame, Loader2, ScanSearch, Snowflake, Sparkles, Sun, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppView } from '../../context/AppViewContext';
import type { Conversation } from '../../types';
import {
  applyLeadClassification,
  inspectReplyIntent,
  lastInboundTexts,
  phoneFromConversation,
  type LeadClassification,
  type ReplyIntentInspectResult,
} from '../../services/replyIntentApi';

const CLASS_LABEL: Record<LeadClassification, string> = {
  hot: 'Quente',
  warm: 'Morno',
  cold: 'Frio',
  blacklist: 'Lista negra',
};

const INTENT_COLOR: Record<string, string> = {
  opt_in: '#22c55e',
  opt_out: '#ef4444',
  polite_ack: '#eab308',
  flow_match: '#22c55e',
  flow_invalid: '#f97316',
  neutral: '#94a3b8',
  empty: '#64748b',
};

type Props = {
  open: boolean;
  onClose: () => void;
  conversation: Conversation;
  contactId?: string | null;
  onContactUpdated?: () => void;
};

export const ReplyIntentPanel: React.FC<Props> = ({
  open,
  onClose,
  conversation,
  contactId,
  onContactUpdated,
}) => {
  const { setCurrentView } = useAppView();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<LeadClassification | null>(null);
  const [inspect, setInspect] = useState<ReplyIntentInspectResult | null>(null);

  const runInspect = useCallback(async () => {
    const phoneDigits = phoneFromConversation(conversation);
    const connectionId = conversation.connectionId || '';
    if (!connectionId || phoneDigits.length < 8) {
      toast.error('Telefone ou canal não identificado.');
      return;
    }
    setLoading(true);
    try {
      const result = await inspectReplyIntent({
        connectionId,
        phoneDigits,
        messages: conversation.messages,
      });
      setInspect(result);
      if (result.message) toast(result.message, { icon: 'ℹ️' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao analisar resposta.');
    } finally {
      setLoading(false);
    }
  }, [conversation]);

  useEffect(() => {
    if (open) {
      void runInspect();
    } else {
      setInspect(null);
    }
  }, [open, runInspect]);

  const apply = async (classification: LeadClassification) => {
    const phoneDigits = phoneFromConversation(conversation);
    const replyText = lastInboundTexts(conversation, 1)[0] || '';
    setApplying(classification);
    try {
      await applyLeadClassification({
        contactId: contactId || inspect?.contactId || undefined,
        phoneDigits,
        connectionId: conversation.connectionId,
        classification,
        replyText,
        reprocessFlow: classification === 'hot' || classification === 'warm',
        incomingConvId: conversation.id,
      });
      toast.success(`Contato classificado como ${CLASS_LABEL[classification]}.`);
      onContactUpdated?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível aplicar.');
    } finally {
      setApplying(null);
    }
  };

  if (!open) return null;

  const latest = inspect?.results[inspect.results.length - 1];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal
      aria-labelledby="reply-intent-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#111b21] shadow-2xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 flex items-center gap-3 border-b border-white/10 px-4 py-3 bg-[#111b21]">
          <ScanSearch className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 id="reply-intent-title" className="text-sm font-semibold text-white truncate">
              Analisar intenção da resposta
            </h2>
            {inspect?.campaignName && (
              <p className="text-xs text-white/50 truncate">Campanha: {inspect.campaignName}</p>
            )}
          </div>
          <button type="button" className="wa-icon-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analisando últimas mensagens…
            </div>
          )}

          {!loading && inspect && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span
                  className="px-2 py-1 rounded-full border border-white/10"
                  style={{
                    color: inspect.hasActiveSession ? '#4ade80' : '#94a3b8',
                  }}
                >
                  {inspect.hasActiveSession ? 'Sessão de fluxo ativa' : 'Sem sessão ativa'}
                </span>
                {inspect.marketingOptIn && (
                  <span className="px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-400">
                    Opt-in registrado
                  </span>
                )}
                {inspect.marketingOptOut && (
                  <span className="px-2 py-1 rounded-full border border-red-500/30 text-red-400">
                    Lista negra
                  </span>
                )}
                {inspect.queroThenSair && (
                  <span className="px-2 py-1 rounded-full border border-red-500/40 text-red-400 bg-red-500/10">
                    Quero → sair (lista negra)
                  </span>
                )}
              </div>

              {inspect.autoApplyClass && (
                <button
                  type="button"
                  disabled={Boolean(applying)}
                  onClick={() => void apply(inspect.autoApplyClass!)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
                >
                  {applying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Aplicar automaticamente ({CLASS_LABEL[inspect.autoApplyClass]})
                </button>
              )}

              {inspect.results.length > 0 ? (
                <ul className="space-y-2">
                  {inspect.results.map((row) => (
                    <li
                      key={row.text}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                    >
                      <p className="text-sm text-white/90 truncate" title={row.text}>
                        «{row.text}»
                      </p>
                      <p
                        className="text-xs mt-1 font-medium"
                        style={{ color: INTENT_COLOR[row.intent.kind] || '#94a3b8' }}
                      >
                        {row.intent.label}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/50">Nenhuma resposta inbound recente.</p>
              )}

              {latest && (
                <p className="text-xs text-white/45">
                  Sugestão automática:{' '}
                  <strong className="text-white/70">
                    {CLASS_LABEL[latest.intent.suggestedLeadClass || inspect.suggested]}
                  </strong>
                  {' — '}
                  «amém», «tamo junto» e cortesias não contam como «quero».
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                {(
                  [
                    { id: 'hot' as const, icon: Flame, color: '#f97316' },
                    { id: 'warm' as const, icon: Sun, color: '#eab308' },
                    { id: 'cold' as const, icon: Snowflake, color: '#38bdf8' },
                    { id: 'blacklist' as const, icon: XCircle, color: '#ef4444' },
                  ] as const
                ).map(({ id, icon: Icon, color }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={Boolean(applying)}
                    onClick={() => void apply(id)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm font-medium text-white/90 hover:bg-white/5 disabled:opacity-50 transition-colors"
                    style={{ borderColor: `${color}44` }}
                  >
                    {applying === id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icon className="w-4 h-4" style={{ color }} />
                    )}
                    {CLASS_LABEL[id]}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="w-full text-xs text-emerald-400/90 hover:text-emerald-300 py-1"
                onClick={() => void runInspect()}
                disabled={loading}
              >
                Reanalisar
              </button>

              <button
                type="button"
                className="w-full text-xs text-white/45 hover:text-white/70 py-1 border-t border-white/10 mt-2 pt-2"
                onClick={() => {
                  onClose();
                  try {
                    sessionStorage.setItem('zapmass.reportsTab', 'intencoes');
                  } catch {
                    /* ignore */
                  }
                  setCurrentView('reports');
                }}
              >
                Analisar todas as conversas →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
