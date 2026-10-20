import { vpsDataEnabled } from '../auth/dataMode.js';
import { getZapmassPool } from '../db/postgres.js';
import { CampaignStatus, ConnectionStatus } from '../../src/types.js';
import { conversationsPayloadForViewer } from '../conversationsEmit.js';
import * as evolutionService from '../evolutionService.js';
import { getConversations, resolveConnectionOwnerUid } from '../evolutionService.js';
import { buildLeadsGeoSummary } from '../leadsGeoService.js';
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

const AUDIT_TOOL_TIMEOUT_MS = 12_000;

async function withToolTimeout<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), AUDIT_TOOL_TIMEOUT_MS);
    })
  ]).catch(() => fallback);
}

/** Validação ampla da conta — várias ferramentas em paralelo, sem LLM. */
export async function buildSystemAuditAnswer(
  tenantId: string,
  _actorId: string
): Promise<{ answer: string; toolsUsed: string[] }> {
  const toolsUsed = ['overview', 'connections', 'campaigns', 'subscription'] as const;
  const timeoutNote = (section: string) => `**${section}:** consulta demorou demais — tente de novo em instantes.`;

  const [overview, connections, campaigns, subscription] = await Promise.all([
    withToolTimeout(() => getOverviewAnswer(tenantId), timeoutNote('Resumo')),
    withToolTimeout(() => getConnectionsAnswer(tenantId), timeoutNote('Chips')),
    withToolTimeout(() => getCampaignsAnswer(tenantId), timeoutNote('Campanhas')),
    withToolTimeout(() => getSubscriptionAnswer(tenantId), timeoutNote('Assinatura'))
  ]);

  const lines = [
    '**Validação rápida do sistema (dados ao vivo):**',
    '',
    overview,
    '',
    connections,
    '',
    campaigns,
    '',
    subscription,
    '',
    '**Checklist manual:**',
    '• Chips online antes de disparar campanha',
    '• Base importada e telefones normalizados',
    '• Intervalo entre envios respeitado (Configurações)',
    '• Assinatura ativa em **Minha assinatura**',
    '',
    '_Perguntas específicas (ex.: “chips online”, “última campanha”) trazem mais detalhe._'
  ];

  return { answer: lines.join('\n'), toolsUsed: [...toolsUsed] };
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

export async function getChatConversationsAnswer(
  tenantId: string,
  actorId: string,
  question: string
): Promise<string> {
  const scoped = conversationsPayloadForViewer(
    tenantId,
    actorId,
    getConversations(),
    resolveConnectionOwnerUid
  );
  const sorted = [...scoped].sort(
    (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
  );
  const naoLidas = sorted.reduce((s, c) => s + (c.unreadCount || 0), 0);
  const q = question.toLowerCase();
  const onlyUnread = /\b(nao lida|nao lidas|não lida|pendente|sem resposta)\b/.test(q);
  const pool = onlyUnread ? sorted.filter((c) => (c.unreadCount || 0) > 0) : sorted;
  const recent = pool.slice(0, 8);
  if (recent.length === 0) {
    return onlyUnread
      ? `**${scoped.length}** conversas no total e **nenhuma não lida** no momento.`
      : 'Nenhuma conversa no bate-papo ainda. Conecte um chip e aguarde mensagens entrarem.';
  }
  const lines = recent.map(
    (c) =>
      `• **${(c.contactName || c.waContactName || 'Sem nome').slice(0, 60)}** — ${c.unreadCount ? `${c.unreadCount} não lida(s)` : 'lida'} — ${(c.lastMessage || '').slice(0, 80)}`
  );
  return (
    `**Bate-papo:** ${scoped.length} conversa(s), **${naoLidas}** mensagem(ns) não lida(s) no total.\n\n` +
    `**${onlyUnread ? 'Com não lidas' : 'Recentes'}:**\n${lines.join('\n')}`
  );
}

export async function getGeoLeadsAnswer(tenantId: string, question: string): Promise<string> {
  if (!vpsDataEnabled() || !getZapmassPool()) {
    return 'Mapa e geo indisponíveis neste ambiente.';
  }
  const q = question.toLowerCase();
  const citySummary = await buildLeadsGeoSummary(tenantId, { layer: 'city', light: true });
  const stats = citySummary.stats;
  const topCities = Object.entries(citySummary.byCity)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `• ${k}: **${n.toLocaleString('pt-BR')}**`)
    .join('\n');

  const wantsNb = /\bbairro/.test(q);
  if (wantsNb) {
    const cityMatch = Object.keys(citySummary.byCity).find((c) => q.includes(c.toLowerCase().slice(0, 6)));
    const city = cityMatch || Object.keys(citySummary.byCity).sort((a, b) => citySummary.byCity[b] - citySummary.byCity[a])[0];
    if (city) {
      const nb = await buildLeadsGeoSummary(tenantId, { layer: 'neighborhood', city, light: true });
      const topNb = Object.entries(nb.byNeighborhood)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, n]) => `• ${k}: **${n.toLocaleString('pt-BR')}**`)
        .join('\n');
      return (
        `**Geo — ${city}:**\n\n${topNb || '_Sem bairros mapeados nesta cidade._'}\n\n` +
        `_Total na base: ${stats.totalContacts.toLocaleString('pt-BR')}; com bairro: ${stats.withNeighborhood.toLocaleString('pt-BR')}._`
      );
    }
  }

  const pctNb =
    stats.totalContacts > 0 ? Math.round((100 * stats.withNeighborhood) / stats.totalContacts) : 0;
  return (
    `**Mapa / leads:** ${stats.totalContacts.toLocaleString('pt-BR')} contatos; ` +
    `${stats.withCity.toLocaleString('pt-BR')} com cidade; ${stats.withNeighborhood.toLocaleString('pt-BR')} com bairro (**${pctNb}%**).\n\n` +
    `**Top cidades:**\n${topCities || '_Sem dados geo._'}`
  );
}

