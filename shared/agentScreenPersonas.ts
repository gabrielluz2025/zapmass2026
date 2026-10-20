/** Persona do agente por tela — um orquestrador, contexto via `screen` / `currentView`. */
export type ScreenAgentPersona = {
  profileId: string;
  name: string;
  tagline: string;
};

const PERSONAS: Record<string, ScreenAgentPersona> = {
  dashboard: { profileId: 'radar', name: 'Radar', tagline: 'Visão geral e saúde da conta' },
  connections: { profileId: 'torre', name: 'Torre', tagline: 'Chips WhatsApp e filas' },
  contacts: { profileId: 'arquivo', name: 'Arquivo', tagline: 'Base, listas e importação' },
  'contacts-map': { profileId: 'mapa', name: 'Mapa', tagline: 'Geo e território' },
  campaigns: { profileId: 'disparo', name: 'Disparo', tagline: 'Campanhas e métricas' },
  chat: { profileId: 'inbox', name: 'Inbox', tagline: 'Conversas e não lidas' },
  reports: { profileId: 'metricas', name: 'Métricas', tagline: 'Relatórios e funil' },
  warmup: { profileId: 'forja', name: 'Forja', tagline: 'Aquecimento de chips' },
  subscription: { profileId: 'plano', name: 'Plano', tagline: 'Assinatura e trial' },
  settings: { profileId: 'ajustes', name: 'Ajustes', tagline: 'Configurações da conta' },
  help: { profileId: 'tutorial', name: 'Tutorial', tagline: 'Como usar o ZapMass' },
  team: { profileId: 'equipe', name: 'Equipe', tagline: 'Funcionários e permissões' },
  'admin-ops': { profileId: 'ops', name: 'Ops', tagline: 'Servidor e integrações' },
  'creator-studio': { profileId: 'studio', name: 'Studio', tagline: 'Configuração do agente' },
  'ai-assistant': { profileId: 'gemini', name: 'Gemini', tagline: 'IA profunda (legado)' }
};

export function getScreenAgentPersona(screen?: string | null): ScreenAgentPersona {
  const key = (screen || 'dashboard').trim().toLowerCase();
  return PERSONAS[key] ?? { profileId: 'guia', name: 'Guia', tagline: 'Assistente ZapMass' };
}

export function formatAgentScreenBadge(screen?: string | null, viewLabelPt?: string): string {
  const persona = getScreenAgentPersona(screen);
  const view = viewLabelPt?.trim() || screen || 'Painel';
  return `${persona.name} · ${view}`;
}
