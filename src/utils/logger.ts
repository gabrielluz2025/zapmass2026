/** Logs de diagnóstico: em produção silencia ruído; erros operacionais podem usar `warnProd`. */
const isDev = import.meta.env.DEV;

export const devLog = (...args: unknown[]): void => {
  if (isDev) console.log(...args);
};

export const devWarn = (...args: unknown[]): void => {
  if (isDev) console.warn(...args);
};

/** Avisos que ainda fazem sentido em produção (ex.: Firestore). */
export const warnProd = (...args: unknown[]): void => {
  console.warn(...args);
};

export const devError = (...args: unknown[]): void => {
  if (isDev) console.error(...args);
};
