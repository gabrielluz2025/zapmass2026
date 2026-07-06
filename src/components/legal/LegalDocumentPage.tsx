import React, { useMemo } from 'react';
import { marked } from 'marked';
import { ArrowLeft, FileText, Loader2, Shield } from 'lucide-react';
import { usePlatformInfo } from '../../hooks/usePlatformInfo';
import { applyLegalPlaceholders } from './legalPlaceholders';
import type { LegalPageSlug } from '../../utils/readPublicLegalPageFromWindow';
import { applyMode, applyTheme, getSavedMode, getSavedTheme } from '../../theme';
import termosRaw from '../../../docs/legal/termos-de-uso.md?raw';
import privacidadeRaw from '../../../docs/legal/politica-privacidade.md?raw';

marked.setOptions({ gfm: true, breaks: true });

const META: Record<
  LegalPageSlug,
  { title: string; icon: React.ReactNode; raw: string }
> = {
  termos: {
    title: 'Termos de Uso',
    icon: <FileText className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />,
    raw: termosRaw,
  },
  privacidade: {
    title: 'Política de Privacidade',
    icon: <Shield className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />,
    raw: privacidadeRaw,
  },
};

type Props = {
  slug: LegalPageSlug;
};

/** Página pública — `/termos` ou `/privacidade` (sem login). */
export const LegalDocumentPage: React.FC<Props> = ({ slug }) => {
  const { info, loading } = usePlatformInfo();
  const meta = META[slug];

  React.useEffect(() => {
    applyTheme(getSavedTheme());
    applyMode(getSavedMode());
    document.title = `${meta.title} — ${info?.productName || 'ZapMass'}`;
  }, [meta.title, info?.productName]);

  const html = useMemo(() => {
    try {
      const md = applyLegalPlaceholders(meta.raw, info);
      return marked.parse(md, { async: false }) as string;
    } catch {
      return '<p>Não foi possível carregar o documento.</p>';
    }
  }, [meta.raw, info]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <header
        className="sticky top-0 z-10 border-b px-4 py-3 flex items-center justify-between gap-3"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {meta.icon}
          <h1 className="text-[15px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {meta.title}
          </h1>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold shrink-0 hover:underline"
          style={{ color: 'var(--brand-600)' }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar ao login
        </a>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">
        {loading && !info ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-3)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando…
          </div>
        ) : null}
        <article className="zap-tutorial-prose zap-legal-prose" dangerouslySetInnerHTML={{ __html: html }} />
        <p className="mt-10 text-[11px] text-center" style={{ color: 'var(--text-3)' }}>
          {slug === 'termos' ? (
            <>
              Leia também a{' '}
              <a href="/privacidade" className="underline" style={{ color: 'var(--brand-600)' }}>
                Política de Privacidade
              </a>
            </>
          ) : (
            <>
              Leia também os{' '}
              <a href="/termos" className="underline" style={{ color: 'var(--brand-600)' }}>
                Termos de Uso
              </a>
            </>
          )}
        </p>
      </main>
    </div>
  );
};
