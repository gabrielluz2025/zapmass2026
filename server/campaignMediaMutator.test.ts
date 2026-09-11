import { describe, expect, it } from 'vitest';
import {
  appendMp4FreeAtom,
  appendNeutralPadding,
  applyMicroMutation,
  calculateSHA256,
  prependRandomId3Tag,
} from './campaignMediaMutator.js';
import { mediaContentFingerprint, sha256MediaContent } from './campaignContentHashLock.js';

describe('campaignMediaMutator', () => {
  it('calculateSHA256 é determinístico', () => {
    const buf = Buffer.from('hello-media');
    expect(calculateSHA256(buf)).toBe(calculateSHA256(buf));
    expect(calculateSHA256(buf)).not.toBe(calculateSHA256(Buffer.from('other')));
  });

  it('appendNeutralPadding altera o hash', () => {
    const base = Buffer.from('audio-ogg-payload');
    const padded = appendNeutralPadding(base);
    expect(padded.length).toBeGreaterThan(base.length);
    expect(calculateSHA256(padded)).not.toBe(calculateSHA256(base));
  });

  it('prependRandomId3Tag altera MP3 buffer', () => {
    const base = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const tagged = prependRandomId3Tag(base);
    expect(tagged.length).toBeGreaterThan(base.length);
    expect(tagged.subarray(0, 3).toString()).toBe('ID3');
  });

  it('appendMp4FreeAtom adiciona atom free', () => {
    const base = Buffer.from('....ftypmp42....');
    const out = appendMp4FreeAtom(base);
    expect(out.length).toBeGreaterThan(base.length);
    expect(out.subarray(out.length - 24).toString('ascii')).toContain('free');
  });

  it('applyMicroMutation em áudio usa padding ou ID3', async () => {
    const base = Buffer.from('fake-audio-content-for-test');
    const out = await applyMicroMutation(base, 'audio/ogg');
    expect(calculateSHA256(out)).not.toBe(calculateSHA256(base));
  });
});

describe('campaignContentHashLock media fingerprint', () => {
  it('sha256MediaContent identifica binário', () => {
    const a = Buffer.from('img-bytes');
    expect(sha256MediaContent(a)).toHaveLength(64);
  });

  it('mediaContentFingerprint inclui legenda longa', () => {
    const buf = Buffer.alloc(64, 1);
    const a = mediaContentFingerprint(buf, 'Legenda promocional longa o suficiente');
    const b = mediaContentFingerprint(buf, 'Outra legenda promocional diferente aqui');
    expect(a).not.toBe(b);
  });
});
