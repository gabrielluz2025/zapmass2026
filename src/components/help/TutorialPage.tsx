import React, { useMemo } from 'react';
import { BookOpen, Compass } from 'lucide-react';
import { marked } from 'marked';
import tutorialRaw from '../../../docs/TUTORIAL-USUARIO-ZAPMASS.md?raw';
import { useAppProfile } from '../../context/AppProfileContext';
import { getSegmentExperience } from '../../constants/segmentExperience';
import { getUseSegmentTitle } from '../../constants/useSegments';

marked.setOptions({ gfm: true, breaks: true });

export const TutorialPage: React.FC = () => {
  const { segment } = useAppProfile();
  const segmentXp = useMemo(() => getSegmentExperience(segment), [segment]);
  const segmentTitle = getUseSegmentTitle(segment);

  const html = useMemo(() => {
    try {
      return marked.parse(tutorialRaw, { async: false }) as string;
    } catch {
      return '<p>Não foi possível carregar o tutorial. Atualize a página ou contacte o suporte.</p>';
    }
  }, []);

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <div
        className="rounded-2xl p-4 sm:p-5 mb-6 flex items-start gap-3"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(59,130,246,0.06))',
          border: '1px solid rgba(16,185,129,0.28)'
        }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
            color: '#fff',
            boxShadow: '0 8px 20px -8px rgba(16,185,129,0.6)'
          }}
          aria-hidden
        >
          <BookOpen className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--brand-600)' }}>
            Centro de ajuda
          </p>
          <h2 className="text-[17px] font-bold leading-snug mt-0.5" style={{ color: 'var(--text-1)' }}>
            Tutorial do ZapMass
          </h2>
          <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Guia para quem está começando: menus, abas e boas práticas. Pode voltar ao menu lateral a qualquer momento.
          </p>
        </div>
      </div>

      <div
        className="rounded-2xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row gap-4"
        style={{
          background: 'var(--surface-0)',
          border: '1px solid var(--border)'
        }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(245,158,11,0.15)',
            color: '#d97706',
            border: '1px solid rgba(245,158,11,0.35)'
          }}
          aria-hidden
        >
          <Compass className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>
            Leitura sugerida para o seu segmento
          </p>
          <h3 className="text-[15px] font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>
            {segmentTitle}
          </h3>
          <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            O guia abaixo é o mesmo para todos; estes trechos costumam ser mais úteis primeiro no contexto{' '}
            <strong>{segmentTitle.toLowerCase()}</strong>. Pode mudar o segmento em{' '}
            <strong>Configurações → Minha conta</strong> sem perder dados.
          </p>
          <ul className="mt-3 space-y-2">
            {segmentXp.tutorialHints.map((h, i) => (
              <li key={i} className="text-[12px] leading-snug" style={{ color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--text-1)' }}>{h.title}</strong>
                <span style={{ color: 'var(--text-3)' }}> — {h.why}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <article className="zap-tutorial-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};
