# Proposta de UI — Painel do criador e shell do app

## Contexto

O **Painel do criador** (`AdminPanel`) concentra operações de produto: preços/trial, MRR, acessos, comunicados globais e triagem de sugestões. Parte do texto estava com **mojibake** (UTF-8 lido como Latin-1), corrigido na v2.3.318.

## Antes

- Cabeçalho grande com gradiente e abas à direita em telas largas (quebra visual com a sidebar escura).
- Abas competiam com o título no mesmo bloco.
- Estado vazio de sugestões genérico, sem ícone nem referência ao botão da TopBar.
- Mistura PT-PT (`utilizadores`, `A carregar`, `registada`) com PT-BR.

## Depois (MVP 2.3.318)

| Princípio | Implementação |
|-----------|----------------|
| Cabeçalho compacto | Ícone 40px, título + uma linha de contexto |
| Abas abaixo do título | Barra horizontal com scroll em mobile, tokens `--surface-*` |
| Empty state de sugestões | Ícone `Lightbulb`, copy ligada ao botão «Sugestões» na TopBar |
| PT-BR | `usuários`, `Carregando…`, `registrada/o` |
| Encoding | `AdminPanel.tsx` normalizado para UTF-8 |

## Roadmap — shell completo (não só criador)

1. **Layout único**: `AppShell` com largura máxima por rota, padding alinhado ao dashboard.
2. **TopBar + Sidebar**: mesma escala tipográfica (`ui-title`, `ui-eyebrow`) em todas as views admin.
3. **Abas reutilizáveis**: componente `TabBar` em `src/components/ui/TabBar.tsx` (criador, relatórios, configurações).
4. **Cabeçalho compacto**: `CompactPageHeader` — Painel do cliente, Minha assinatura e criador (v2.3.319+).
5. **Empty states**: biblioteca de ícones + ações primárias por domínio (campanhas, contatos, sugestões).
6. **Densidade**: modo compacto opcional para power users (tabelas de acesso e ganhos).

## Referências no código

- `src/components/admin/AdminPanel.tsx` — layout e abas
- `src/components/ui/CompactPageHeader.tsx`, `TabBar.tsx`
- `src/components/dashboard/DashboardCommandPanel.tsx`, `src/components/billing/MySubscriptionTab.tsx`
- `src/components/shell/ImprovementSuggestionButton.tsx` — origem das sugestões
- `src/components/shell/TopBar.tsx` — título «Painel do criador»
