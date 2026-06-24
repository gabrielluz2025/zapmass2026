import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { KnowledgeChunk } from './assistantTypes.js';
import { KNOWLEDGE_CHUNKS } from './knowledgeChunks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let extraChunks: KnowledgeChunk[] | null = null;

function loadExtraFromDocs(): KnowledgeChunk[] {
  if (extraChunks !== null) return extraChunks;
  extraChunks = [];
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
        extraChunks.push({
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
  return extraChunks;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

export function getAllKnowledgeChunks(): KnowledgeChunk[] {
  return [...KNOWLEDGE_CHUNKS, ...loadExtraFromDocs()];
}

export type RagHit = {
  chunk: KnowledgeChunk;
  score: number;
};

export function searchKnowledge(question: string, limit = 3): RagHit[] {
  const tokens = tokenize(question);
  if (tokens.length === 0) return [];

  const hits: RagHit[] = [];
  for (const chunk of getAllKnowledgeChunks()) {
    const hay = `${chunk.title} ${chunk.keywords.join(' ')} ${chunk.body}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
      for (const kw of chunk.keywords) {
        if (kw.includes(t) || t.includes(kw)) score += 2;
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
