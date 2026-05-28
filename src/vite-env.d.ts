/// <reference types="vite/client" />

declare module '*.md?raw' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_MARKETING_PRICE_MONTHLY?: string;
  readonly VITE_MARKETING_PRICE_ANNUAL?: string;
  readonly VITE_ENFORCE_SUBSCRIPTION?: string;
  /** Lista separada por virgula; mesmo e-mail deve estar em ADMIN_EMAILS no servidor para gravar appConfig. */
  readonly VITE_ADMIN_EMAILS?: string;
  /** UIDs Firebase (plataforma admin); espelhar ZAPMASS_ADMIN_UIDS no servidor. */
  readonly VITE_ZAPMASS_ADMIN_UIDS?: string;
  /** Alias legado; preferir VITE_ZAPMASS_ADMIN_UIDS. */
  readonly VITE_ADMIN_UIDS?: string;
  /**
   * Modo estudio (BAT de desenvolvimento). Ativa menu "Estudio criador" junto com VITE_ADMIN_EMAILS.
   * Nao use em build de producao para clientes.
   */
  readonly VITE_CREATOR_STUDIO?: string;
  /** Commit enxertado no build (VPS: export VITE_GIT_REF antes do docker compose; local: git). */
  readonly VITE_GIT_REF?: string;
  /** Google Analytics 4 — Measurement ID (ex.: G-XXXXXXXXXX). Opcional; sem isto os eventos só vigoram se outro snippet definir gtag/dataLayer. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /**
   * Origem do backend Node (REST + Socket.IO), sem barra final — ex.: https://api.seudominio.com
   * Obrigatório se o front estiver noutro domínio (Firebase Hosting, CDN) que não sirva /api.
   */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
