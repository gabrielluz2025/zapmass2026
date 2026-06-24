/**
 * Monta contexto com dados reais do tenant para o assistente IA (Gemini).
 */
import { CampaignStatus } from '../src/types.js';
import { filterByConnectionScope } from './connectionScopeServer.js';
import { getConnections } from './evolutionService.js';
import { buildLeadsGeoSummary } from './leadsGeoService.js';
import { listCampaigns } from './repositories/campaignsRepository.js';
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

function topEntries(rec: Record<string, number>, limit: number): Array<{ label: string; count: number }> {
  return Object.entries(rec)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export async function buildAiTenantSnapshot(
  tenantId: string,
  screen: string,
  question: string,
  clientContext?: unknown
): Promise<AiTenantSnapshot> {
  const [totalContacts, geoCity, campaigns] = await Promise.all([
    countContactsCached(tenantId),
    buildLeadsGeoSummary(tenantId, { layer: 'city', light: true }),
    listCampaigns(tenantId),
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
    },
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

export function buildAiAssistSystemInstruction(): string {
  return (
    'Você é o assistente inteligente do ZapMass (CRM + campanhas WhatsApp, Brasil). ' +
    'Você RECEBE um bloco JSON "DADOS AO VIVO" com números reais da conta do usuário. ' +
    'REGRAS: (1) Use APENAS números e listas desse JSON — nunca invente totais. ' +
    '(2) Se faltar dado (ex.: bairro não listado), diga o que existe e sugira abrir Contatos ou Mapa. ' +
    '(3) Formate números em pt-BR (ex.: 3.200). (4) Para "por bairro", use contatos.porBairro ou topCidades. ' +
    '(5) Responda em português do Brasil, prático, com bullets quando listar bairros/cidades. ' +
    '(6) Máximo 12 frases. (7) Pode mencionar atalhos do app (Contatos, Mapa, Campanhas).'
  );
}

export function buildAiAssistUserPrompt(
  screen: string,
  question: string,
  snapshot: AiTenantSnapshot
): string {
  const dados = JSON.stringify(snapshot);
  const dadosTrim = dados.length > 14_000 ? `${dados.slice(0, 14_000)}…` : dados;
  return (
    `DADOS AO VIVO (JSON):\n${dadosTrim}\n\n` +
    `TELA ATUAL: ${screen}\n` +
    `PERGUNTA DO USUÁRIO: ${question}`
  );
}
