import React, { useMemo, useState } from 'react';
import { Button, Modal } from '../ui';
import type { Conversation } from '../../types';
import type { ConversationDisplay } from './lib/conversationDisplay';
import { inboxListTitle } from './lib/conversationDisplay';

type Props = {
  open: boolean;
  messageText: string;
  conversations: Conversation[];
  displayById: Map<string, ConversationDisplay>;
  excludeId?: string;
  onClose: () => void;
  onForward: (targetConversationId: string, text: string) => void;
};

export const WaForwardModal: React.FC<Props> = ({
  open,
  messageText,
  conversations,
  displayById,
  excludeId,
  onClose,
  onForward,
}) => {
  const [q, setQ] = useState('');
  const [target, setTarget] = useState('');

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return conversations
      .filter((c) => c.id !== excludeId)
      .filter((c) => {
        if (!qq) return true;
        const d = displayById.get(c.id);
        const title = inboxListTitle(d, c).toLowerCase();
        return title.includes(qq) || (c.contactPhone || '').includes(qq);
      })
      .slice(0, 80);
  }, [conversations, displayById, excludeId, q]);

  return (
    <Modal isOpen={open} onClose={onClose} title="Encaminhar mensagem" size="sm">
      <p className="text-[12px] mb-2 opacity-80 line-clamp-3">{messageText || '[mídia]'}</p>
      <input
        className="ui-input w-full text-[13px] mb-2"
        placeholder="Buscar contato…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="max-h-48 overflow-y-auto border rounded-lg" style={{ borderColor: 'var(--wa-border)' }}>
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            className="w-full text-left px-3 py-2 text-[13px] hover:bg-black/5"
            data-active={target === c.id ? 'true' : undefined}
            onClick={() => setTarget(c.id)}
          >
            {inboxListTitle(displayById.get(c.id), c)}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!target}
          onClick={() => {
            onForward(target, messageText);
            onClose();
          }}
        >
          Encaminhar
        </Button>
      </div>
    </Modal>
  );
};

type ScheduleProps = {
  open: boolean;
  defaultText?: string;
  onClose: () => void;
  onConfirm: (text: string, sendAt: number) => void;
};

export const WaScheduleModal: React.FC<ScheduleProps> = ({
  open,
  defaultText = '',
  onClose,
  onConfirm,
}) => {
  const [text, setText] = useState(defaultText);
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  });

  React.useEffect(() => {
    if (open) setText(defaultText);
  }, [open, defaultText]);

  return (
    <Modal isOpen={open} onClose={onClose} title="Agendar mensagem" size="sm">
      <textarea
        className="ui-input w-full text-[13px] min-h-[80px] mb-3"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Texto a enviar…"
      />
      <label className="text-[12px] block mb-1 opacity-80">Enviar em</label>
      <input
        type="datetime-local"
        className="ui-input w-full text-[13px]"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
      />
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!text.trim()}
          onClick={() => {
            const ms = new Date(when).getTime();
            if (!Number.isFinite(ms) || ms <= Date.now()) return;
            onConfirm(text.trim(), ms);
            onClose();
          }}
        >
          Agendar
        </Button>
      </div>
    </Modal>
  );
};
