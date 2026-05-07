/** URL base da app SPA (HTTPS), usada nos links WhatsApp das pesquisas ao cliente — ver PUBLIC_APP_URL. */
export function getSurveyLinksBaseOrigin(): string {
  return (process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
}
