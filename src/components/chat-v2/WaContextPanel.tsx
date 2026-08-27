import React, { useMemo, useState } from 'react';
import {
  Archive,
  Clock,
  Download,
  Megaphone,
  Pin,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import type { Conversation } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { ClientCrmPanel } from '../chat/ClientCrmPanel';
import type { ClientCrmData } from '../chat/useClientCrm';
import type { getConversationPipelineAgg } from './lib/chatPreview';

type PipelineAgg = NonNullable<ReturnType<typeof getConversationPipelineAgg>>;
import { aiAsk } from '../../services/aiApi';
import toast from 'react-hot-toast';

type Tab = 'contact' | 'conversation' | 'actions';

type Props = {
  conversation: Conversation;
  display: ConversationDisplay | null;
  avatarSrc: string;
  connectionName?: string;
  crmData?: ClientCrmData;
  pipelineAgg?: PipelineAgg | null;
  displayTitle: string;
  onClose?: () => void;
  onUpdateCrm: (patch: Partial<ClientCrmData>) => void;
  onClearCrm: () => void;
  onExport: () => void;
  onAnalyzeIntent: () => void;
  onPin: () => void;
  onArchive: () => void;
  onSnooze: (hours: number) => void;
  onSchedule: () => void;
  isPinned: boolean;
  isArchived: boolean;
  onSearchInThread: () => void;
  hideOnMobile?: boolean;
};

export const WaContextPanel: React.FC<Props> = ({
  conversation,
  display,
  avatarSrc,
  connectionName,
  crmData,
  pipelineAgg,
  displayTitle,
  onClose,
  onUpdateCrm,
  onClearCrm,
  onExport,
  onAnalyzeIntent,
  onPin,
  onArchive,
  onSnooze,
  onSchedule,
  isPinned,
  isArchived,
  onSearchInThread,
  hideOnMobile,
}) => {
  const [tab, setTab] = useState<Tab>('contact');
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);

  const mediaItems = useMemo(() => {
    return (conversation.messages || []).filter(
      (m) => m.type && m.type !== 'text' && m.type !== 'sticker'
    );
  }, [conversation.messages]);

  const handleSummary = async () => {
    setSummaryLoading(true);
    try {
      const msgs = (conversation.messages || []).slice(-40).map((m) => ({
        sender: m.sender === 'me' ? 'atendente' : 'cliente',
        text: m.text || `[${m.type}]`,
      }));
      const res = await aiAsk(
        'chat',
        'Resuma esta conversa de WhatsApp em até 4 bullets curtos em português. Foque em pedidos, objeções e próximo passo.',
        { messages: msgs }
      );
      if (res.ok && res.answer) setSummary(res.answer);
      else toast.error(res.error || 'Não foi possível resumir.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao resumir.');
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <aside
      className="wa-context-panel flex flex-col min-h-0"
      data-hide-mobile={hideOnMobile ? 'true' : undefined}
    >
      <header className="wa-context-panel__head">
        <div className="wa-context-panel__tabs">
          {(
            [
              ['contact', 'Contato', User],
              ['conversation', 'Chat', Search],
              ['actions', 'Ações', Sparkles],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className="wa-context-panel__tab"
              data-active={tab === id ? 'true' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className="wa-icon-btn md:hidden" onClick={onClose} aria-label="Fechar painel">
            <X className="w-5 h-5" />
          </button>
        )}
      </header>

      <div className="wa-context-panel__body flex-1 min-h-0 overflow-y-auto">
        {tab === 'contact' && (
          <ClientCrmPanel
            conversation={conversation}
            connectionName={connectionName}
            avatar={avatarSrc}
            crmData={crmData}
            pipelineAgg={pipelineAgg ?? undefined}
            displayTitle={displayTitle}
            whatsappAlias={display?.whatsappSubtitle}
            onClose={onClose}
            onUpdate={onUpdateCrm}
            onClear={onClearCrm}
          />
        )}

        {tab === 'conversation' && (
          <div className="wa-context-panel__section">
            <button type="button" className="wa-context-action" onClick={onSearchInThread}>
              <Search className="w-4 h-4" /> Buscar na conversa <kbd>Ctrl+F</kbd>
            </button>
            <button type="button" className="wa-context-action" onClick={onExport}>
              <Download className="w-4 h-4" /> Exportar .txt
            </button>
            <div className="wa-context-panel__block">
              <p className="wa-context-panel__label">Resumo IA</p>
              <button
                type="button"
                className="wa-context-action"
                disabled={summaryLoading}
                onClick={() => void handleSummary()}
              >
                <Sparkles className="w-4 h-4" />
                {summaryLoading ? 'Gerando…' : 'Gerar resumo'}
              </button>
              {summary && (
                <pre className="wa-context-summary whitespace-pre-wrap">{summary}</pre>
              )}
            </div>
            <div className="wa-context-panel__block">
              <p className="wa-context-panel__label">Mídia ({mediaItems.length})</p>
              <div className="wa-context-media-grid">
                {mediaItems.slice(-24).reverse().map((m) => (
                  <div key={m.id} className="wa-context-media-thumb" title={m.text || m.type}>
                    {m.mediaUrl && m.type === 'image' ? (
                      <img src={m.mediaUrl} alt="" />
                    ) : (
                      <span className="text-[10px] uppercase">{m.type}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'actions' && (
          <div className="wa-context-panel__section">
            <button type="button" className="wa-context-action" onClick={onPin}>
              <Pin className="w-4 h-4" /> {isPinned ? 'Desafixar' : 'Fixar conversa'}
            </button>
            <button type="button" className="wa-context-action" onClick={onArchive}>
              <Archive className="w-4 h-4" /> {isArchived ? 'Desarquivar' : 'Arquivar'}
            </button>
            <button type="button" className="wa-context-action" onClick={() => onSnooze(1)}>
              <Clock className="w-4 h-4" /> Adiar 1 hora
            </button>
            <button type="button" className="wa-context-action" onClick={() => onSnooze(24)}>
              <Clock className="w-4 h-4" /> Adiar 24 horas
            </button>
            <button type="button" className="wa-context-action" onClick={onSchedule}>
              <Clock className="w-4 h-4" /> Agendar mensagem
            </button>
            <button type="button" className="wa-context-action" onClick={onAnalyzeIntent}>
              <Megaphone className="w-4 h-4" /> Analisar intenção (quente/frio)
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
