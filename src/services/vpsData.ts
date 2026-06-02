/** Padrão: dados Postgres. Desligar só com VITE_USE_VPS_DATA=false no build/.env. */
export function useVpsData(): boolean {
  return import.meta.env.VITE_USE_VPS_DATA !== 'false';
}
