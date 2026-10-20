import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createJsonErrorMiddleware, installExpressAsyncSafety } from './expressAsyncSafe.js';

let server: Server | null = null;

async function start(setup: (app: express.Express) => void): Promise<string> {
  const app = express();
  installExpressAsyncSafety(app);
  app.use(express.json({ limit: '1kb' }));
  setup(app);
  app.use(createJsonErrorMiddleware(() => undefined));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

describe('expressAsyncSafe', () => {
  it('handler async que rejeita vira JSON 500 (antes: requisição pendurada)', async () => {
    const base = await start((app) => {
      app.get('/boom', async () => {
        throw new Error('segredo-interno');
      });
    });
    const r = await fetch(`${base}/boom`);
    expect(r.status).toBe(500);
    const body = (await r.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain('segredo-interno');
  });

  it('handler síncrono que lança também vira JSON 500', async () => {
    const base = await start((app) => {
      app.get('/sync', () => {
        throw new Error('x');
      });
    });
    const r = await fetch(`${base}/sync`);
    expect(r.status).toBe(500);
  });

  it('handlers normais continuam funcionando (incl. app.get de setting)', async () => {
    const base = await start((app) => {
      expect(app.get('env')).toBeTruthy();
      app.get('/ok', async (_req, res) => {
        res.json({ ok: true });
      });
    });
    const r = await fetch(`${base}/ok`);
    expect(r.status).toBe(200);
  });

  it('JSON malformado → 400 JSON; body grande → 413 JSON', async () => {
    const base = await start((app) => {
      app.post('/p', (_req, res) => res.json({ ok: true }));
    });
    const bad = await fetch(`${base}/p`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops'
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { ok: boolean }).ok).toBe(false);
    const big = await fetch(`${base}/p`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 'x'.repeat(5000) })
    });
    expect(big.status).toBe(413);
  });
});
