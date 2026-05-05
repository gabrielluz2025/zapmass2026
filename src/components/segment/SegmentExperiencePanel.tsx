import React, { useMemo } from 'react';
import { BookOpen, Lightbulb, Navigation } from 'lucide-react';
import { useAppProfile } from '../../context/AppProfileContext';
import { useAppView } from '../../context/AppViewContext';
import { getSegmentExperience } from '../../constants/segmentExperience';
import { getUseSegmentTitle } from '../../constants/useSegments';
import { Card } from '../ui';

/**
 * Painel contextual por segmento: dicas e atalhos de navegação.
 * Usado no Dashboard; não altera dados nem assinatura.
 */
export const SegmentExperiencePanel: React.FC = () => {
  const { segment } = useAppProfile();
  const { setCurrentView } = useAppView();
  const xp = useMemo(() => getSegmentExperience(segment), [segment]);
  const title = getUseSegmentTitle(segment);

  return (
    <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(16,185,129,0.14)', color: 'var(--brand-600)' }}
          >
            <Lightbulb className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Dicas para o seu segmento
            </p>
            <p className="text-[15px] font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>
              {title}
            </p>
          </div>
        </div>
        <ul className="space-y-2.5">
          {xp.dashboardTips.map((tip, i) => (
            <li
              key={i}
              className="text-[12.5px] leading-relaxed pl-3 border-l-2"
              style={{ borderColor: 'rgba(16,185,129,0.45)', color: 'var(--text-2)' }}
            >
              {tip}
            </li>
          ))}
        </ul>

        {xp.suggestedNav.length > 0 && (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[10.5px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
              <Navigation className="w-3.5 h-3.5" />
              Atalhos sugeridos
            </p>
            <div className="flex flex-wrap gap-2">
              {xp.suggestedNav.map((n) => (
                <button
                  key={n.view}
                  type="button"
                  onClick={() => setCurrentView(n.view)}
                  className="text-left rounded-xl px-3 py-2 text-[12px] font-semibold transition-all hover:-translate-y-0.5"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-1)'
                  }}
                  title={n.hint}
                >
                  <span className="block">{n.label}</span>
                  <span className="block text-[10.5px] font-normal mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {n.hint}
                  </span>
                </button>
              ))}
              {!xp.suggestedNav.some((n) => n.view === 'help') && (
                <button
                  type="button"
                  onClick={() => setCurrentView('help')}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition-all hover:-translate-y-0.5"
                  style={{
                    background: 'rgba(59,130,246,0.1)',
                    border: '1px solid rgba(59,130,246,0.28)',
                    color: 'var(--text-1)'
                  }}
                >
                  <BookOpen className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                  Tutorial completo
                </button>
              )}
            </div>
          </div>
        )}
    </Card>
  );
};
