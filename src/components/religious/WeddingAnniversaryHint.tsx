import React from 'react';
import {
  daysUntilWeddingAnniversary,
  parseWeddingDayMonth,
  weddingNextOccurrence,
  yearsCelebratingAtNextAnniversary
} from '../../utils/weddingAnniversary';

/** Resumo automático: próxima data de bodas, anos de casados (se houver ano no cadastro) e dias restantes. */
export const WeddingAnniversaryHint: React.FC<{ weddingDate: string }> = ({ weddingDate }) => {
  const md = parseWeddingDayMonth(weddingDate);
  if (!md) return null;
  const days = daysUntilWeddingAnniversary(md);
  const years = yearsCelebratingAtNextAnniversary(md);
  const next = weddingNextOccurrence(md);
  const nextStr = next.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  return (
    <p
      className="text-[11px] mt-1.5 leading-snug rounded-lg px-2 py-1.5 bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700"
      style={{ color: 'var(--text-3)' }}
    >
      {years != null ? (
        <>
          Próxima bodas: <strong style={{ color: 'var(--text-2)' }}>{nextStr}</strong> — completam{' '}
          <strong>{years} anos</strong> de casados daqui a <strong>{days}</strong> dia(s).
        </>
      ) : (
        <>
          Lembrete anual neste dia/mês. Próxima celebração: <strong>{nextStr}</strong> (em <strong>{days}</strong>{' '}
          dia(s)). Inclua o <strong>ano do casamento</strong> na data para o sistema calcular os anos de casados.
        </>
      )}
    </p>
  );
};
