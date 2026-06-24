const SYSTEM_PROMPT = `Você é o assistente do ZapMass (painel WhatsApp em massa).
Responda em português do Brasil, de forma curta e prática (máximo 120 palavras).
Use apenas o contexto fornecido — não invente números ou status.
Se não souber, diga para abrir o menu "Como usar" ou a tela indicada.`;

export type LlmContext = {
  question: string;
  intent: string;
  contextBlock: string;
  currentView?: string;
};

function maxOutputTokens(): number {
  const n = Number(process.env.ASSISTANT_LLM_MAX_TOKENS ?? 256);
  return Number.isFinite(n) ? Math.min(1024, Math.max(64, Math.floor(n))) : 256;
}

function llmEnabled(): boolean {
  if (process.env.ASSISTANT_LLM_ENABLED === 'false') return false;
  return !!(process.env.GEMINI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim());
}

async function callGemini(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxOutputTokens(),
          temperature: 0.3
        }
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || null;
  } catch {
    return null;
  }
}

async function callGroq(prompt: string): Promise<string | null> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens(),
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export function isLlmAvailable(): boolean {
  return llmEnabled();
}

export async function polishWithLlm(ctx: LlmContext): Promise<string | null> {
  if (!llmEnabled()) return null;

  const prompt = `${SYSTEM_PROMPT}

Tela atual do usuário: ${ctx.currentView || 'desconhecida'}
Intenção detectada: ${ctx.intent}

Contexto (dados reais / documentação):
${ctx.contextBlock.slice(0, 4000)}

Pergunta do usuário:
${ctx.question.slice(0, 800)}

Responda de forma útil e direta.`;

  const groqFirst = !!process.env.GROQ_API_KEY?.trim();
  if (groqFirst) {
    const g = await callGroq(prompt);
    if (g) return g;
  }
  return callGemini(prompt);
}

export async function creativeWithLlm(question: string): Promise<string | null> {
  if (!llmEnabled()) return null;
  const prompt = `${SYSTEM_PROMPT}

O usuário pediu ajuda para escrever uma mensagem de WhatsApp em massa.
Use variáveis {nome} e {cidade} quando fizer sentido.
Inclua opção de opt-out (responder SAIR) se for marketing.

Pedido:
${question.slice(0, 600)}

Escreva apenas o texto da mensagem, sem explicações longas.`;

  const groqFirst = !!process.env.GROQ_API_KEY?.trim();
  if (groqFirst) {
    const g = await callGroq(prompt);
    if (g) return g;
  }
  return callGemini(prompt);
}
