import { useEffect } from 'react';
import { LANDING_DOCUMENT_TITLE, LANDING_META_DESCRIPTION } from '../constants/landingSeo';

function ensureMeta(attr: 'name' | 'property', key: string, content: string): () => void {
  const sel = attr === 'name' ? `meta[name="${key}"]` : `meta[property="${key}"]`;
  let el = document.head.querySelector(sel) as HTMLMetaElement | null;
  const hadEl = !!el;
  const prev = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr === 'name' ? 'name' : 'property', key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (!hadEl) {
      el?.remove();
    } else if (prev === null) {
      el?.removeAttribute('content');
    } else {
      el?.setAttribute('content', prev);
    }
  };
}

/** Atualiza title e meta tags para visitantes na pré-login; restaura ao desmontar (ex.: após login). */
export function useLandingDocumentMeta(): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = LANDING_DOCUMENT_TITLE;

    const undo: (() => void)[] = [];
    undo.push(ensureMeta('name', 'description', LANDING_META_DESCRIPTION));
    undo.push(ensureMeta('property', 'og:title', LANDING_DOCUMENT_TITLE));
    undo.push(ensureMeta('property', 'og:description', LANDING_META_DESCRIPTION));
    undo.push(ensureMeta('property', 'og:type', 'website'));
    const url = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
    undo.push(ensureMeta('property', 'og:url', url));
    undo.push(ensureMeta('name', 'twitter:card', 'summary_large_image'));
    undo.push(ensureMeta('name', 'twitter:title', LANDING_DOCUMENT_TITLE));
    undo.push(ensureMeta('name', 'twitter:description', LANDING_META_DESCRIPTION));

    return () => {
      document.title = prevTitle;
      undo.forEach((u) => u());
    };
  }, []);
}
