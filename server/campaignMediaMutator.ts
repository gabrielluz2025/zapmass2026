import { createHash, randomBytes } from 'node:crypto';
import type IORedis from 'ioredis';
import { getSharedRedis } from './redisShared.js';

export type MutateMediaOptions = {
  chipId?: string;
  tenantId?: string;
  buffer: Buffer;
  mimeType: string;
  maxUsesPerHash?: number;
  redis?: IORedis | null;
};

export type MutateMediaResult = {
  buffer: Buffer;
  mutated: boolean;
  originalHash: string;
  newHash: string;
  useCount: number;
};

const HASH_COUNT_PREFIX = 'zapmass:media_hash:';
const DEFAULT_MAX_USES = 10;
const HASH_TRACK_TTL_SEC = 7200;

function readMaxUsesPerHash(override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  const env = Number(process.env.MEDIA_HASH_MAX_USES ?? DEFAULT_MAX_USES);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : DEFAULT_MAX_USES;
}

export function calculateSHA256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashCountKey(contentHash: string): string {
  return `${HASH_COUNT_PREFIX}${contentHash}:count`;
}

/** Padding neutro no final — válido para OGG e containers tolerantes. */
export function appendNeutralPadding(buffer: Buffer): Buffer {
  const padLen = Math.floor(Math.random() * 8) + 1;
  return Buffer.concat([buffer, randomBytes(padLen)]);
}

/** ID3v2 mínimo com metadados aleatórios (MP3 / MPEG audio). */
export function prependRandomId3Tag(buffer: Buffer): Buffer {
  const title = randomBytes(6).toString('hex');
  const frameBody = Buffer.from(title, 'utf8');
  const frameHeader = Buffer.alloc(10);
  frameHeader.write('TXXX', 0);
  frameHeader.writeUInt32BE(frameBody.length, 4);
  frameHeader.writeUInt16BE(0, 8);
  frameHeader.writeUInt8(0, 9);
  const id3Body = Buffer.concat([frameHeader, frameBody]);
  const id3Header = Buffer.alloc(10);
  id3Header.write('ID3', 0);
  id3Header.writeUInt8(3, 3);
  id3Header.writeUInt8(0, 4);
  id3Header.writeUInt8(0, 5);
  const size = id3Body.length;
  id3Header.writeUInt8((size >> 21) & 0x7f, 6);
  id3Header.writeUInt8((size >> 14) & 0x7f, 7);
  id3Header.writeUInt8((size >> 7) & 0x7f, 8);
  id3Header.writeUInt8(size & 0x7f, 9);
  return Buffer.concat([id3Header, id3Body, buffer]);
}

/** Atom `free` no final do MP4 — altera SHA256 sem quebrar a maioria dos players. */
export function appendMp4FreeAtom(buffer: Buffer): Buffer {
  const payload = randomBytes(8 + Math.floor(Math.random() * 8));
  const atomSize = 8 + payload.length;
  const atom = Buffer.alloc(atomSize);
  atom.writeUInt32BE(atomSize, 0);
  atom.write('free', 4);
  payload.copy(atom, 8);
  return Buffer.concat([buffer, atom]);
}

export async function applyMicroMutation(buffer: Buffer, mimeType: string): Promise<Buffer> {
  const mime = String(mimeType || '').toLowerCase();

  if (mime.startsWith('image/')) {
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer).metadata();
      const randomQuality = 96 + Math.floor(Math.random() * 3);
      const resizeJitter =
        meta.width && meta.height
          ? Math.random() < 0.5
            ? { width: Math.max(1, meta.width - 1) }
            : { height: Math.max(1, meta.height - 1) }
          : {};

      let pipeline = sharp(buffer).rotate();

      if (resizeJitter.width || resizeJitter.height) {
        pipeline = pipeline.resize(resizeJitter);
      }

      if (mime.includes('png')) {
        return pipeline.png({ compressionLevel: 8 + Math.floor(Math.random() * 2) }).toBuffer();
      }
      if (mime.includes('webp')) {
        return pipeline.webp({ quality: randomQuality }).toBuffer();
      }
      if (mime.includes('gif')) {
        return pipeline.gif().toBuffer();
      }
      return pipeline.jpeg({ quality: randomQuality, mozjpeg: true }).toBuffer();
    } catch (err) {
      console.warn('[MediaMutator] sharp indisponível — fallback padding', {
        mimeType: mime,
        error: (err as Error)?.message,
      });
      return appendNeutralPadding(buffer);
    }
  }

  if (mime.startsWith('audio/')) {
    if (mime.includes('mpeg') || mime.includes('mp3')) {
      return prependRandomId3Tag(buffer);
    }
    return appendNeutralPadding(buffer);
  }

  if (mime.startsWith('video/')) {
    if (mime.includes('mp4') || mime.includes('quicktime')) {
      return appendMp4FreeAtom(buffer);
    }
    return appendNeutralPadding(buffer);
  }

  return appendNeutralPadding(buffer);
}

/**
 * Rastreia uso do hash SHA256 original no Redis e muta o buffer quando excede o limiar.
 */
export async function mutateMediaIfRepeated(opts: MutateMediaOptions): Promise<MutateMediaResult> {
  const buffer = opts.buffer;
  const originalHash = calculateSHA256(buffer);
  const maxUses = readMaxUsesPerHash(opts.maxUsesPerHash);
  const redis = opts.redis ?? getSharedRedis();

  if (!redis || buffer.length === 0) {
    return {
      buffer,
      mutated: false,
      originalHash,
      newHash: originalHash,
      useCount: 1,
    };
  }

  const key = hashCountKey(originalHash);
  const currentCount = await redis.incr(key);
  if (currentCount === 1) {
    await redis.expire(key, HASH_TRACK_TTL_SEC);
  }

  if (currentCount <= maxUses) {
    return {
      buffer,
      mutated: false,
      originalHash,
      newHash: originalHash,
      useCount: currentCount,
    };
  }

  const mutatedBuffer = await applyMicroMutation(buffer, opts.mimeType);
  const newHash = calculateSHA256(mutatedBuffer);
  await redis.set(hashCountKey(newHash), '1', 'EX', HASH_TRACK_TTL_SEC).catch(() => undefined);

  return {
    buffer: mutatedBuffer,
    mutated: true,
    originalHash,
    newHash,
    useCount: currentCount,
  };
}
