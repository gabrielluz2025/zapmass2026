/**
 * Monta contexto com dados reais do tenant para o assistente IA (Gemini).
 */
import { CampaignStatus, type Campaign, type ContactList } from '../src/types.js';
import { conversationsPayloadForViewer } from './conversationsEmit.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import { getConnections, getConversations, resolveConnectionOwnerUid } from './evolutionService.js';
import { buildLeadsGeoSummary } from './leadsGeoService.js';
import { listCampaigns } from './repositories/campaignsRepository.js';
import { listContactLists } from './repositories/contactListsRepository.js';
import { countContactsCached } from './repositories/contactsRepository.js';

const SCREEN_GUIDES: Record<string, string> = {
  dashboard:
    'Painel: visão geral da conta — total de contatos, campanhas, chips WhatsApp, mapa resumido e radar de disparos.',
  contacts:
    'Contatos: CRM com importação (arquivo ou colar texto), listas, segmentos, aniversários, edição individual.',
  'contacts-map':
    'Mapa dos contatos: distribuição por bairro/cidade, temperatura do relacionamento, campanhas por região.',
  campaigns: 'Campanhas: disparos em massa, agendamento, fluxo com gatilhos de resposta, anexos.',
  connections: 'Conexões: chips WhatsApp (QR code, status, fila de envio, limite diário).',
  chat: 'Bate-papo: conversas WhatsApp em tempo real.',
  reports: 'Relatórios: desempenho de envios e campanhas.',
  warmup: 'Aquecimento: rotina para preparar chips novos antes de campanhas.',
  settings: 'Configurações: perfil, segmento, localização padrão do mapa.',
  subscription: 'Minha assinatura: plano, trial, pagamento.',
  help: 'Como usar: tutorial do sistema.',
  'admin-ops':
    'Operações servidor: RAM, load, canais offline, integrações (Firebase), manutenção VPS, cron de monitor, alertas de load/Postgres.',
};

const ZAPMASS_OVERVIEW =
  'Módulos ZapMass: Painel, Contatos (importar/organizar), Mapa territorial, Campanhas WhatsApp, Conexões (chips), ' +
  'Bate-papo, Relatórios, Aquecimento de chips, Equipe/funcionários, Assinatura.';

export type AiTenantSnapshot = {
  geradoEm: string;
  tela: string;
  guiaTela: string;
  contatos: {
    total: number;
    comCidade: number;
    comBairro: number;
    pctComBairro: number;
    topCidades: Array<{ cidade: string; total: number }>;
    cidadeConsultada: string | null;
    porBairro: Array<{ bairro: string; total: number }> | null;
  };
  campanhas: {
    total: number;
    ativas: number;
    agendadas: number;
    concluidas: number;
    rascunho: number;
    recentes: Array<{ nome: string; status: string; contatos: number; enviados: number }>;
    detalhadas: Array<{
      nome: string;
      status: string;
      contatosAlvo: number;
      processados: number;
      enviados: number;
      falhas: number;
      lista: string | null;
      taxaRespostaPct: number | null;
    }>;
    consultada: {
      nome: string;
      status: string;
      contatosAlvo: number;
      processados: number;
      enviados: number;
      falhas: number;
      lista: string | null;
      taxaEntregaPct: number | null;
      taxaLeituraPct: number | null;
      taxaRespostaPct: number | null;
      etapas: Array<{ etapa: number; enviados: number; respostas: number }>;
    } | null;
  };
  listas: {
    total: number;
    principais: Array<{ nome: string; contatos: number; descricao: string | null }>;
    consultada: { nome: string; contatos: number; descricao: string | null } | null;
  };
  conversas: {
    total: number;
    naoLidas: number;
    recentes: Array<{
      nome: string;
      telefone: string;
      ultimaMensagem: string;
      horario: string;
      naoLidas: number;
    }>;
  };
  chips: {
    total: number;
    conectados: number;
    desconectados: number;
    filaTotal: number;
    enviosHoje: number;
  };
  contextoCliente?: unknown;
};

