/** Coordenadas por CEP via BrasilAPI v2 (gratuito, sem chave). */

export type BrasilApiCepHit = {
  lat: number;
  lng: number;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
};

export async function geocodeByCepBrasilApi(cep: string): Promise<BrasilApiCepHit | null> {
  const digits = String(cep || '').replace(/\D/g, '');
  if (digits.length !== 8) return null;

  try {
    const r = await fetch(`https://brasilapi.com.br/api/v2/cep/${digits}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000)
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      street?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      location?: { coordinates?: { latitude?: string | number; longitude?: string | number } };
    };
    const lat = Number(j.location?.coordinates?.latitude);
    const lng = Number(j.location?.coordinates?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      street: typeof j.street === 'string' ? j.street : undefined,
      neighborhood: typeof j.neighborhood === 'string' ? j.neighborhood : undefined,
      city: typeof j.city === 'string' ? j.city : undefined,
      state: typeof j.state === 'string' ? j.state : undefined
    };
  } catch {
    return null;
  }
}
