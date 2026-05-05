/** Carrega gtag.js quando `VITE_GA_MEASUREMENT_ID` está definido no build (ex.: G-XXXXXXXXXX). */

const BOOT_KEY = '__zapmassGtagBootstrap';

function isLikelyGaMeasurementId(id: string): boolean {
  return /^G-[A-Z0-9]+$/i.test(id.trim());
}

export function bootstrapGoogleAnalytics(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const raw = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || !isLikelyGaMeasurementId(id)) return;
  const w = window as Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  if ((w as unknown as Record<string, unknown>)[BOOT_KEY]) return;
  (w as unknown as Record<string, unknown>)[BOOT_KEY] = true;

  w.dataLayer = w.dataLayer ?? [];
  const dl = w.dataLayer;
  const gtag = (...args: unknown[]) => {
    dl.push(args);
  };
  w.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

bootstrapGoogleAnalytics();
