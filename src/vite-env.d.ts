/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MARKETING_PRICE_MONTHLY?: string;
  readonly VITE_MARKETING_PRICE_ANNUAL?: string;
  readonly VITE_ENFORCE_SUBSCRIPTION?: string;
  /** Lista separada por virgula; mesmo e-mail deve estar em ADMIN_EMAILS no servidor para gravar appConfig. */
  readonly VITE_ADMIN_EMAILS?: string;
  /**
   * Modo estudio (BAT de desenvolvimento). Ativa menu "Estudio criador" junto com VITE_ADMIN_EMAILS.
   * Nao use em build de producao para clientes.
   */
  readonly VITE_CREATOR_STUDIO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
