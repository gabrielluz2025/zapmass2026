import { EventEmitter } from 'events';
import type { SessionCommand, SessionEvent } from './sessionContracts.js';

type RedisLike = {
  xadd: (...args: unknown[]) => Promise<unknown>;
  xread: (...args: unknown[]) => Promise<any>;
  quit: () => Promise<void>;
};

const COMMAND_STREAM = process.env.SESSION_COMMAND_STREAM || 'zapmass:session:commands';
const EVENT_STREAM = process.env.SESSION_EVENT_STREAM || 'zapmass:session:events';
const REDIS_URL = process.env.REDIS_URL || '';
const BLOCK_MS = Number(process.env.SESSION_BUS_BLOCK_MS || 3000);

/** Cursor inicial Redis Streams para XREAD. `$` = só entradas novas após o subscribe (evita reexecutar delete/create antigos ao reiniciar o worker). Override: SESSION_COMMAND_CURSOR=0-0 para replay deliberado (debug/migração). */
const defaultCommandCursor = REDIS_URL.trim() ? '$' : '0-0';
const defaultEventCursor = REDIS_URL.trim() ? '$' : '0-0';

let redisFactoryPromise: Promise<((url: string) => RedisLike) | null> | null = null;
const busEmitter = new EventEmitter();

const resolveRedisFactory = async (): Promise<((url: string) => RedisLike) | null> => {
  if (redisFactoryPromise) return redisFactoryPromise;
  redisFactoryPromise = (async () => {
    try {
      const mod = await import('ioredis');
      const RedisCtor = (mod as any)?.default;
      if (typeof RedisCtor !== 'function') return null;
      return (url: string) => new RedisCtor(url, { maxRetriesPerRequest: 1 }) as RedisLike;
    } catch {
      return null;
    }
  })();
  return redisFactoryPromise;
};

export class SessionCommandBus {
  private readonly isRedisEnabled = Boolean(REDIS_URL);
  private publisher: RedisLike | null = null;
  private commandReader: RedisLike | null = null;
  private eventReader: RedisLike | null = null;
  private commandCursor =
    process.env.SESSION_COMMAND_CURSOR?.trim() || defaultCommandCursor;
  private eventCursor = process.env.SESSION_EVENT_CURSOR?.trim() || defaultEventCursor;

  async start(): Promise<void> {
    if (!this.isRedisEnabled) return;
    const factory = await resolveRedisFactory();
    if (!factory) {
      console.warn('[session-bus] ioredis nao disponivel. Usando barramento local em memoria.');
      return;
    }
    console.log(
      `[session-bus] Redis streams: comandos desde ${this.commandCursor} (${COMMAND_STREAM}), eventos desde ${this.eventCursor} (${EVENT_STREAM})`
    );
    this.publisher = factory(REDIS_URL);
    this.commandReader = factory(REDIS_URL);
    this.eventReader = factory(REDIS_URL);
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.publisher?.quit().catch(() => undefined),
      this.commandReader?.quit().catch(() => undefined),
      this.eventReader?.quit().catch(() => undefined)
    ]);
  }

  async publishCommand(command: SessionCommand): Promise<void> {
    if (this.publisher) {
      await this.publisher.xadd(COMMAND_STREAM, '*', 'data', JSON.stringify(command));
      return;
    }
    busEmitter.emit('command', command);
  }

  async publishEvent(event: SessionEvent): Promise<void> {
    if (this.publisher) {
      await this.publisher.xadd(EVENT_STREAM, '*', 'data', JSON.stringify(event));
      return;
    }
    busEmitter.emit('event', event);
  }

  onCommand(handler: (command: SessionCommand) => Promise<void> | void): () => void {
    if (this.commandReader) {
      let running = true;
      const loop = async () => {
        while (running) {
          try {
            const rows = await this.commandReader!.xread(
              'BLOCK',
              BLOCK_MS,
              'STREAMS',
              COMMAND_STREAM,
              this.commandCursor
            );
            if (!Array.isArray(rows)) continue;
            for (const [, messages] of rows) {
              for (const [id, values] of messages) {
                this.commandCursor = id;
                const idx = values.findIndex((v: string) => v === 'data');
                if (idx < 0 || !values[idx + 1]) continue;
                const payload = JSON.parse(values[idx + 1]) as SessionCommand;
                const out = handler(payload);
                if (out && typeof (out as Promise<void>).catch === 'function') {
                  void (out as Promise<void>).catch((err) =>
                    console.error('[session-bus] erro em handler de comando', err)
                  );
                }
              }
            }
          } catch (error) {
            console.error('[session-bus] erro lendo stream de comando', error);
          }
        }
      };
      void loop();
      return () => {
        running = false;
      };
    }

    const wrapped = (cmd: SessionCommand) => {
      const out = handler(cmd);
      if (out && typeof (out as Promise<void>).catch === 'function') {
        void (out as Promise<void>).catch((err) =>
          console.error('[session-bus] erro em handler de comando', err)
        );
      }
    };
    busEmitter.on('command', wrapped);
    return () => busEmitter.off('command', wrapped);
  }

  onEvent(handler: (event: SessionEvent) => Promise<void> | void): () => void {
    if (this.eventReader) {
      let running = true;
      const loop = async () => {
        while (running) {
          try {
            const rows = await this.eventReader!.xread(
              'BLOCK',
              BLOCK_MS,
              'STREAMS',
              EVENT_STREAM,
              this.eventCursor
            );
            if (!Array.isArray(rows)) continue;
            for (const [, messages] of rows) {
              for (const [id, values] of messages) {
                this.eventCursor = id;
                const idx = values.findIndex((v: string) => v === 'data');
                if (idx < 0 || !values[idx + 1]) continue;
                const payload = JSON.parse(values[idx + 1]) as SessionEvent;
                await handler(payload);
              }
            }
          } catch (error) {
            console.error('[session-bus] erro lendo stream de evento', error);
          }
        }
      };
      void loop();
      return () => {
        running = false;
      };
    }

    const wrapped = async (evt: SessionEvent) => {
      await handler(evt);
    };
    busEmitter.on('event', wrapped);
    return () => busEmitter.off('event', wrapped);
  }
}
