import React, { useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { marked } from 'marked';
import tutorialRaw from '../../../docs/TUTORIAL-USUARIO-ZAPMASS.md?raw';

marked.setOptions({ gfm: true, breaks: true });

export const TutorialPage: React.FC = () => {
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

      <article className="zap-tutorial-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};
