# RUNBOOK_ISOLAMENTO

Guia operacional para garantir isolamento total entre usuarios (multi-tenant) no ZapMass.

## Objetivo

Evitar qualquer mistura de dados entre contas (contatos, campanhas, conversas, funil e eventos em tempo real).

## Regra de ouro (sempre)

- Todo usuario autenticado tem `uid` unico (Firebase Auth).
- Dados de negocio devem existir apenas em `users/{uid}/...`.
- Leitura, escrita e emissao realtime devem validar ownership por `uid`.
- Na duvida de ownership, bloquear (fail closed).

## Checklist rapido de deploy (A/B)

Execute este teste em toda release:

1. Login com usuario A.
2. Criar contato e disparo de teste (ex.: "isolamento-a").
3. Logout e login com usuario B.
4. Confirmar que B NAO enxerga contato/campanha/disparo do A.
5. Criar disparo no B (ex.: "isolamento-b").
6. Voltar para A e confirmar que A NAO enxerga dado do B.

Se qualquer item falhar, tratar como incidente critico.

## Regras tecnicas obrigatorias

### 1) Autenticacao e autorizacao

- Backend valida token e extrai `uid` em toda conexao/requisicao.
- Nunca confiar em `uid` enviado pelo frontend.

### 2) Persistencia por usuario

- Contatos: `users/{uid}/contacts`
- Listas: `users/{uid}/contact_lists`
- Campanhas: `users/{uid}/campaigns`
- Conexoes do usuario: `users/{uid}/connections`

Evitar colecoes globais para dados de usuario (`/contacts`, `/campaigns`, etc.).

### 3) Realtime (Socket.IO)

- Eventos privados devem usar `io.to("user:"+uid)`.
- Evitar `io.emit` para eventos de negocio de usuario.
- Emissao inicial de estados agregados deve respeitar escopo do usuario logado.

### 4) Ownership de conexoes

- IDs de conexao devem carregar owner (`uid__...`).
- Operacoes em conexao/campanha devem validar que o recurso pertence ao `uid`.

### 5) Legado

- Dados legados sem `uid` devem ser migrados.
- Nao mesclar automaticamente legado global em conta autenticada.

## Diagnostico rapido (quando houver suspeita)

1. Revisar logs do backend procurando eventos com `cross-tenant` bloqueado.
2. Verificar se ha emissao global indevida (`io.emit`) para eventos de campanha/funil.
3. Confirmar que consultas usadas na UI estao em `users/{uid}/...`.
4. Validar conexoes antigas sem prefixo `uid__`.

## Classificacao de severidade

- Severidade: Critica.
- Impacto: vazamento de dados entre contas.
- Acao imediata: congelar deploy, corrigir, validar A/B e liberar somente apos PASS.

## Sinais de PASS

- Usuario A ve apenas dados de A.
- Usuario B ve apenas dados de B.
- Alternar login A/B nao traz residuos da conta anterior.
- Eventos realtime (campanha/funil/conversas) permanecem isolados por conta.
