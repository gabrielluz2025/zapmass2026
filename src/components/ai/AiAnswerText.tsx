import React from 'react';

/** Renderiza resposta da IA com negrito **texto** e quebras de linha. */
export const AiAnswerText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  return (
    <div className="zm-ai-answer-text">
      {lines.map((line, li) => {
        const trimmed = line.trim();
        if (!trimmed) return <br key={`br-${li}`} />;
        const isBullet = /^[-•*]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed);
        const content = trimmed.replace(/^[-•*]\s/, '').replace(/^\d+[.)]\s/, '');
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        const inner = parts.map((part, pi) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={pi} className="zm-ai-answer-text__strong">
                {part.slice(2, -2)}
              </strong>
            );
          }
          return <React.Fragment key={pi}>{part}</React.Fragment>;
        });
        if (isBullet) {
          return (
            <p key={li} className="zm-ai-answer-text__bullet">
              <span className="zm-ai-answer-text__dot" aria-hidden>
                •
              </span>
              <span>{inner}</span>
            </p>
          );
        }
        return (
          <p key={li} className="zm-ai-answer-text__para">
            {inner}
          </p>
        );
      })}
    </div>
  );
};
