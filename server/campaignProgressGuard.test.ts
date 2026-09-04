import { describe, expect, it } from 'vitest';
import {
  countersFromCampaignDoc,
  countersFromJobStatusCounts,
  mergeCampaignCounterTriple,
  pickCampaignProgressToPersist,
} from './campaignProgressGuard.js';

describe('campaignProgressGuard', () => {
  it('converte jobs sent/failed/dead em contadores do card', () => {
    expect(
      countersFromJobStatusCounts({ sent: 1200, failed: 30, dead: 5, pending: 47000, sending: 2 })
    ).toEqual({
      successCount: 1200,
      failedCount: 35,
      processedCount: 1237,
    });
  });

  it('nunca deixa startCampaign gravar 0,0,0 por cima de progresso real', () => {
    const kept = pickCampaignProgressToPersist(
      { successCount: 1200, failedCount: 40, processedCount: 1240 },
      { successCount: 0, failedCount: 0, processedCount: 0 }
    );
    expect(kept).toEqual({
      successCount: 1200,
      failedCount: 40,
      processedCount: 1240,
    });
  });

  it('sobe o card quando os jobs no PG estão à frente do documento', () => {
    const merged = mergeCampaignCounterTriple(
      countersFromCampaignDoc({ successCount: 1, failedCount: 4, processedCount: 5 }),
      countersFromJobStatusCounts({ sent: 800, failed: 20 })
    );
    expect(merged.successCount).toBe(800);
    expect(merged.failedCount).toBe(20);
    expect(merged.processedCount).toBe(820);
  });
});
