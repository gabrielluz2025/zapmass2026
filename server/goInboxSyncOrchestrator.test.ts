import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildInboxSyncPolicy,
  emitInboxSyncPolicyForOwner,
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

  it('policy reflete proteção de chip (cache)', async () => {
    registerInboxSyncExecutor({
      reemitLight: vi.fn(),
      syncFromPhone: vi.fn(),
      isCampaignBlocking: () => false,
      isChipProtectionBlocking: async () => true,
      publishPolicy: vi.fn(),
    });
    await emitInboxSyncPolicyForOwner('chip-quiet');
    const p = buildInboxSyncPolicy('chip-quiet');
    expect(p.phoneFullBlocked).toBe(true);
    expect(p.blockReason).toBe('chip_protection');
  });

  it('socket full com proteção de chip ainda enfileira sync (userInitiated)', async () => {
    const ex = {
      reemitLight: vi.fn(async () => undefined),
      syncFromPhone: vi.fn(async () => undefined),
      isCampaignBlocking: () => false,
      isChipProtectionBlocking: async () => true,
      publishPolicy: vi.fn(),
      clearHistoryImportUi: vi.fn(),
    };
    registerInboxSyncExecutor(ex);
    await handleOwnerInboxSyncRequest('quiet-tenant', true);
    expect(ex.reemitLight).not.toHaveBeenCalled();
    expect(getInboxSyncQueueDepth('quiet-tenant')).toBe(1);
  });

  it('clique manual com modo proteção executa syncFromPhone userInitiated (mesmo com recovery automático depois)', async () => {
    vi.useFakeTimers();
    try {
      const syncFromPhone = vi.fn(async () => undefined);
      registerInboxSyncExecutor({
        reemitLight: vi.fn(async () => undefined),
        syncFromPhone,
        isCampaignBlocking: () => false,
        isChipProtectionBlocking: async () => true,
        publishPolicy: vi.fn(),
        clearHistoryImportUi: vi.fn(),
      });
      await handleOwnerInboxSyncRequest('manual-tenant', true);
      // thread_sparse (loadChatHistory) chega logo após o clique — não pode apagar userInitiated.
      enqueueAutomatedPhoneFullSync('manual-tenant', 'thread_sparse');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(syncFromPhone).toHaveBeenCalledTimes(1);
      expect(syncFromPhone).toHaveBeenCalledWith('manual-tenant', { force: true, userInitiated: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovery automático sozinho continua bloqueado pelo modo proteção', async () => {
    vi.useFakeTimers();
    try {
      const syncFromPhone = vi.fn(async () => undefined);
      registerInboxSyncExecutor({
        reemitLight: vi.fn(async () => undefined),
        syncFromPhone,
        isCampaignBlocking: () => false,
        isChipProtectionBlocking: async () => true,
        publishPolicy: vi.fn(),
        clearHistoryImportUi: vi.fn(),
      });
      enqueueAutomatedPhoneFullSync('auto-tenant', 'thread_sparse');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(syncFromPhone).not.toHaveBeenCalled();
      expect(getInboxSyncQueueDepth('auto-tenant')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clique manual com campanha ativa continua na fila (sem restart)', async () => {
    vi.useFakeTimers();
    try {
      const syncFromPhone = vi.fn(async () => undefined);
      registerInboxSyncExecutor({
        reemitLight: vi.fn(async () => undefined),
        syncFromPhone,
        isCampaignBlocking: () => true,
        isChipProtectionBlocking: async () => false,
        publishPolicy: vi.fn(),
        clearHistoryImportUi: vi.fn(),
      });
      await handleOwnerInboxSyncRequest('camp-tenant', true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(syncFromPhone).not.toHaveBeenCalled();
      expect(getInboxSyncQueueDepth('camp-tenant')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifyCampaignBlocking dispara publish', async () => {
    const publishPolicy = vi.fn();
    registerInboxSyncExecutor({
      reemitLight: vi.fn(),
      syncFromPhone: vi.fn(),
      isCampaignBlocking: () => false,
      publishPolicy,
    });
    notifyCampaignBlocking('t2', false);
    await new Promise((r) => setTimeout(r, 0));
    expect(publishPolicy).toHaveBeenCalled();
  });
});