export async function getReportsAggregatesAnswer(tenantId: string): Promise<string> {
  if (!vpsDataEnabled() || !getZapmassPool()) {
    return 'Relatórios indisponíveis neste ambiente.';
  }
  const campaigns = await listCampaigns(tenantId);
  if (campaigns.length === 0) {
    return 'Ainda não há campanhas para agregar métricas. Crie uma campanha e volte em **Relatórios**.';
  }
  let sent = 0;
  let failed = 0;
  let replied = 0;
  let withSnapshot = 0;
  for (const c of campaigns) {
    const snap = c.reportSnapshot;
    if (!snap?.totals) continue;
    withSnapshot++;
    sent += snap.totals.sent ?? 0;
    replied += snap.totals.replied ?? 0;
    const rowsFailed = snap.rows?.filter((r) => r.status && !/^sent|delivered|read|replied/i.test(r.status)).length ?? 0;
    failed += rowsFailed;
  }
  const running = campaigns.filter(
    (c) => c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.WAITING_REPLY
  ).length;
  const replyPct = sent > 0 ? Math.round((100 * replied) / sent) : 0;
  const recent = campaigns.slice(0, 4).map((c) => {
    const s = c.reportSnapshot?.totals;
    const rp = s && s.sent ? Math.round((100 * (s.replied ?? 0)) / s.sent) : null;
    return `• **${c.name || 'Sem nome'}** (${c.status}) — enviados ${s?.sent ?? 0}, respostas ${s?.replied ?? 0}${rp != null ? ` (${rp}%)` : ''}`;
  });
  return (
    `**Relatórios (agregado):** ${campaigns.length} campanha(s), **${running}** ativa(s).\n\n` +
    `Com snapshot: **${withSnapshot}**. Totais: **${sent.toLocaleString('pt-BR')}** enviados, **${failed.toLocaleString('pt-BR')}** falhas, **${replied.toLocaleString('pt-BR')}** respostas (~**${replyPct}%** sobre enviados).\n\n` +
    `**Recentes:**\n${recent.join('\n')}`
  );
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
