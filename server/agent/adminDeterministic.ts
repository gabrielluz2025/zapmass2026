import { classifyIntent } from '../assistant/assistantRouter.js';
import { formatRagAnswer, searchKnowledge } from './knowledgeService.js';
import { runAgentTool } from './toolRegistry.js';
import type { AgentToolContext } from './types.js';

const INTENT_TOOL: Partial<Record<ReturnType<typeof classifyIntent>, string>> = {
  data_contacts: 'contacts',
  data_campaigns: 'campaigns',
  data_connections: 'connections',
  data_subscription: 'subscription',
  data_overview: 'overview',
  data_chat: 'chat_conversations',
  data_geo: 'geo_leads',
  data_reports: 'reports_aggregates',
  creative: 'creative'
};

/** Resposta admin com ferramentas + RAG, sem API externa. */
export async function buildAdminFullDeterministicAnswer(params: {
  tenantId: string;
  actorId: string;
  screen: string;
  question: string;
  context?: unknown;
}): Promise<{ answer: string; navigateTo?: string }> {
  const ctx: AgentToolContext = {
    tenantId: params.tenantId,
    actorId: params.actorId,
    screen: params.screen,
    question: params.question,
    context: params.context,
    isPlatformAdmin: true
  };

  const intent = classifyIntent(params.question);
  const sections: string[] = [
    '_Modo plataforma (sem LLM externo)_ — dados ao vivo e documentação do sistema.',
    ''
  ];

  const screen = params.screen || 'geral';
  const qLower = params.question.toLowerCase();
  let toolId = INTENT_TOOL[intent] ?? 'overview';
  if (screen === 'admin-ops' || /\b(servidor|vps|load|postgres|ops)\b/.test(qLower)) {
    toolId = 'admin_ops_snapshot';
  }

  sections.push(await runAgentTool(toolId, ctx));

  if (toolId !== 'overview' && intent !== 'data_overview' && toolId !== 'admin_ops_snapshot') {
    sections.push(await runAgentTool('overview', ctx));
  }

  const hits = await searchKnowledge(params.question, 3, { screen });
  const rag = formatRagAnswer(hits);
  if (rag) {
    sections.push('', '**Do tutorial:**', rag.answer);
    return { answer: sections.join('\n'), navigateTo: rag.navigateTo };
  }

  return { answer: sections.join('\n') };
}
