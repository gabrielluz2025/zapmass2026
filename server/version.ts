import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const versionFile = path.join(projectRoot, 'VERSION');

export const getAppVersion = () => {
  try {
    const version = fs.readFileSync(versionFile, 'utf8').trim();
    return version || process.env.APP_VERSION || '0.0.0';
  } catch (error) {
    return process.env.APP_VERSION || '0.0.0';
  }
};
