/**
 * Integração Google Gemini (API key no servidor — nunca expor no front).
 * Configure GEMINI_API_KEY e opcionalmente GEMINI_MODEL no .env da VPS.
 */

/** Substitui gemini-2.0-flash (desligado em jun/2026). Ver changelog Google Gemini API. */
const DEFAULT_MODEL = 'gemini-3.5-flash';

const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite'] as const;

export function isGeminiConfigured(): boolean {
  return Boolean((process.env.GEMINI_API_KEY || '').trim());
}

function geminiModel(): string {
  return (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function modelsToTry(): string[] {
  const primary = geminiModel();
  const chain = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
  return [...new Set(chain)];
}

function isModelUnavailableError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('no longer available') ||
    m.includes('not found') ||
    m.includes('is not supported') ||
    m.includes('has been shut down') ||
    m.includes('was not found')
  );
}

export function extractJsonFromModelText<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.search(/[\[{]/);
  if (start < 0) throw new Error('Resposta da IA sem JSON válido.');
  const slice = candidate.slice(start);
  const endObj = slice.lastIndexOf('}');
  const endArr = slice.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (end < 0) throw new Error('Resposta da IA sem JSON válido.');
  return JSON.parse(slice.slice(0, end + 1)) as T;
}

export async function geminiGenerateText(
  userPrompt: string,
  systemInstruction?: string,
  options?: { jsonMode?: boolean }
): Promise<string> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no servidor.');
  }

  const generationConfig: Record<string, unknown> = {
    temperature: 0.25,
    maxOutputTokens: 8192,
  };
  if (options?.jsonMode !== false) {
    generationConfig.responseMimeType = 'application/json';
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig,
  };
  if (systemInstruction?.trim()) {
    body.systemInstruction = { parts: [{ text: systemInstruction.trim() }] };
  }

  let lastError = 'Falha na IA.';
  for (const model of modelsToTry()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    if (!res.ok) {
      const msg = json.error?.message || `Gemini HTTP ${res.status}`;
      lastError = msg;
      if (isModelUnavailableError(msg)) continue;
      throw new Error(msg);
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    if (!text) {
      lastError = 'Resposta vazia da IA.';
      continue;
    }
    return text;
  }

  throw new Error(lastError);
}

export async function geminiGenerateJson<T>(
  userPrompt: string,
  systemInstruction?: string
): Promise<T> {
  const text = await geminiGenerateText(userPrompt, systemInstruction);
  return extractJsonFromModelText<T>(text);
}
