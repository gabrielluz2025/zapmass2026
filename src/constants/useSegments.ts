/** Texto curto: mudar segmento não apaga dados (só o doc `app_profile/main`). */
export const USE_SEGMENT_CHANGE_DATA_SAFE_SHORT =
  'Alterar o segmento só atualiza esta preferência: contatos, listas, campanhas e conexões não são apagados nem alterados.';

/** Uma linha para toasts após guardar. */
export const USE_SEGMENT_TOAST_DATA_SAFE = 'Os seus dados não são alterados.';

/** Segmento de uso (Firestore `users/{uid}/app_profile/main` → campo `useSegment`). */
export const USE_SEGMENT_IDS = [
  'religious',
  'sales',
  'collections',
  'mass_broadcast',
  'general'
] as const;

export type UseSegmentId = (typeof USE_SEGMENT_IDS)[number];

export const DEFAULT_USE_SEGMENT: UseSegmentId = 'general';

export function isValidUseSegment(v: unknown): v is UseSegmentId {
  return typeof v === 'string' && (USE_SEGMENT_IDS as readonly string[]).includes(v);
}

export interface UseSegmentOption {
  id: UseSegmentId;
  title: string;
  description: string;
}

/** Opções exibidas no onboarding e em Configurações (dono da conta). */
export const USE_SEGMENT_OPTIONS: UseSegmentOption[] = [
  {
    id: 'religious',
    title: 'Religioso',
    description: 'Comunidades, avisos de culto, grupos e pastoral.'
  },
  {
    id: 'sales',
    title: 'Vendas',
    description: 'Ofertas, follow-up com leads e relacionamento com clientes.'
  },
  {
    id: 'collections',
    title: 'Cobrança',
    description: 'Lembretes de vencimento, boletos e negociação amigável.'
  },
  {
    id: 'mass_broadcast',
    title: 'Disparo em massa',
    description: 'Comunicação ampla, avisos gerais e alto volume.'
  },
  {
    id: 'general',
    title: 'Geral / outros',
    description: 'Uso misto ou segmento que ainda não está na lista.'
  }
];

export function getUseSegmentTitle(id: UseSegmentId): string {
  return USE_SEGMENT_OPTIONS.find((o) => o.id === id)?.title ?? id;
}
