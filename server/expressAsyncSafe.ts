import type { ErrorRequestHandler, Express, NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 NÃO captura rejeição de handlers `async`: a requisição ficava pendurada até timeout
 * (spinner infinito para o cliente) e o erro só aparecia como `unhandledRejection`.
 * Esta função envolve os handlers registrados em `app.get/post/put/patch/delete/all/use`
 * para encaminhar a rejeição ao `next(err)` → `jsonErrorMiddleware`.
 *
 * Deve ser chamada logo após `express()`, ANTES de registrar rotas.
 */
export function wrapAsyncHandler(fn: RequestHandler): RequestHandler {
  const wrapped: RequestHandler = (req, res, next) => {
    try {
      const out = fn(req, res, next) as unknown;
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        (out as Promise<unknown>).catch(next);
      }
    } catch (e) {
      next(e);
    }
  };
  return wrapped;
}

function shouldWrap(arg: unknown): arg is RequestHandler {
  if (typeof arg !== 'function') return false;
  const f = arg as unknown as { handle?: unknown; set?: unknown; length: number };
  // Sub-app / Router (têm .handle) e error handlers (4 args) ficam intactos.
  if (f.handle || f.set) return false;
  if (f.length >= 4) return false;
  return true;
}

function mapArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (Array.isArray(a)) return mapArgs(a);
    return shouldWrap(a) ? wrapAsyncHandler(a) : a;
  });
}

export function installExpressAsyncSafety(app: Express): void {
  const target = app as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all', 'use']) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    target[method] = function patched(this: unknown, ...args: unknown[]) {
      // `app.get('setting')` (1 arg string) continua funcionando: só funções são embrulhadas.
      return original.apply(this, mapArgs(args));
    };
  }
}

export type JsonErrorLogger = (msg: string, err: unknown) => void;

/**
 * Último middleware: erros de rota/body-parser viram JSON (nunca HTML do Express nem stack trace).
 * `PayloadTooLarge` → 413, JSON inválido → 400, resto → 500 genérico (detalhe só no log).
 */
export function createJsonErrorMiddleware(log: JsonErrorLogger = (m, e) => console.error(m, e)): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const e = err as { status?: number; statusCode?: number; type?: string; message?: string };
    const status = Number(e?.status ?? e?.statusCode);
    if (e?.type === 'entity.too.large' || status === 413) {
      return void res.status(413).json({ ok: false, error: 'Conteúdo muito grande. Reduza o tamanho do arquivo/mensagem.' });
    }
    if (e?.type === 'entity.parse.failed' || (status === 400 && /JSON/i.test(String(e?.message || '')))) {
      return void res.status(400).json({ ok: false, error: 'Corpo da requisição inválido (JSON malformado).' });
    }
    log(`[http] erro não tratado em ${req.method} ${req.path}:`, err);
    const safeStatus = Number.isFinite(status) && status >= 400 && status < 500 ? status : 500;
    return void res.status(safeStatus).json({
      ok: false,
      error: safeStatus === 500 ? 'Erro interno. Tente novamente em instantes.' : String(e?.message || 'Requisição inválida.')
    });
  };
}
