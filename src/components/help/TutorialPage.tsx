import React, { useMemo } from 'react';
import { marked } from 'marked';
import tutorialRaw from '../../../docs/TUTORIAL-USUARIO-ZAPMASS.md?raw';
import { useAppProfile } from '../../context/AppProfileContext';
import { getSegmentExperience } from '../../constants/segmentExperience';
import { getUseSegmentTitle } from '../../constants/useSegments';
import { PageShell, CollapsibleSection, Badge } from '../ui';

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
    <PageShell
      statusStrip={
        <>
          <Badge variant="info">Tutorial</Badge>
          <span className="ui-caption">{segmentTitle}</span>
        </>
      }
    >
    <div className="max-w-3xl mx-auto pb-16">
      <CollapsibleSection title="Dicas para o seu segmento" summary={segmentTitle} defaultOpen={false}>
        <ul className="space-y-2">
          {segmentXp.tutorialHints.map((h, i) => (
            <li key={i} className="ui-caption">
              <strong className="ui-body">{h.title}</strong>
              <span> — {h.why}</span>
            </li>
          ))}
        </ul>
        <p className="ui-caption mt-3">
          Mude o segmento em <strong>Configurações → Minha conta</strong> sem perder dados.
        </p>
      </CollapsibleSection>

      <article className="zap-tutorial-prose mt-4" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
    </PageShell>
  );
};
