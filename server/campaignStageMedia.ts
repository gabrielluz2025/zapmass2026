import fs from 'node:fs';
import path from 'node:path';
import { campaignMediaStorageKey } from '../src/utils/campaignMediaKeys.js';

/** Diretório de anexos de campanha (mesmo path que evolutionService). */
export function campaignMediaDataDir(): string {
  return path.join(process.cwd(), 'data', 'campaign-media');
}

/** Lista chaves de storage conhecidas para uma campanha (abertura + reply-step:N no disco). */
export function discoverCampaignMediaStorageKeys(campaignId: string, maxStepIndex = 12): string[] {
  const cid = String(campaignId || '').trim();
  if (!cid) return [];
  const keys = new Set<string>();
  keys.add(cid);
  for (let i = 1; i <= maxStepIndex; i++) {
    keys.add(campaignMediaStorageKey(cid, i));
  }
  try {
    const dir = campaignMediaDataDir();
    if (!fs.existsSync(dir)) return [...keys];
    const prefix = `${cid}`;
    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.startsWith(prefix)) continue;
      const base = fileName.replace(/\.meta\.json$/i, '').replace(/\.[^.]+$/, '');
      if (base === cid || base.startsWith(`${cid}:`)) keys.add(base);
    }
  } catch {
    /* ignora */
  }
  return [...keys];
}

export type StageMediaAttachmentInput = {
  stepIndex: number;
  dataBase64: string;
  mimeType: string;
  fileName: string;
  sendMediaAsDocument?: boolean;
};
