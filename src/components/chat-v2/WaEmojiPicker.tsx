import React, { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';

const GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Mais usados', emojis: ['😊', '😂', '❤️', '👍', '🙏', '😍', '🔥', '😭', '😘', '🥰', '😁', '🤣', '💕', '😅', '👏', '🎉', '💪', '✨', '😎', '🤗'] },
  { label: 'Rostos', emojis: ['😀', '😃', '😄', '😁', '😆', '🥹', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😎', '🥳', '😔', '😴', '🤔', '😐', '🙄'] },
  { label: 'Gestos', emojis: ['👋', '🤚', '👌', '✌️', '🤞', '🤙', '👍', '👎', '✊', '👏', '🙌', '🙏'] },
  { label: 'Objetos', emojis: ['💬', '💡', '🔔', '📱', '📷', '📞', '📝', '📋', '📌'] },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
};

export const WaEmojiPicker: React.FC<Props> = ({ open, onClose, onPick }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={ref} className="wa-emoji-picker" role="dialog" aria-label="Emojis">
      <div className="wa-emoji-picker__head">
        <Smile className="w-4 h-4" style={{ color: 'var(--wa-text-2)' }} />
        <span>Emojis</span>
      </div>
      {GROUPS.map((g) => (
        <div key={g.label} className="wa-emoji-picker__group">
          <p className="wa-emoji-picker__label">{g.label}</p>
          <div className="wa-emoji-picker__grid">
            {g.emojis.map((emoji) => (
              <button
                key={`${g.label}-${emoji}`}
                type="button"
                className="wa-emoji-picker__btn"
                onClick={() => {
                  onPick(emoji);
                  onClose();
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
