import { vpsDataEnabled } from '../auth/dataMode.js';
import { getZapmassPool } from '../db/postgres.js';
import { ConnectionStatus } from '../../src/types.js';
import * as evolutionService from '../evolutionService.js';
import { listCampaigns } from '../repositories/campaignsRepository.js';
import { countContactsCached, listContacts } from '../repositories/contactsRepository.js';
import { getUserSubscription } from '../subscriptionStore.js';
import { CREATIVE_TEMPLATES } from './knowledgeChunks.js';

function tenantConnections(tenantId: string) {
  return evolutionService.getConnections().filter((c) => c.ownerUid === tenantId);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function subscriptionLabel(
  status: string | undefined,
  trialEnds?: string | null,
  accessEnds?: string | null
): string {
  if (status === 'active') return `Plano ativo${accessEnds ? ` até ${fmtDate(accessEnds)}` : ''}.`;
  if (status === 'trialing') return `Período de teste${trialEnds ? ` até ${fmtDate(trialEnds)}` : ''}.`;
  if (status === 'past_due') return 'Pagamento pendente — regularize em Minha assinatura.';
  if (status === 'canceled') return 'Assinatura cancelada.';
  return 'Sem assinatura ativa — algumas ações podem estar bloqueadas.';
}

export async function getOverviewAnswer(tenantId: string): Promise<string> {
  const lines: string[] = ['**Resumo da sua conta:**', ''];

  if (vpsDataEnabled() && getZapmassPool()) {
    const totalContacts = await countContactsCached(tenantId);
    lines.push(`• **Contatos:** ${totalContacts.toLocaleString('pt-BR')}`);

    const campaigns = await listCampaigns(tenantId);
    const byStatus = campaigns.reduce<Record<string, number>>((acc, c) => {
      const s = String(c.status || 'unknown');
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const active = (byStatus.RUNNING || 0) + (byStatus.SCHEDULED || 0) + (byStatus.PAUSED || 0);
    lines.push(`• **Campanhas:** ${campaigns.length} total (${active} em andamento/pausadas/agendadas)`);
  } else {
    lines.push('• Dados detalhados indisponíveis neste modo.');
  }

  const conns = tenantConnections(tenantId);
  const online = conns.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
  lines.push(`• **Chips:** ${conns.length} cadastrados, ${online} online`);

  const sub = await getUserSubscription(tenantId);
  const status = sub?.status ?? 'none';
  lines.push(
    `• **Assinatura:** ${subscriptionLabel(status, sub?.trialEndsAt as string, sub?.accessEndsAt as string)}`
  );

  return lines.join('\n');
}

export async function getContactsAnswer(tenantId: string, question: string): Promise<string> {
  if (!vpsDataEnabled() || !getZapmassPool()) {
    return 'Contagem de contatos não disponível neste ambiente.';
  }
  const total = await countContactsCached(tenantId);
  const q = question.toLowerCase();
  const searchTerms = q.replace(/quantos contatos|total de contatos|buscar contato|contato/gi, '').trim();

  if (searchTerms.length >= 3 && (q.includes('buscar') || q.includes('achar') || q.includes('nome'))) {
    const all = await listContacts(tenantId, { limit: 500, offset: 0 });
    const term = searchTerms.toLowerCase();
    const matches = all
      .filter(
        (c) =>
          String(c.name || '').toLowerCase().includes(term) ||
          String(c.phone || '').includes(term.replace(/\D/g, ''))
      )
      .slice(0, 5);
    if (matches.length === 0) {
      return `Você tem **${total.toLocaleString('pt-BR')}** contatos, mas não encontrei ninguém com "${searchTerms}".`;
    }
    const list = matches.map((c) => `• ${c.name || 'Sem nome'} — ${c.phone || '?'}`).join('\n');
    return `Encontrei ${matches.length} contato(s) (de ${total.toLocaleString('pt-BR')} no total):\n\n${list}`;
  }

  return `Você tem **${total.toLocaleString('pt-BR')}** contatos na base. Abra **Contatos** para filtrar, importar ou criar listas.`;
}

export async function getCampaignsAnswer(tenantId: string): Promise<string> {
  if (!vpsDataEnabled() || !getZapmassPool()) {
    return 'Dados de campanhas indisponíveis neste ambiente.';
  }
  const campaigns = await listCampaigns(tenantId);
  if (campaigns.length === 0) {
    return 'Você ainda não tem campanhas. Vá em **Campanhas → Nova campanha** para criar a primeira.';
  }
  const byStatus = campaigns.reduce<Record<string, number>>((acc, c) => {
    const s = String(c.status || 'DRAFT');
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const statusLine = Object.entries(byStatus)
    .map(([s, n]) => `${s}: ${n}`)
    .join(', ');
  const recent = campaigns.slice(0, 5);
  const recentLines = recent
    .map((c) => `• **${c.name || 'Sem nome'}** — ${c.status} (${c.processedCount ?? 0} processados)`)
    .join('\n');
  return `**${campaigns.length}** campanhas no total.\n\nStatus: ${statusLine}\n\n**Recentes:**\n${recentLines}`;
}

export async function getConnectionsAnswer(tenantId: string): Promise<string> {
  const conns = tenantConnections(tenantId);
  if (conns.length === 0) {
    return 'Nenhum chip cadastrado. Vá em **Conexões → Adicionar conexão** e escaneie o QR Code.';
  }
  const lines = conns.map((c) => `• **${c.name || c.id}** — ${c.status}`);
  const online = conns.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
  return `**${conns.length}** chip(s), **${online}** online:\n\n${lines.join('\n')}`;
}

export async function getSubscriptionAnswer(tenantId: string): Promise<string> {
  const sub = await getUserSubscription(tenantId);
  if (!sub) {
    return 'Não encontrei dados de assinatura. Abra **Minha assinatura** para ver plano e pagamento.';
  }
  const lines = [
    `**Status:** ${sub.status ?? 'none'}`,
    sub.plan ? `**Plano:** ${sub.plan}` : null,
    sub.trialEndsAt ? `**Teste até:** ${fmtDate(sub.trialEndsAt as string)}` : null,
    sub.accessEndsAt ? `**Acesso até:** ${fmtDate(sub.accessEndsAt as string)}` : null,
    sub.includedChannels != null ? `**Canais incluídos:** ${sub.includedChannels}` : null,
    '',
    subscriptionLabel(sub.status, sub.trialEndsAt as string, sub.accessEndsAt as string)
  ].filter(Boolean);
  return lines.join('\n');
}

export function getCreativeAnswer(question: string): { answer: string; suggestions: string[] } {
  const q = question.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  let best = CREATIVE_TEMPLATES[0];
  let bestScore = 0;
  for (const tpl of CREATIVE_TEMPLATES) {
    let score = 0;
    for (const kw of tpl.keywords) {
      if (q.includes(kw)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tpl;
    }
  }

  const suggestions = CREATIVE_TEMPLATES.map((t) => t.label);
  const answer =
    bestScore > 0
      ? `**${best.label}**\n\n${best.body}\n\n_Variáveis como {nome} e {cidade} são substituídas na campanha. Edite antes de disparar._`
      : `Posso sugerir modelos prontos. Exemplo genérico:\n\nOlá {nome}! Passando para manter contato. Se preferir não receber mensagens, responda SAIR.\n\n_Diga o objetivo (cobrança, convite, aviso) para um modelo mais específico._`;

  return { answer, suggestions };
}
