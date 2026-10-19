/** RAG delegado ao serviço unificado do agente (chunks + overrides Firestore). */
export {
  getStaticKnowledgeChunks as getAllKnowledgeChunks,
  searchKnowledge,
  formatRagAnswer,
  type RagHit
} from '../agent/knowledgeService.js';
