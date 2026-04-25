import { SessionRouter } from '../server/sessionRouter.js';
import type { SessionCommand } from '../server/sessionContracts.js';

const router = new SessionRouter();

const mkCommand = (idx: number): SessionCommand => ({
  commandId: `cmd_${idx}`,
  requestedAt: Date.now(),
  requestedByUid: `uid_${idx % 5}`,
  type: 'send-message',
  payload: {
    conversationId: `uid_${idx % 5}__conn${idx}:${5511999990000 + idx}@c.us`,
    text: `teste_${idx}`
  }
});

for (let i = 0; i < 4; i += 1) {
  router.heartbeat(`worker-${i}`);
}

for (let i = 0; i < 50; i += 1) {
  const cmd = mkCommand(i);
  router.recordCommandPublished();
  const worker = router.assignWorker(cmd);
  const connectionId = cmd.payload.conversationId.split(':')[0];
  router.renewConnectionLease(connectionId, worker);
  router.recordCommandCompleted();
}

const snapshot = router.getMetricsSnapshot();
if (snapshot.commandsPublished !== 50 || snapshot.commandsCompleted !== 50) {
  throw new Error(`Falha na validacao da fila: ${JSON.stringify(snapshot)}`);
}
if (snapshot.aliveWorkers < 1) {
  throw new Error(`Nenhum worker ativo detectado: ${JSON.stringify(snapshot)}`);
}

console.log('[session-resilience-check] OK', snapshot);
