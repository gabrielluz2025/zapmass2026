import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { KnowledgeChunk } from '../assistant/assistantTypes.js';
import { KNOWLEDGE_CHUNKS } from '../assistant/knowledgeChunks.js';
import { loadAgentConfig, invalidateAgentConfigCache } from './agentConfigLoader.js';
import type { AgentKnowledgeOverride } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let extraDocChunks: KnowledgeChunk[] | null = null;

function loadExtraFromDocs(): KnowledgeChunk[] {
  if (extraDocChunks !== null) return extraDocChunks;
  extraDocChunks = [];
  const candidates = [
    join(process.cwd(), 'docs', 'TUTORIAL-USUARIO-ZAPMASS.md'),
    join(__dirname, '..', '..', 'docs', 'TUTORIAL-USUARIO-ZAPMASS.md')
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf8');
      const sections = raw.split(/\n(?=##\s)/);
      for (const section of sections) {
        const titleMatch = section.match(/^##\s+(.+)/m);
        if (!titleMatch) continue;
        const title = titleMatch[1].replace(/^#+\s*/, '').trim();
        const body = section
          .replace(/^##\s+.+\n/m, '')
          .replace(/\*\*/g, '')
          .replace(/\|[^|\n]+\|/g, ' ')
          .trim()
          .slice(0, 1200);
        if (body.length < 40) continue;
        const keywords = title
          .toLowerCase()
          .split(/[\s—–\-]+/)
          .filter((w) => w.length > 2);
        extraDocChunks.push({
          id: `doc-${title.slice(0, 24).replace(/\W/g, '-')}`,
          title,
          keywords,
          body
        });
      }
      break;
    } catch {
      /* ignore */
    }
  }
  return extraDocChunks;
}

function mergeOverrides(base: KnowledgeChunk[], overrides: AgentKnowledgeOverride[]): KnowledgeChunk[] {
  const disabled = new Set(overrides.filter((o) => o.enabled === false).map((o) => o.id));
  const byId = new Map<string, KnowledgeChunk>();
  for (const c of base) {
    if (!disabled.has(c.id)) byId.set(c.id, c);
  }
  for (const o of overrides) {
    if (o.enabled === false) {
      byId.delete(o.id);
      continue;
    }
    byId.set(o.id, {
      id: o.id,
      title: o.title,
      keywords: o.keywords,
      body: o.body,
      navigateTo: o.navigateTo,
      tags: o.tags
    });
  }
  return [...byId.values()];
}

/** Chunks estáticos (sem overrides Firestore) — útil em testes. */
export function getStaticKnowledgeChunks(): KnowledgeChunk[] {
  return [...KNOWLEDGE_CHUNKS, ...loadExtraFromDocs()];
}

export async function getAllKnowledgeChunks(): Promise<KnowledgeChunk[]> {
  const cfg = await loadAgentConfig();
  return mergeOverrides(getStaticKnowledgeChunks(), cfg.knowledgeOverrides);
}

export type RagHit = {
  chunk: KnowledgeChunk;
  score: number;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

const SCREEN_RAG_ALIASES: Record<string, string[]> = {
  dashboard: ['dashboard', 'painel'],
  contacts: ['contacts', 'contatos'],
  'contacts-map': ['contacts-map', 'mapa', 'map'],
  campaigns: ['campaigns', 'campanhas'],
  connections: ['connections', 'conexoes', 'chips'],
  chat: ['chat', 'bate-papo', 'inbox'],
  reports: ['reports', 'relatorios'],
  warmup: ['warmup', 'aquecimento'],
  subscription: ['subscription', 'assinatura'],
  settings: ['settings', 'configuracoes'],
  help: ['help', 'tutorial'],
  'admin-ops': ['admin-ops', 'ops', 'servidor'],
};

function screenBoostTokens(screen?: string, currentView?: string): string[] {
  const raw = (screen || currentView || '').trim().toLowerCase();
  if (!raw) return [];
  const aliases = new Set<string>([raw]);
  for (const [view, keys] of Object.entries(SCREEN_RAG_ALIASES)) {
    if (view === raw || keys.includes(raw)) {
      aliases.add(view);
      for (const k of keys) aliases.add(k);
    }
  }
  return [...aliases];
}

export async function searchKnowledge(
  question: string,
  limit = 3,
  opts?: { screen?: string; currentView?: string }
): Promise<RagHit[]> {
  const tokens = tokenize(question);
  if (tokens.length === 0) return [];

  const screenKeys = screenBoostTokens(opts?.screen, opts?.currentView);

  const hits: RagHit[] = [];
  const chunks = await getAllKnowledgeChunks();
  for (const chunk of chunks) {
    const hay = `${chunk.title} ${chunk.keywords.join(' ')} ${chunk.body}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
      for (const kw of chunk.keywords) {
        if (kw.includes(t) || t.includes(kw)) score += 2;
      }
    }
    if (screenKeys.length > 0) {
      const nav = (chunk.navigateTo || '').toLowerCase();
      if (nav && screenKeys.includes(nav)) score += 5;
      for (const tag of chunk.tags || []) {
        const tg = tag.toLowerCase();
        if (screenKeys.includes(tg)) score += 4;
      }
    }
    if (score > 0) hits.push({ chunk, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function formatRagAnswer(hits: RagHit[]): { answer: string; navigateTo?: string } | null {
  if (hits.length === 0) return null;
  const top = hits[0].chunk;
  const parts = [top.body];
  if (hits.length > 1 && hits[1].score >= hits[0].score * 0.6) {
    parts.push(`\n\n**Relacionado:** ${hits[1].chunk.title} — ${hits[1].chunk.body.slice(0, 280)}…`);
  }
  return {
    answer: parts.join(''),
    navigateTo: top.navigateTo
  };
}

export async function listKnowledgeForAdmin(): Promise<{
  baseCount: number;
  overrides: AgentKnowledgeOverride[];
  mergedCount: number;
}> {
  const cfg = await loadAgentConfig();
  const merged = await getAllKnowledgeChunks();
  return {
    baseCount: getStaticKnowledgeChunks().length,
    overrides: cfg.knowledgeOverrides,
    mergedCount: merged.length
  };
}

export async function patchKnowledgeOverrides(overrides: AgentKnowledgeOverride[]): Promise<AgentKnowledgeOverride[]> {
  const { saveAgentConfigMerge } = await import('./agentConfigLoader.js');
  const next = await saveAgentConfigMerge({ knowledgeOverrides: overrides });
  invalidateAgentConfigCache();
  return next.knowledgeOverrides;
}
