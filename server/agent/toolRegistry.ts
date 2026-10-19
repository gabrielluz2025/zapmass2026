import {
  getOverviewAnswer,
  getContactsAnswer,
  getCampaignsAnswer,
  getConnectionsAnswer,
  getSubscriptionAnswer,
  getCreativeAnswer
} from '../assistant/assistantTools.js';
import {
  buildAiTenantSnapshot,
  buildAiAssistSystemInstruction,
  buildAiAssistUserPrompt
} from '../aiContextService.js';
import type { AgentToolContext, AgentToolDefinition } from './types.js';

export const AGENT_TOOLS: AgentToolDefinition[] = [
  { id: 'overview', label: 'Resumo da conta', scope: 'tenant', description: 'Totais de contatos, campanhas, chips e assinatura.' },
  { id: 'contacts', label: 'Contatos', scope: 'tenant', description: 'Contagem e busca simples na base.' },
  { id: 'campaigns', label: 'Campanhas', scope: 'tenant', description: 'Status e campanhas recentes.' },
  { id: 'connections', label: 'Conexões', scope: 'tenant', description: 'Chips WhatsApp e status online.' },
  { id: 'subscription', label: 'Assinatura', scope: 'tenant', description: 'Plano, trial e pagamento.' },
  { id: 'creative', label: 'Mensagens', scope: 'tenant', description: 'Modelos criativos para campanhas.' },
  {
    id: 'tenant_snapshot',
    label: 'Snapshot ao vivo',
    scope: 'platform',
    description: 'JSON completo da conta para IA (admin).'
  }
];

export async function runAgentTool(toolId: string, ctx: AgentToolContext): Promise<string> {
  switch (toolId) {
    case 'overview':
      return getOverviewAnswer(ctx.tenantId);
    case 'contacts':
      return getContactsAnswer(ctx.tenantId, ctx.question);
    case 'campaigns':
      return getCampaignsAnswer(ctx.tenantId);
    case 'connections':
      return getConnectionsAnswer(ctx.tenantId);
    case 'subscription':
      return getSubscriptionAnswer(ctx.tenantId);
    case 'creative': {
      const c = getCreativeAnswer(ctx.question);
      return c.answer;
    }
    case 'tenant_snapshot': {
      const snapshot = await buildAiTenantSnapshot(
        ctx.tenantId,
        ctx.actorId,
        ctx.screen,
        ctx.question,
        ctx.context
      );
      return JSON.stringify(snapshot, null, 0);
    }
    default:
      return `Ferramenta desconhecida: ${toolId}`;
  }
}

export async function buildAdminFullPrompt(params: {
  screen: string;
  question: string;
  tenantId: string;
  actorId: string;
  context?: unknown;
  systemExtra?: string;
}): Promise<{ systemInstruction: string; userPrompt: string }> {
  const snapshot = await buildAiTenantSnapshot(
    params.tenantId,
    params.actorId,
    params.screen,
    params.question,
    params.context
  );
  let systemInstruction = buildAiAssistSystemInstruction(params.screen);
  if (params.systemExtra?.trim()) {
    systemInstruction += `\n\nInstruções adicionais da plataforma:\n${params.systemExtra.trim().slice(0, 2000)}`;
  }
  return {
    systemInstruction,
    userPrompt: buildAiAssistUserPrompt(params.screen, params.question, snapshot)
  };
}
