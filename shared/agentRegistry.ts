/** Definições estáticas dos agentes lógicos por tela (compartilhado client/server). */

export type ScreenAgentSeed = {
  screenKey: string;
  profileId: string;
  name: string;
  tagline: string;
  tags: string[];
  /** Ferramentas sugeridas quando a intenção não restringe. */
  defaultEnabledTools: string[];
};

export type OrchestratorSeed = {
  id: 'zapmass-core';
  name: string;
  tagline: string;
  tags: string[];
  defaultEnabledTools: string[];
};

export const ORCHESTRATOR_AGENT: OrchestratorSeed = {
  id: 'zapmass-core',
  name: 'ZapMass Core',
  tagline: 'Orquestrador único — roteia contexto, ferramentas e personas por tela',
  tags: ['orquestrador', 'meta-agente', 'plataforma'],
  defaultEnabledTools: [
    'overview',
    'contacts',
    'campaigns',
    'connections',
    'subscription',
    'creative',
    'chat_conversations',
    'geo_leads',
    'reports_aggregates',
    'tenant_snapshot',
    'admin_ops_snapshot'
  ]
};

/** Um agente lógico por aba principal do app (padrão Bruno Picinini: agentes focados + orquestrador). */
export const SCREEN_AGENTS: ScreenAgentSeed[] = [
  {
    screenKey: 'dashboard',
    profileId: 'radar',
    name: 'Radar',
    tagline: 'Visão geral e saúde da conta',
    tags: ['painel', 'métricas'],
    defaultEnabledTools: ['overview', 'reports_aggregates', 'connections', 'campaigns']
  },
  {
    screenKey: 'connections',
    profileId: 'torre',
    name: 'Torre',
    tagline: 'Chips WhatsApp e filas',
    tags: ['chips', 'evolution'],
    defaultEnabledTools: ['connections', 'overview']
  },
  {
    screenKey: 'contacts',
    profileId: 'arquivo',
    name: 'Arquivo',
    tagline: 'Base, listas e importação',
    tags: ['contatos', 'importação'],
    defaultEnabledTools: ['contacts', 'geo_leads']
  },
  {
    screenKey: 'contacts-map',
    profileId: 'mapa',
    name: 'Mapa',
    tagline: 'Geo e território',
    tags: ['mapa', 'geo'],
    defaultEnabledTools: ['geo_leads', 'contacts']
  },
  {
    screenKey: 'campaigns',
    profileId: 'disparo',
    name: 'Disparador',
    tagline: 'Campanhas e métricas',
    tags: ['campanhas', 'disparo'],
    defaultEnabledTools: ['campaigns', 'creative', 'reports_aggregates']
  },
  {
    screenKey: 'chat',
    profileId: 'inbox',
    name: 'Inbox',
    tagline: 'Conversas e não lidas',
    tags: ['chat', 'inbox'],
    defaultEnabledTools: ['chat_conversations', 'connections']
  },
  {
    screenKey: 'reports',
    profileId: 'metricas',
    name: 'Métricas',
    tagline: 'Relatórios e funil',
    tags: ['relatórios', 'funil'],
    defaultEnabledTools: ['reports_aggregates', 'campaigns', 'overview']
  },
  {
    screenKey: 'warmup',
    profileId: 'forja',
    name: 'Forja',
    tagline: 'Aquecimento de chips',
    tags: ['warmup', 'chips'],
    defaultEnabledTools: ['connections', 'overview']
  },
  {
    screenKey: 'subscription',
    profileId: 'plano',
    name: 'Plano',
    tagline: 'Assinatura e trial',
    tags: ['billing', 'assinatura'],
    defaultEnabledTools: ['subscription', 'overview']
  },
  {
    screenKey: 'settings',
    profileId: 'ajustes',
    name: 'Ajustes',
    tagline: 'Configurações da conta',
    tags: ['configurações'],
    defaultEnabledTools: ['overview', 'subscription']
  },
  {
    screenKey: 'help',
    profileId: 'tutorial',
    name: 'Tutorial',
    tagline: 'Como usar o ZapMass',
    tags: ['ajuda', 'rag'],
    defaultEnabledTools: ['overview']
  },
  {
    screenKey: 'team',
    profileId: 'equipe',
    name: 'Equipe',
    tagline: 'Funcionários e permissões',
    tags: ['equipe', 'acesso'],
    defaultEnabledTools: ['overview', 'subscription']
  },
  {
    screenKey: 'admin-ops',
    profileId: 'ops',
    name: 'Ops',
    tagline: 'Servidor e integrações',
    tags: ['admin', 'ops'],
    defaultEnabledTools: ['admin_ops_snapshot', 'tenant_snapshot', 'overview']
  },
  {
    screenKey: 'creator-studio',
    profileId: 'studio',
    name: 'Studio',
    tagline: 'Configuração do agente',
    tags: ['admin', 'agente'],
    defaultEnabledTools: ['tenant_snapshot', 'overview']
  },
  {
    screenKey: 'ai-assistant',
    profileId: 'gemini',
    name: 'Gemini',
    tagline: 'IA profunda (legado)',
    tags: ['legado', 'gemini'],
    defaultEnabledTools: ['tenant_snapshot']
  }
];

const byScreen = new Map(SCREEN_AGENTS.map((a) => [a.screenKey, a]));

export function getScreenAgentSeed(screen?: string | null): ScreenAgentSeed {
  const key = (screen || 'dashboard').trim().toLowerCase();
  return (
    byScreen.get(key) ?? {
      screenKey: key,
      profileId: 'guia',
      name: 'Guia',
      tagline: 'Assistente ZapMass',
      tags: ['geral'],
      defaultEnabledTools: ['overview', 'contacts', 'campaigns', 'connections']
    }
  );
}
