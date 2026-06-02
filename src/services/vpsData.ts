/** Dados de negócio na VPS (Postgres) em vez de Firestore no browser. */
export function useVpsData(): boolean {
  return (
    import.meta.env.VITE_USE_VPS_DATA === 'true' || import.meta.env.VITE_USE_VPS_AUTH === 'true'
  );
}
