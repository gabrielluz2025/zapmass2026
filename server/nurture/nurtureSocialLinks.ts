import type { NurtureSocialLinks } from './nurtureTypes.js';

const LABELS: Record<keyof NurtureSocialLinks, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  website: 'Site'
};

export function formatNurtureSocialLinks(links?: NurtureSocialLinks | null): string {
  if (!links) return '';
  const lines: string[] = [];
  for (const key of Object.keys(LABELS) as (keyof NurtureSocialLinks)[]) {
    const url = String(links[key] ?? '').trim();
    if (url) lines.push(`${LABELS[key]}: ${url}`);
  }
  if (lines.length === 0) return '';
  return `📱 Nossas redes:\n${lines.join('\n')}`;
}

export function sanitizeSocialLinks(raw: unknown): NurtureSocialLinks | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const pick = (k: keyof NurtureSocialLinks) => {
    const v = String(o[k] ?? '').trim().slice(0, 512);
    return v || undefined;
  };
  const links: NurtureSocialLinks = {
    instagram: pick('instagram'),
    facebook: pick('facebook'),
    youtube: pick('youtube'),
    tiktok: pick('tiktok'),
    linkedin: pick('linkedin'),
    website: pick('website')
  };
  const hasAny = Object.values(links).some(Boolean);
  return hasAny ? links : undefined;
}
