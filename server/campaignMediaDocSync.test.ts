import { describe, expect, it } from 'vitest';
import {
  campaignIdFromMediaStorageKey,
  mediaMetaEntryFromPayload,
  mediaMetaSlotForStorageKey,
} from './campaignMediaDocSync.js';

describe('campaignMediaDocSync', () => {
  it('resolve slot opening vs follow-up', () => {
    const cid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(mediaMetaSlotForStorageKey(cid)).toBe('opening');
    expect(mediaMetaSlotForStorageKey(`${cid}:reply-step:1`)).toBe('followUp');
    expect(mediaMetaSlotForStorageKey(`${cid}:reply-opt:abc`)).toBeNull();
  });

  it('extrai campaignId da chave de armazenamento', () => {
    const cid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(campaignIdFromMediaStorageKey(cid)).toBe(cid);
    expect(campaignIdFromMediaStorageKey(`${cid}:reply-step:1`)).toBe(cid);
  });

  it('monta meta entry a partir do payload', () => {
    const entry = mediaMetaEntryFromPayload({
      fileName: 'foto.jpg',
      mimeType: 'image/jpeg',
      sendMediaAsDocument: true,
    });
    expect(entry?.fileName).toBe('foto.jpg');
    expect(entry?.mimeType).toBe('image/jpeg');
    expect(entry?.sendMediaAsDocument).toBe(true);
    expect(entry?.updatedAt).toBeTruthy();
  });
});
