import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECT_ROOT } from './bootstrapEnv.js';

const dataDir = path.resolve(PROJECT_ROOT, process.env.DATA_DIR || 'data');
export const uploadsDir = path.join(dataDir, 'public/uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

export function getUploadsDir(): string {
    return uploadsDir;
}

function decodeBase64(base64Data: string): Buffer {
    const base64Clean = base64Data.includes(';base64,')
        ? base64Data.split(';base64,')[1]
        : base64Data;
    return Buffer.from(base64Clean, 'base64');
}

function getExtensionFromMime(mime: string): string {
    const m = String(mime || '').toLowerCase();
    if (m.includes('image/png')) return '.png';
    if (m.includes('image/jpeg') || m.includes('image/jpg')) return '.jpg';
    if (m.includes('image/gif')) return '.gif';
    if (m.includes('image/webp')) return '.webp';
    if (m.includes('video/mp4')) return '.mp4';
    if (m.includes('video/mpeg')) return '.mpeg';
    if (m.includes('audio/ogg')) return '.ogg';
    if (m.includes('audio/mpeg') || m.includes('audio/mp3')) return '.mp3';
    if (m.includes('pdf')) return '.pdf';
    if (m.includes('msword')) return '.doc';
    if (m.includes('sheet')) return '.xlsx';
    return '';
}

function buildUniqueFileName(originalFileName: string, mimeType: string): string {
    const fileExt = path.extname(originalFileName) || getExtensionFromMime(mimeType);
    const safeName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    return `media_${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeName}${fileExt}`;
}

export function isS3Configured(): boolean {
    return Boolean(
        process.env.S3_BUCKET &&
        process.env.S3_ACCESS_KEY &&
        process.env.S3_SECRET_KEY &&
        process.env.S3_ENDPOINT
    );
}

function buildS3PublicUrl(key: string): string {
    const customBase = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    if (customBase) return `${customBase}/${key}`;

    const bucket = process.env.S3_BUCKET!;
    const endpoint = (process.env.S3_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const useSsl = process.env.S3_USE_SSL !== 'false';
    const protocol = useSsl ? 'https' : 'http';
    const port = process.env.S3_PORT ? `:${process.env.S3_PORT}` : '';
    return `${protocol}://${endpoint}${port}/${bucket}/${key}`;
}

async function saveToS3(buffer: Buffer, mimeType: string, originalFileName: string): Promise<{ url: string }> {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    const key = `uploads/${buildUniqueFileName(originalFileName, mimeType)}`;
    const endpoint = process.env.S3_ENDPOINT!;
    const useSsl = process.env.S3_USE_SSL !== 'false';

    const client = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: endpoint.startsWith('http') ? endpoint : `${useSsl ? 'https' : 'http'}://${endpoint}`,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!,
        },
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    });

    await client.send(
        new PutObjectCommand({
            Bucket: process.env.S3_BUCKET!,
            Key: key,
            Body: buffer,
            ContentType: mimeType || 'application/octet-stream',
        })
    );

    const url = buildS3PublicUrl(key);
    console.log(`[MediaStorage] Enviado para S3/R2: ${key} -> ${url}`);
    return { url };
}

/**
 * Salva mídia localmente e retorna URL pública servida pelo ZapMass.
 */
export function saveBase64ToPublicUrl(
    base64Data: string,
    mimeType: string,
    originalFileName: string
): { url: string; localPath: string } {
    const buffer = decodeBase64(base64Data);
    const uniqueName = buildUniqueFileName(originalFileName, mimeType);
    const localPath = path.join(uploadsDir, uniqueName);

    fs.writeFileSync(localPath, buffer);

    const baseUrl = (process.env.PUBLIC_APP_URL || 'http://localhost:3001').replace(/\/$/, '');
    const url = `${baseUrl}/public/uploads/${uniqueName}`;

    console.log(`[MediaStorage] Salvo localmente: ${uniqueName} -> ${url}`);
    return { url, localPath };
}

/**
 * Persiste mídia em S3/R2 (se configurado) ou disco local e retorna URL pública.
 */
export async function saveMediaFromBase64(
    base64Data: string,
    mimeType: string,
    originalFileName: string
): Promise<{ url: string; localPath?: string }> {
    const buffer = decodeBase64(base64Data);

    if (isS3Configured()) {
        return saveToS3(buffer, mimeType, originalFileName);
    }

    const uniqueName = buildUniqueFileName(originalFileName, mimeType);
    const localPath = path.join(uploadsDir, uniqueName);
    fs.writeFileSync(localPath, buffer);

    const baseUrl = (process.env.PUBLIC_APP_URL || 'http://localhost:3001').replace(/\/$/, '');
    const url = `${baseUrl}/public/uploads/${uniqueName}`;
    console.log(`[MediaStorage] Salvo localmente: ${uniqueName} -> ${url}`);
    return { url, localPath };
}
