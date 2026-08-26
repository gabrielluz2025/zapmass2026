export { EVOLUTION_GO_PARITY_MATRIX, paritySummaryForGo } from './parityMatrix.js';
export { normalizeEvolutionGoWebhookIfNeeded } from './evolutionGoWebhookAdapter.js';
export type { ParityRow, ParityStatus } from './parityMatrix.js';
export { createEvolutionHttpClient } from './createEvolutionHttpClient.js';
export type { InstanceTokenStore } from './createEvolutionHttpClient.js';
export { extractInstanceIdFromApiPath, adaptEvolutionApiRequestToGo } from './goRouteAdapter.js';
