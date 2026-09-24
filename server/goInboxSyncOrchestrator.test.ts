import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildInboxSyncPolicy,
  enqueueAutomatedPhoneFullSync,
  getInboxSyncQueueDepth,
  handleOwnerInboxSyncRequest,
  notifyCampaignBlocking,
  registerInboxSyncExecutor,
} from './goInboxSyncOrchestrator.js';

describe('goInboxSyncOrchestrator', () => {
  beforeEach(() => {
    registerInboxSyncExecutor({
      reemitLight: vi.fn(async () => undefined),
      syncFromPhone: vi.fn(async () => undefined),
      isCampaignBlocking: (uid) => uid === 'blocked-tenant',
      publishPolicy: vi.fn(),
    });
  });

  it('enfileira phone_full automático', () => {
    enqueueAutomatedPhoneFullSync('t1', 'sparse_recovery');
    expect(getInboxSyncQueueDepth('t1')).toBe(1);
  });

  it('socket full com campanha faz light + fila', async () => {
    const ex = {
      reemitLight: vi.fn(async () => undefined),
      syncFromPhone: vi.fn(async () => undefined),
      isCampaignBlocking: () => true,
      publishPolicy: vi.fn(),
    };
    registerInboxSyncExecutor(ex);
    await handleOwnerInboxSyncRequest('blocked-tenant', true);
    expect(ex.reemitLight).toHaveBeenCalled();
    expect(ex.syncFromPhone).not.toHaveBeenCalled();
    expect(getInboxSyncQueueDepth('blocked-tenant')).toBe(1);
  });

  it('policy reflete campanha', () => {
    registerInboxSyncExecutor({
      reemitLight: vi.fn(),
      syncFromPhone: vi.fn(),
      isCampaignBlocking: () => true,
      publishPolicy: vi.fn(),
    });
    enqueueAutomatedPhoneFullSync('x', 'test');
    const p = buildInboxSyncPolicy('x');
    expect(p.phoneFullBlocked).toBe(true);
    expect(p.blockReason).toBe('campaign');
    expect(p.pendingPhoneFull).toBe(true);
  });

  it('notifyCampaignBlocking dispara publish', () => {
    const publishPolicy = vi.fn();
    registerInboxSyncExecutor({
      reemitLight: vi.fn(),
      syncFromPhone: vi.fn(),
      isCampaignBlocking: () => false,
      publishPolicy,
    });
    notifyCampaignBlocking('t2', false);
    expect(publishPolicy).toHaveBeenCalled();
  });
});
