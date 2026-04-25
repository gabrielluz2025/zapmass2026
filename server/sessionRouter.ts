import type { SessionCommand, SessionMetricsSnapshot, WorkerAssignment } from './sessionContracts.js';

const LEASE_MS = Number(process.env.SESSION_WORKER_LEASE_MS || 45000);

type WorkerHeartbeat = {
  workerId: string;
  lastSeenAt: number;
};

export class SessionRouter {
  private readonly assignments = new Map<string, WorkerAssignment>();
  private readonly workers = new Map<string, WorkerHeartbeat>();
  private commandsPublished = 0;
  private commandsCompleted = 0;
  private commandsFailed = 0;

  recordCommandPublished(): void {
    this.commandsPublished += 1;
  }

  recordCommandCompleted(): void {
    this.commandsCompleted += 1;
  }

  recordCommandFailed(): void {
    this.commandsFailed += 1;
  }

  heartbeat(workerId: string): void {
    this.workers.set(workerId, { workerId, lastSeenAt: Date.now() });
  }

  assignWorker(command: SessionCommand): string {
    this.cleanupExpiredLeases();
    let explicitConnectionId = '';
    if ('connectionId' in command && command.connectionId) {
      explicitConnectionId = command.connectionId;
    } else if ('payload' in command && command.payload && 'conversationId' in command.payload) {
      explicitConnectionId = String(command.payload.conversationId || '').split(':')[0] || '';
    }
    if (explicitConnectionId) {
      const current = this.assignments.get(explicitConnectionId);
      if (current && current.leaseUntil > Date.now()) {
        return current.workerId;
      }
    }
    const workerId = this.pickLeastBusyWorker() || 'worker-default';
    if (explicitConnectionId) {
      this.assignments.set(explicitConnectionId, {
        workerId,
        connectionId: explicitConnectionId,
        leaseUntil: Date.now() + LEASE_MS
      });
    }
    return workerId;
  }

  renewConnectionLease(connectionId: string, workerId: string): void {
    if (!connectionId) return;
    this.assignments.set(connectionId, { connectionId, workerId, leaseUntil: Date.now() + LEASE_MS });
  }

  private pickLeastBusyWorker(): string | null {
    let selected: string | null = null;
    let score = Number.POSITIVE_INFINITY;
    for (const [workerId, beat] of this.workers.entries()) {
      if (Date.now() - beat.lastSeenAt > LEASE_MS) continue;
      const load = this.countAssignments(workerId);
      if (load < score) {
        score = load;
        selected = workerId;
      }
    }
    return selected;
  }

  private countAssignments(workerId: string): number {
    let total = 0;
    for (const assignment of this.assignments.values()) {
      if (assignment.workerId === workerId && assignment.leaseUntil > Date.now()) total += 1;
    }
    return total;
  }

  private cleanupExpiredLeases(): void {
    const now = Date.now();
    for (const [connectionId, assignment] of this.assignments.entries()) {
      if (assignment.leaseUntil <= now) this.assignments.delete(connectionId);
    }
    for (const [workerId, beat] of this.workers.entries()) {
      if (now - beat.lastSeenAt > LEASE_MS) this.workers.delete(workerId);
    }
  }

  getMetricsSnapshot(): SessionMetricsSnapshot {
    this.cleanupExpiredLeases();
    return {
      commandsPublished: this.commandsPublished,
      commandsCompleted: this.commandsCompleted,
      commandsFailed: this.commandsFailed,
      pendingAssignments: this.assignments.size,
      aliveWorkers: this.workers.size
    };
  }
}
