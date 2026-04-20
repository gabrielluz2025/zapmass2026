import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAppVersion } from './version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const defaultSources = [
  '.wwebjs_auth',
  '.wwebjs_cache',
  'data',
  'logs',
];

const sanitizeTimestamp = (date: Date) =>
  date.toISOString().replace(/[:.]/g, '-');

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const exists = async (targetPath: string) => {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
};

export interface BackupResult {
  backupDir: string;
  sources: string[];
  skipped: string[];
  createdAt: string;
  version: string;
}

export const runBackup = async (reason: string): Promise<BackupResult> => {
  const backupRoot = path.resolve(
    projectRoot,
    process.env.BACKUP_DIR || 'backups'
  );
  const timestamp = sanitizeTimestamp(new Date());
  const backupDir = path.join(backupRoot, `backup-${timestamp}`);

  await ensureDir(backupDir);

  const sources = process.env.BACKUP_SOURCES
    ? process.env.BACKUP_SOURCES.split(',')
        .map((source) => source.trim())
        .filter(Boolean)
    : defaultSources;

  const copiedSources: string[] = [];
  const skippedSources: string[] = [];

  for (const source of sources) {
    const fromPath = path.resolve(projectRoot, source);
    const toPath = path.join(backupDir, source);

    if (!(await exists(fromPath))) {
      skippedSources.push(source);
      continue;
    }

    await fs.promises.cp(fromPath, toPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });

    copiedSources.push(source);
  }

  const result: BackupResult = {
    backupDir,
    sources: copiedSources,
    skipped: skippedSources,
    createdAt: new Date().toISOString(),
    version: getAppVersion(),
  };

  await fs.promises.writeFile(
    path.join(backupDir, 'backup.json'),
    JSON.stringify({ ...result, reason }, null, 2),
    'utf8'
  );

  return result;
};
