export type GeolocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function queryGeolocationPermission(): Promise<GeolocationPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  const perms = navigator.permissions;
  if (!perms?.query) return 'prompt';
  try {
    const status = await perms.query({ name: 'geolocation' });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
  } catch {
    /* Safari / browsers antigos */
  }
  return 'prompt';
}

export function geolocationPermissionDeniedMessage(): string {
  return (
    'Localização bloqueada no navegador. Clique no ícone ao lado do endereço (cadeado ou ⓘ) → ' +
    'Permissões → Localização → Permitir. Ou digite a cidade manualmente no campo ao lado.'
  );
}

export function describeGeolocationError(error: unknown): string {
  if (error instanceof GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) {
      return geolocationPermissionDeniedMessage();
    }
    if (error.code === error.TIMEOUT) {
      return 'Tempo esgotado ao obter GPS. Tente de novo ou informe a cidade manualmente.';
    }
    return 'Não foi possível obter sua localização. Informe a cidade manualmente.';
  }
  if (error instanceof Error) return error.message;
  return 'Falha ao usar GPS. Informe a cidade manualmente.';
}

/**
 * Deve ser chamado de forma síncrona no handler de clique — o prompt do navegador
 * só aparece se getCurrentPosition rodar ainda dentro do gesto do usuário.
 */
export function requestBrowserGeolocation(options?: {
  enableHighAccuracy?: boolean;
  timeout?: number;
}): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocalização não disponível neste navegador.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: options?.enableHighAccuracy ?? true,
      timeout: options?.timeout ?? 20_000,
      maximumAge: 120_000
    });
  });
}

/** @deprecated use requestBrowserGeolocation — mantido para imports antigos */
export const readBrowserGeolocation = requestBrowserGeolocation;
