export function agentAskTimeoutMs(): number {
  const n = Number(process.env.AGENT_ASK_TIMEOUT_MS ?? 45_000);
  return Number.isFinite(n) ? Math.min(120_000, Math.max(5_000, Math.floor(n))) : 45_000;
}

export async function withAgentTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => T | Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          void Promise.resolve(onTimeout()).then(resolve);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
