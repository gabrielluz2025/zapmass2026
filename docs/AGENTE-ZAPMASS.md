# Agente ZapMass

Assistente **próprio da plataforma**, sem depender de Google Gemini no fluxo principal.

## Arquitetura

| Camada | Função |
|--------|--------|
| **assistantRouter** | Intenções determinísticas (dados, navegação, tutorial, criativo). |
| **assistantTools** | Respostas com dados ao vivo (Postgres/Evolution): contatos, campanhas, chips, assinatura. |
| **knowledgeService** | RAG leve: `knowledgeChunks.ts` + `docs/TUTORIAL-USUARIO-ZAPMASS.md` + overrides Firestore. |
| **agentOrchestrator** | Um orquestrador para todas as telas (`currentView` / `screen`); modos `standard` e `admin_full`; persona por tela (`shared/agentScreenPersonas.ts`, ex.: **Radar** no Painel). |
| **toolRegistry** | Ferramentas nomeadas + snapshot JSON para admin. |
| **llmProvider** | Só se `AGENT_LLM_PROVIDER=groq` ou `gemini` e chaves configuradas. |

API: `GET/POST /api/agent/*` (status, ask, config/knowledge para admin). Admin: `GET /api/agent/activity` (buffer em memória das últimas perguntas, log `agent_ask`).

Perguntas amplas (“valide todo o sistema”) usam intenção `system_audit`: várias ferramentas em paralelo + checklist, sem depender de LLM. Timeouts: cliente ~50s, servidor `AGENT_ASK_TIMEOUT_MS` (default 45s).

UI: painel **Assistente ZapMass** (robô) → `agentApi`. Não consome Gemini por padrão.

## Manter o conhecimento de domínio

1. **Código (release)** — edite `server/assistant/knowledgeChunks.ts` (chunks com `id`, `title`, `keywords`, `body`, `navigateTo`).
2. **Documentação** — seções `##` em `docs/TUTORIAL-USUARIO-ZAPMASS.md` viram chunks extras no boot.
3. **Runtime (sem deploy)** — Creator Studio → **Agente ZapMass** ou `PATCH /api/agent/knowledge` com `overrides` no Firestore `appConfig/agent`:
   - mesmo `id` **substitui** chunk base;
   - `"enabled": false` **oculta** chunk base.

## Variáveis de ambiente

| Variável | Default | Efeito |
|----------|---------|--------|
| `AGENT_LLM_PROVIDER` | `none` | LLM externo desligado; polish e admin_full usam regras/tools/RAG. |
| `AGENT_LLM_PROVIDER=groq` | — | Polish criativo + admin_full via Groq (`GROQ_API_KEY`). |
| `AGENT_LLM_PROVIDER=gemini` | — | Idem via Gemini (agente; distinto do legado). |
| `ASSISTANT_LLM_ENABLED=false` | — | Bloqueia qualquer chamada LLM do agente. |
| `ASSISTANT_LLM_POLISH` | `false` | Reformula respostas tutorial (só com provider ≠ none). |
| `GEMINI_LEGACY_ASSISTANT=true` | — | Exibe FAB **Assistente IA** (`/api/ai`) para admins. |
| `GEMINI_API_KEY` | — | Obrigatória só para rotas legadas `/api/ai/*` (import JSON, mapa, etc.). |

## O que ainda usa Gemini (legado)

- `POST /api/ai/contacts/import-organize`, extração de contatos, sugestões de mapa, composer de campanha, `POST /api/ai/assist` (compat admin).
- Botões **AiSparkButton** / FAB roxo quando `GEMINI_LEGACY_ASSISTANT=true` e chave presente.

O **Agente ZapMass** (`/api/agent`) funciona **sem** `GEMINI_API_KEY`.
