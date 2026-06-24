export type AssistantIntent =
  | 'tutorial'
  | 'data_overview'
  | 'data_contacts'
  | 'data_campaigns'
  | 'data_connections'
  | 'data_subscription'
  | 'creative'
  | 'navigate'
  | 'unknown';

export type AssistantSource = 'rules' | 'rag' | 'tools' | 'llm' | 'cache';

export type AssistantAskResult = {
  ok: true;
  answer: string;
  intent: AssistantIntent;
  source: AssistantSource;
  suggestions?: string[];
  navigateTo?: string;
  remainingToday: number;
  usedLlm: boolean;
};

export type KnowledgeChunk = {
  id: string;
  title: string;
  keywords: string[];
  body: string;
  navigateTo?: string;
};

export type AssistantHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};
