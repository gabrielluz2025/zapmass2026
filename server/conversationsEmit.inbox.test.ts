import { beforeEach, describe, expect, it } from 'vitest';
import { rememberClaim, resetInboxAssignmentsCacheForTesting } from './inboxAssignments.js';
import { conversationsPayloadForViewer } from './conversationsEmit.js';
import type { Conversation } from './types.js';

const baseConv = (id: string, connectionId: string): Conversation => ({
  id,
  contactName: 'Contato',
  contactPhone: '5511999999999',
  connectionId,
  unreadCount: 0,
  lastMessage: '',
  lastMessageTime: '',
  messages: [],
  tags: []
});

describe('conversationsPayloadForViewer (inbox por staff)', () => {
  const tenantUid = 'tenantOwner1';
  const staffA = 'firebaseUidStaffA';
  const staffB = 'firebaseUidStaffB';

  beforeEach(() => {
    resetInboxAssignmentsCacheForTesting();
  });

  it('dono vê todas as conversas do tenant e metadado de quem assumiu', () => {
    const convs = [baseConv('c1', `${tenantUid}__chip1`), baseConv('c2', `${tenantUid}__chip1`)];
    rememberClaim(tenantUid, 'c1', staffA);
    const out = conversationsPayloadForViewer(tenantUid, tenantUid, convs);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.id === 'c1')?.inboxClaimedByAuthUid).toBe(staffA);
    expect(out.find((c) => c.id === 'c2')?.inboxClaimedByAuthUid).toBeUndefined();
  });

  it('outro staff não vê conversa já reivindicada', () => {
    const convs = [baseConv('c1', `${tenantUid}__chip1`), baseConv('c2', `${tenantUid}__chip1`)];
    rememberClaim(tenantUid, 'c1', staffA);
    const outB = conversationsPayloadForViewer(tenantUid, staffB, convs);
    expect(outB.map((c) => c.id).sort()).toEqual(['c2']);
  });

  it('staff que assumiu vê a conversa e o campo inboxClaimedByAuthUid na própria linha', () => {
    const convs = [baseConv('c1', `${tenantUid}__chip1`)];
    rememberClaim(tenantUid, 'c1', staffA);
    const outA = conversationsPayloadForViewer(tenantUid, staffA, convs);
    expect(outA).toHaveLength(1);
    expect(outA[0]?.inboxClaimedByAuthUid).toBe(staffA);
  });

  it('canal legado conn_* com ownerUid no resolver entra no escopo do tenant', () => {
    const legacyChip = 'conn_1700000000000';
    const convs = [baseConv(`${legacyChip}:5511999999999@s.whatsapp.net`, legacyChip)];
    const out = conversationsPayloadForViewer(tenantUid, tenantUid, convs, (id) =>
      id === legacyChip ? tenantUid : undefined
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.connectionId).toBe(legacyChip);
  });

  it('canal legado conn_* sem resolver é filtrado (escopo estrito)', () => {
    const legacyChip = 'conn_1700000000000';
    const convs = [baseConv(`${legacyChip}:5511999999999@s.whatsapp.net`, legacyChip)];
    const out = conversationsPayloadForViewer(tenantUid, tenantUid, convs);
    expect(out).toHaveLength(0);
  });
});
