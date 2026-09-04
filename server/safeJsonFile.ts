import fs from 'fs';
import path from 'path';

export type ParsedJsonObject = {
  value: Record<string, unknown>;
  salvaged: boolean;
};

function tryParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* inválido */
  }
  return null;
}

function scanJson(raw: string): { braces: number; inString: boolean } {
  let braces = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') braces += 1;
    else if (ch === '}') braces -= 1;
  }
  return { braces, inString };
}

function tryCloseObject(raw: string): Record<string, unknown> | null {
  let cur = raw.trim().replace(/,+\s*$/, '');
  const { inString } = scanJson(cur);
  if (inString) {
    const lastQuote = cur.lastIndexOf('"');
    cur = (lastQuote >= 0 ? cur.slice(0, lastQuote) : cur).replace(/,+\s*$/, '');
  }
  const { braces } = scanJson(cur);
  for (let extra = 0; extra <= Math.max(braces, 0) + 2; extra++) {
    const parsed = tryParseObject(cur + '}'.repeat(extra));
    if (parsed) return parsed;
  }
  return null;
}

/** Parse de objeto JSON; se o arquivo estiver truncado, recupera as chaves completas. */
export function parseJsonObjectLenient(raw: string): ParsedJsonObject | null {
  const trimmed = raw.trim();
  if (!trimmed) return { value: {}, salvaged: false };

  const exact = tryParseObject(trimmed);
  if (exact) return { value: exact, salvaged: false };

  let candidate = trimmed;
  for (let i = 0; i < 120; i++) {
    const parsed = tryCloseObject(candidate);
    if (parsed) return { value: parsed, salvaged: true };
    const lastComma = candidate.lastIndexOf(',');
    if (lastComma < 0) break;
    candidate = candidate.slice(0, lastComma);
  }
  return null;
}

function replaceFile(tmpPath: string, destPath: string): void {
  try {
    fs.renameSync(tmpPath, destPath);
  } catch {
    fs.copyFileSync(tmpPath, destPath);
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* tmp órfão não impede o write */
    }
  }
}

/** Grava JSON com arquivo temporário + rename (evita truncar no crash/deploy). */
export function atomicWriteJsonFile(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(tmpPath, payload, 'utf8');
  replaceFile(tmpPath, filePath);
}