function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function findCityInQuestion(question: string, byCity: Record<string, number>): string | null {
  const q = normalizeForMatch(question);
  let best: string | null = null;
  let bestLen = 0;
  for (const cityKey of Object.keys(byCity)) {
    const cityName = normalizeForMatch((cityKey.split('·')[0] || cityKey).trim());
    if (cityName.length < 3) continue;
    if (q.includes(cityName) && cityName.length > bestLen) {
      best = cityKey;
      bestLen = cityName.length;
    }
  }
  return best;
}

function wantsNeighborhoodBreakdown(question: string): boolean {
  const q = normalizeForMatch(question);
  return /\b(bairro|bairros|vizinhanca|regiao|por bairro)\b/.test(q);
}

function wantsConversationData(question: string, screen: string): boolean {
  const q = normalizeForMatch(question);
  if (screen === 'chat') return true;
  return /\b(conversa|conversas|bate-papo|chat|mensagem|mensagens|nao lida|nao lidas|inbox|whatsapp|respondeu|responder)\b/.test(
    q
  );
}

function wantsCampaignDetail(question: string, screen: string): boolean {
  const q = normalizeForMatch(question);
  if (screen === 'campaigns') return true;
  return /\b(campanha|campanhas|disparo|disparos|envio|enviados|resposta|taxa|funil)\b/.test(q);
}

function findEntityByNameInQuestion<T extends { name: string }>(
  question: string,
  items: T[]
): T | null {
  const q = normalizeForMatch(question);
  let best: T | null = null;
  let bestLen = 0;
  for (const item of items) {
    const name = normalizeForMatch(item.name);
    if (name.length < 3) continue;
    if (q.includes(name) && name.length > bestLen) {
      best = item;
      bestLen = name.length;
    }
  }
  return best;
}

function findCampaignInQuestion(question: string, campaigns: Campaign[]): Campaign | null {
  const byName = findEntityByNameInQuestion(question, campaigns);
  if (byName) return byName;
  const q = normalizeForMatch(question);
  if (!/\b(ultima|recente|ativa|agendada|concluida)\b/.test(q) || campaigns.length === 0) return null;
  if (/\bativa\b/.test(q)) {
    return (
      campaigns.find(
        (c) => c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.WAITING_REPLY
      ) ?? null
    );
  }
  if (/\bagendada\b/.test(q)) {
    return campaigns.find((c) => c.status === CampaignStatus.SCHEDULED) ?? null;
  }
  if (/\bconcluida\b/.test(q)) {
    return campaigns.find((c) => c.status === CampaignStatus.COMPLETED) ?? null;
  }
  return campaigns[0] ?? null;
}

function campaignDetailBlock(c: Campaign) {
  const funnel = c.reportSnapshot?.stageFunnels?.[0];
  return {
    nome: c.name,
    status: c.status,
    contatosAlvo: c.totalContacts || 0,
    processados: c.processedCount || 0,
    enviados: c.successCount || 0,
    falhas: c.failedCount || 0,
    lista: c.contactListName || null,
    taxaEntregaPct: funnel?.deliveryPct ?? null,
    taxaLeituraPct: funnel?.readPct ?? null,
    taxaRespostaPct: funnel?.replyPct ?? null,
    etapas: (c.reportSnapshot?.stageFunnels || []).slice(0, 5).map((s) => ({
      etapa: s.stageNumber,
      enviados: s.sent,
      respostas: s.replied,
    })),
  };
}

function buildConversationSummary(tenantId: string, authUid: string, question: string) {
  const scoped = conversationsPayloadForViewer(
    tenantId,
    authUid,
    getConversations(),
    resolveConnectionOwnerUid
  );
  const sorted = [...scoped].sort(
    (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)
  );
  const naoLidas = sorted.reduce((s, c) => s + (c.unreadCount || 0), 0);
  const q = normalizeForMatch(question);
  const onlyUnread = /\b(nao lida|nao lidas|pendente|sem resposta)\b/.test(q);
  const pool = onlyUnread ? sorted.filter((c) => (c.unreadCount || 0) > 0) : sorted;
  return {
    total: scoped.length,
    naoLidas,
    recentes: pool.slice(0, 12).map((c) => ({
      nome: (c.contactName || c.waContactName || 'Sem nome').slice(0, 80),
      telefone: (c.contactPhone || '').replace(/\D/g, '').slice(-11),
      ultimaMensagem: (c.lastMessage || '').replace(/\s+/g, ' ').slice(0, 100),
      horario: c.lastMessageTime || '',
      naoLidas: c.unreadCount || 0,
    })),
  };
}

