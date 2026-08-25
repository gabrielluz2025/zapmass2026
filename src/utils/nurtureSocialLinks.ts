export type NurtureSocialLinks = {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  tiktok?: string;
  linkedin?: string;
  website?: string;
};

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

export function hasNurtureSocialLinks(links?: NurtureSocialLinks | null): boolean {
  if (!links) return false;
  return Object.values(links).some((v) => String(v ?? '').trim().length > 0);
}
