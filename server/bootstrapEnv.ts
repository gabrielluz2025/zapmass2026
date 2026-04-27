import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

/** Raiz do repositório (onde estão package.json e .env), mesmo que o cwd não seja aí. */
export const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const envPath = path.join(PROJECT_ROOT, '.env');
if (existsSync(envPath)) {
  const result = loadEnv({ path: envPath, override: true });
  if (result.error) {
    console.warn(`[bootstrapEnv] Falha ao ler ${envPath}:`, result.error.message);
  }
}
