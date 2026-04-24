import { execSync } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveGitRef(): string {
  if (process.env.VITE_GIT_REF && process.env.VITE_GIT_REF !== 'unknown') {
    return process.env.VITE_GIT_REF;
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig(({ mode }) => {
    loadEnv(mode, '.', '');
    const vitGitRef = resolveGitRef();
    return {
      server: {
        port: 8000,
        host: '0.0.0.0',
        watch: {
          ignored: ['**/data/**', '**/.wwebjs_auth/**', '**/.wwebjs_cache/**', '**/tokens/**']
        },
        proxy: {
          '/api': {
            target: 'http://localhost:3001',
            changeOrigin: true,
          },
          '/socket.io': {
            target: 'http://localhost:3001',
            ws: true,
          },
        }
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      },
      build: {
        outDir: 'dist',
        emptyOutDir: true
      },
      define: {
        'import.meta.env.VITE_GIT_REF': JSON.stringify(vitGitRef)
      }
    };
});