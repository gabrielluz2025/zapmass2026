import * as waService from './whatsappService.js';
import { startSessionControlPlane, stopSessionControlPlane } from './sessionControlPlane.js';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

const createNoopIo = () =>
  ({
    sockets: {
      sockets: new Map()
    },
    emit: () => undefined,
    to: () => ({ emit: () => undefined })
  }) as any;

const shutdown = async (signal: string) => {
  console.log(`[wa-worker] ${signal} recebido, encerrando ${WORKER_ID}...`);
  await stopSessionControlPlane().catch((error) => {
    console.error('[wa-worker] falha ao parar control-plane', error);
  });
  await waService.shutdownAll(signal).catch((error) => {
    console.error('[wa-worker] falha no shutdownAll', error);
  });
  process.exit(0);
};

const bootstrap = async () => {
  process.env.SESSION_PROCESS_MODE = process.env.SESSION_PROCESS_MODE || 'worker';
  waService.init(createNoopIo());
  await startSessionControlPlane();
  console.log(`[wa-worker] ativo com id ${WORKER_ID}`);
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

void bootstrap();
