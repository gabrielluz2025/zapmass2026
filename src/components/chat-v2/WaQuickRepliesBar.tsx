import React from 'react';
import { Settings2 } from 'lucide-react';
import { loadChatQuickReplies, type ChatQuickReply } from '../../utils/chatQuickReplies';

type Props = {
  onPick: (text: string) => void;
  onManage?: () => void;
  maxVisible?: number;
};

export const WaQuickRepliesBar: React.FC<Props> = ({ onPick, onManage, maxVisible = 8 }) => {
  const items: ChatQuickReply[] = loadChatQuickReplies().slice(0, maxVisible);

  if (items.length === 0) return null;

  return (
    <div className="wa-quick-replies">
      {items.map((qr, i) => (
        <button
          key={`${qr.text}-${i}`}
          type="button"
          className="wa-quick-replies__chip"
          title={qr.text}
          onClick={() => onPick(qr.text)}
        >
          <span aria-hidden>{qr.emoji}</span>
          <span className="truncate max-w-[140px]">{qr.text}</span>
        </button>
      ))}
      {onManage && (
        <button type="button" className="wa-quick-replies__manage" onClick={onManage} title="Gerenciar respostas rápidas">
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
