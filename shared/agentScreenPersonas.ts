import { getScreenAgentSeed } from './agentRegistry.js';

/** Persona do agente por tela — um orquestrador (ZapMass Core), contexto via `screen` / `currentView`. */
export type ScreenAgentPersona = {
  profileId: string;
  name: string;
  tagline: string;
};

export function getScreenAgentPersona(screen?: string | null): ScreenAgentPersona {
  const seed = getScreenAgentSeed(screen);
  return { profileId: seed.profileId, name: seed.name, tagline: seed.tagline };
}

export function formatAgentScreenBadge(screen?: string | null, viewLabelPt?: string): string {
  const persona = getScreenAgentPersona(screen);
  const view = viewLabelPt?.trim() || screen || 'Painel';
  return `${persona.name} · ${view}`;
}
