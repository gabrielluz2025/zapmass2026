import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Conversation } from './types.js';

const waConversations: Conversation[] = [];
const evoConversations: Conversation[] = [];

vi.mock('./whatsappService.js', () => ({
  getConversations: () => waConversations,
}));

vi.mock('./evolutionService.js', () => ({
  getConversations: () => evoConversations,
}));

vi.mock('./auth/dataMode.js', () => ({ vpsDataEnabled: () => false }));
vi.mock('./chatArchiveStore.js', () => ({ usePostgresChatArchive: () => false }));
vi.mock('./repositories/inboxConversationsRepository.js', () => ({
  findPersistedInboxConversationPg: vi.fn(async () => null),
}));

import { resolveWorkspaceInboxConversation } from './workspaceInboxConversation.js';

describe('resolveWorkspaceInboxConversation', () => {
  beforeEach(() => {
    waConversations.length = 0;
    evoConversations.length = 0;
  });

  it('encontra na RAM do Evolution (modo Go) quando whatsappService está vazio', async () => {
    const conv: Conversation = {
      id: 'chip06:554799907319@s.whatsapp.net',
      connectionId: 'chip06',
      contactName: 'Matheus Luz',
      contactPhone: '+554799907319',
      unreadCount: 0,
      lastMessage: 'oi',
      lastMessageTime: '',
      messages: [],
      tags: ['Disparo 06'],
    };
    evoConversations.push(conv);
    const r = await resolveWorkspaceInboxConversation('tenant-1', conv.id);
    expect(r?.connectionId).toBe('chip06');
    expect(r?.contactName).toBe('Matheus Luz');
  });

  it('diferencia threads do mesmo telefone em chips diferentes', async () => {
    evoConversations.push(
      {
        id: 'chip05:554799907319@s.whatsapp.net',
        connectionId: 'chip05',
        contactName: 'Matheus Luz',
        contactPhone: '+554799907319',
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        messages: [],
        tags: ['Disparo 05'],
      },
      {
        id: 'chip06:554799907319@s.whatsapp.net',
        connectionId: 'chip06',
        contactName: 'Matheus Luz',
        contactPhone: '+554799907319',
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: '',
        messages: [],
        tags: ['Disparo 06'],
      }
    );
    const r = await resolveWorkspaceInboxConversation('tenant-1', 'chip06:554799907319@s.whatsapp.net');
    expect(r?.connectionId).toBe('chip06');
    expect(r?.tags).toContain('Disparo 06');
  });
});
