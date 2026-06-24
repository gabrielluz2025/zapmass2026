import type { AssistantAskResult, AssistantHistoryMessage } from './assistantTypes.js';
import { classifyIntent, normalizeQuestionKey, resolveNavigateView } from './assistantRouter.js';
import { searchKnowledge, formatRagAnswer } from './assistantRag.js';
import {
  consumeQuota,
  getCachedAnswer,
  getRemainingQuota,
  setCachedAnswer
} from './assistantCache.js';
import {
  getOverviewAnswer,
  getContactsAnswer,
  getCampaignsAnswer,
  getConnectionsAnswer,
  getSubscriptionAnswer,
  getCreativeAnswer
} from './assistantTools.js';
import { creativeWithLlm, isLlmAvailable, polishWithLlm } from './assistantLlm.js';

const VIEW_LABELS: Record<string, string> = {
  connections: 'Conexões',
  contacts: 'Contatos',
  campaigns: 'Campanhas',
  chat: 'Bate-papo',
  dashboard: 'Painel',
  reports: 'Relatórios',
  warmup: 'Aquecimento',
  subscription: 'Minha assinatura',
  settings: 'Configurações',
  help: 'Como usar',
  team: 'Funcionários'
};

const STARTER_SUGGESTIONS = [
  'Quantos contatos tenho?',
  'Como conectar um chip WhatsApp?',
  'Resumo da minha conta',
  'Sugira uma mensagem de cobrança'
];

export function getStarterSuggestions(): string[] {
  return STARTER_SUGGESTIONS;
}

async function buildBaseAnswer(
  intent: ReturnType<typeof classifyIntent>,
  tenantId: string,
  question: string,
  allowLlm: boolean
): Promise<{ answer: string; navigateTo?: string; suggestions?: string[] }> {
  switch (intent) {
    case 'data_overview':
      return { answer: await getOverviewAnswer(tenantId) };
    case 'data_contacts':
      return { answer: await getContactsAnswer(tenantId, question), navigateTo: 'contacts' };
    case 'data_campaigns':
      return { answer: await getCampaignsAnswer(tenantId), navigateTo: 'campaigns' };
    case 'data_connections':
      return { answer: await getConnectionsAnswer(tenantId), navigateTo: 'connections' };
    case 'data_subscription':
      return { answer: await getSubscriptionAnswer(tenantId), navigateTo: 'subscription' };
    case 'navigate': {
      const view = resolveNavigateView(question);
      if (view) {
        return {
          answer: `Abra **${VIEW_LABELS[view] || view}** no menu lateral para acessar essa área.`,
          navigateTo: view
        };
      }
      return {
        answer: 'Use o menu lateral ou Ctrl+K (Buscar) para navegar. Diga qual área: Conexões, Contatos, Campanhas…'
      };
    }
    case 'creative': {
      const creative = getCreativeAnswer(question);
      if (allowLlm && isLlmAvailable()) {
        const llmText = await creativeWithLlm(question);
        if (llmText) {
          return {
            answer: `**Sugestão:**\n\n${llmText}\n\n_Variáveis {nome} e {cidade} funcionam nas campanhas. Edite antes de disparar._`,
            suggestions: creative.suggestions,
            navigateTo: 'campaigns'
          };
        }
      }
      return { answer: creative.answer, suggestions: creative.suggestions, navigateTo: 'campaigns' };
    }
    case 'tutorial':
    case 'unknown':
    default: {
      const hits = searchKnowledge(question, 3);
      const rag = formatRagAnswer(hits);
      if (rag) {
        return { answer: rag.answer, navigateTo: rag.navigateTo };
      }
      return {
        answer:
          'Não encontrei uma resposta exata. Tente perguntar sobre **Conexões**, **Contatos**, **Campanhas** ou peça um **resumo da conta**. Também pode abrir **Como usar** no menu Sistema.',
        navigateTo: 'help',
        suggestions: STARTER_SUGGESTIONS
      };
    }
  }
}

export async function handleAssistantAsk(params: {
  tenantId: string;
  actorId: string;
  question: string;
  currentView?: string;
  history?: AssistantHistoryMessage[];
  /** LLM externo (Gemini/Groq) — só administradores da plataforma. */
  allowLlm?: boolean;
}): Promise<AssistantAskResult | { ok: false; error: string; remainingToday: number }> {
  const question = params.question.trim().slice(0, 2000);
  if (question.length < 2) {
    const remaining = await getRemainingQuota(params.tenantId, params.actorId);
    return { ok: false, error: 'Escreva uma pergunta com pelo menos 2 caracteres.', remainingToday: remaining };
  }

  const qKey = normalizeQuestionKey(question);
  const cached = await getCachedAnswer(params.tenantId, qKey);
  const remainingBefore = await getRemainingQuota(params.tenantId, params.actorId);

  if (cached) {
    return {
      ok: true,
      answer: cached,
      intent: classifyIntent(question),
      source: 'cache',
      remainingToday: remainingBefore,
      usedLlm: false
    };
  }

  const quota = await consumeQuota(params.tenantId, params.actorId);
  if (!quota.ok) {
    return {
      ok: false,
      error: `Limite diário de perguntas atingido. Tente amanhã ou use o tutorial em **Como usar**.`,
      remainingToday: 0
    };
  }

  const intent = classifyIntent(question);
  let source: AssistantAskResult['source'] = intent.startsWith('data_') ? 'tools' : 'rag';
  let usedLlm = false;

  const base = await buildBaseAnswer(intent, params.tenantId, question, !!params.allowLlm);
  let answer = base.answer;

  const shouldPolish =
    !!params.allowLlm &&
    isLlmAvailable() &&
    process.env.ASSISTANT_LLM_POLISH !== 'false' &&
    (intent === 'tutorial' || intent === 'unknown') &&
    !intent.startsWith('data_');

  if (shouldPolish) {
    const polished = await polishWithLlm({
      question,
      intent,
      contextBlock: base.answer,
      currentView: params.currentView
    });
    if (polished) {
      answer = polished;
      source = 'llm';
      usedLlm = true;
    }
  } else if (intent === 'creative' && answer.includes('**Sugestão:**')) {
    source = 'llm';
    usedLlm = true;
  }

  if (base.navigateTo && !answer.includes('**')) {
    answer += `\n\n→ Abra **${VIEW_LABELS[base.navigateTo] || base.navigateTo}** no menu.`;
  }

  void setCachedAnswer(params.tenantId, qKey, answer);

  return {
    ok: true,
    answer,
    intent,
    source,
    suggestions: base.suggestions,
    navigateTo: base.navigateTo,
    remainingToday: quota.remaining,
    usedLlm
  };
}