function listSummaryBlock(lists: ContactList[]) {
  return lists
    .map((l) => ({
      nome: l.name,
      contatos: l.contactIds?.length || 0,
      descricao: l.description?.trim() || null,
    }))
    .sort((a, b) => b.contatos - a.contatos)
    .slice(0, 15);
}

function topEntries(rec: Record<string, number>, limit: number): Array<{ label: string; count: number }> {
  return Object.entries(rec)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export async function buildAiTenantSnapshot(
  tenantId: string,
  authUid: string,
  screen: string,
  question: string,
  clientContext?: unknown
): Promise<AiTenantSnapshot> {
  const [totalContacts, geoCity, campaigns, contactLists] = await Promise.all([
    countContactsCached(tenantId),
    buildLeadsGeoSummary(tenantId, { layer: 'city', light: true }),
    listCampaigns(tenantId),
    listContactLists(tenantId),
  ]);

  const cityHint = findCityInQuestion(question, geoCity.byCity);
  const needNb =
    wantsNeighborhoodBreakdown(question) || cityHint !== null;

  let porBairro: Array<{ bairro: string; total: number }> | null = null;
  let cidadeConsultada: string | null = cityHint;

  if (needNb && cityHint) {
    const nb = await buildLeadsGeoSummary(tenantId, {
      layer: 'neighborhood',
      city: cityHint,
      light: true,
    });
    porBairro = topEntries(nb.byNeighborhood, 35).map((x) => ({
      bairro: x.label,
      total: x.count,
    }));
  } else if (needNb && !cityHint) {
    const top = topEntries(geoCity.byCity, 1)[0];
    if (top && /\b(em|de|na|no|cidade)\b/.test(normalizeForMatch(question))) {
      const matchKey = Object.keys(geoCity.byCity).find(
        (k) => normalizeForMatch(k).includes(normalizeForMatch(top.label.split('·')[0] || top.label))
      );
      if (matchKey) {
        cidadeConsultada = matchKey;
        const nb = await buildLeadsGeoSummary(tenantId, {
          layer: 'neighborhood',
          city: matchKey,
          light: true,
        });
        porBairro = topEntries(nb.byNeighborhood, 35).map((x) => ({
          bairro: x.label,
          total: x.count,
        }));
      }
    }
  }

  const stats = geoCity.stats;
  const pctBairro =
    stats.totalContacts > 0 ? Math.round((100 * stats.withNeighborhood) / stats.totalContacts) : 0;

  const campaignCounts = {
    total: campaigns.length,
    ativas: 0,
    agendadas: 0,
    concluidas: 0,
    rascunho: 0,
  };
  for (const c of campaigns) {
    if (c.status === CampaignStatus.RUNNING || c.status === CampaignStatus.WAITING_REPLY)
      campaignCounts.ativas++;
    else if (c.status === CampaignStatus.SCHEDULED || c.status === CampaignStatus.PAUSED)
      campaignCounts.agendadas++;
    else if (c.status === CampaignStatus.COMPLETED) campaignCounts.concluidas++;
    else if (c.status === CampaignStatus.DRAFT) campaignCounts.rascunho++;
  }

  const conns = filterByConnectionScope(tenantId, getConnections());
  let filaTotal = 0;
  let enviosHoje = 0;
  let conectados = 0;
  for (const c of conns) {
    filaTotal += c.queueSize || 0;
    enviosHoje += c.messagesSentToday || 0;
    if (c.status === 'CONNECTED' || (c.status as string) === 'open') conectados++;
  }

  const campaignMatch = findCampaignInQuestion(question, campaigns);
  const listMatch = findEntityByNameInQuestion(question, contactLists);

  const listasPrincipais = listSummaryBlock(contactLists);
  const convFull = buildConversationSummary(tenantId, authUid, question);
  const includeRecentConversas =
    wantsConversationData(question, screen) || screen === 'dashboard' || screen === 'chat';
  const conversas = {
    total: convFull.total,
    naoLidas: convFull.naoLidas,
    recentes: includeRecentConversas ? convFull.recentes : [],
  };

  const campanhasDetalhadas = wantsCampaignDetail(question, screen)
    ? campaigns.slice(0, 10).map((c) => {
        const d = campaignDetailBlock(c);
        return {
          nome: d.nome,
          status: d.status,
          contatosAlvo: d.contatosAlvo,
          processados: d.processados,
          enviados: d.enviados,
          falhas: d.falhas,
          lista: d.lista,
          taxaRespostaPct: d.taxaRespostaPct,
        };
      })
    : [];

  return {
    geradoEm: new Date().toISOString(),
    tela: screen,
    guiaTela: SCREEN_GUIDES[screen] || ZAPMASS_OVERVIEW,
    contatos: {
      total: totalContacts,
      comCidade: stats.withCity,
      comBairro: stats.withNeighborhood,
      pctComBairro: pctBairro,
      topCidades: topEntries(geoCity.byCity, 15).map((x) => ({ cidade: x.label, total: x.count })),
      cidadeConsultada,
      porBairro,
    },
    campanhas: {
      ...campaignCounts,
      recentes: campaigns.slice(0, 6).map((c) => ({
        nome: c.name,
        status: c.status,
        contatos: c.totalContacts || 0,
        enviados: c.successCount || 0,
      })),
      detalhadas: campanhasDetalhadas,
      consultada: campaignMatch ? campaignDetailBlock(campaignMatch) : null,
    },
    listas: {
      total: contactLists.length,
      principais: listasPrincipais,
      consultada: listMatch
        ? {
            nome: listMatch.name,
            contatos: listMatch.contactIds?.length || 0,
            descricao: listMatch.description?.trim() || null,
          }
        : null,
    },
    conversas,
    chips: {
      total: conns.length,
      conectados,
      desconectados: Math.max(0, conns.length - conectados),
      filaTotal,
      enviosHoje,
    },
    contextoCliente: clientContext,
  };
}

export function buildAiAssistSystemInstruction(screen?: string): string {
  const base =
    'Você é o assistente inteligente do ZapMass (CRM + campanhas WhatsApp, Brasil). ' +
    'Você RECEBE um bloco JSON "DADOS AO VIVO" com números reais da conta do usuário. ' +
    'REGRAS: (1) Use APENAS números e listas desse JSON — nunca invente totais. ' +
    '(2) contatos.porBairro / topCidades para geo; campanhas.consultada ou detalhadas para disparos; ' +
    'listas.principais ou listas.consultada para listas; conversas.recentes e conversas.naoLidas para bate-papo. ' +
    '(3) Se faltar dado, diga o que existe e sugira abrir Contatos, Mapa, Campanhas ou Bate-papo. ' +
    '(4) Formate números em pt-BR (ex.: 3.200). (5) Responda em português do Brasil, prático, com bullets. ' +
    '(6) Máximo 14 frases.';
  if (screen === 'admin-ops') {
    return (
      base +
      ' TELA admin-ops: se contextoCliente.relatorioServidor existir, analise opsSnapshot e vpsMaintenance ' +
      '(load, Postgres CPU, índice Evolution, alertas, cron). Diga se operação está normal, riscos e próximos passos. ' +
      'Load > 4 ou Postgres > 80% com Evolution Up são limiares de alerta. Não confunda pico pós-deploy com crise sustentada.'
    );
  }
  return base;
}

export function buildAiAssistUserPrompt(
  screen: string,
  question: string,
  snapshot: AiTenantSnapshot
): string {
  const dados = JSON.stringify(snapshot);
  const dadosTrim = dados.length > 20_000 ? `${dados.slice(0, 20_000)}…` : dados;
  return (
    `DADOS AO VIVO (JSON):\n${dadosTrim}\n\n` +
    `TELA ATUAL: ${screen}\n` +
    `PERGUNTA DO USUÁRIO: ${question}`
  );
}
