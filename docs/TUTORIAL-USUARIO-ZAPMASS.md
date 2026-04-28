# Tutorial do ZapMass — guia para iniciantes

Este guia explica **o que é cada área do sistema**, **para que servem os botões principais** e **por onde começar**. Foi escrito para quem não é da área técnica.

**No aplicativo:** abra **Sistema → Como usar** no menu lateral, ou no **Painel** use o botão **Como usar**. Pode também guardar nos favoritos o endereço do ZapMass com `?view=help` no fim do link para abrir direto nesta página.

---

## 1. O que é o ZapMass (em uma frase)

É um painel web para **organizar contatos**, **ligar chips de WhatsApp**, **enviar mensagens em massa ou programadas** e **acompanhar resultados**, com cuidado anti-bloqueio (intervalos entre envios, aquecimento dos chips, etc.).

---

## 2. Primeira vez que você entra

### 2.1 Bolinha ao lado do nome “ZapMass” (menu lateral)

- **Verde**: o seu navegador está falando com o **servidor** onde o ZapMass roda — tudo certo para usar o sistema.
- **Vermelha**: sem ligação ao servidor. Atualize a página; se continuar, verifique com quem mantém o servidor.

### 2.2 Modo “só leitura” (assinatura / teste)

Se aparecer um aviso dizendo que precisa **assinatura** ou renovar o plano, você ainda **navega** nas telas, mas **ações grandes** (criar campanha, conectar chip novo, etc.) podem ficar bloqueadas até regularizar no menu **Minha assinatura**.

### 2.3 Barra superior (em qualquer tela)

- **Sino**: notificações do sistema (campanha concluída, avisos importantes).
- **Lâmpada “Sugestão”**: abre um campo para enviar ideias de melhoria à equipe — não é obrigatório usar.

---

## 3. Menu lateral — grupos e o que cada ícone faz

Os nomes podem variar levemente, mas a ideia é esta:

| Grupo        | Onde ir            | Em poucas palavras |
|-------------|---------------------|--------------------|
| **Principal** | Painel             | Resumo do dia, atalhos e lembretes (ex.: aniversários). |
|               | Conexões           | Cadastrar e gerir os **chips** WhatsApp (QR Code, online/offline). |
|               | Pipeline           | Ver conversas e **enviar até a resposta** num fluxo organizado. |
| **Disparos**  | Campanhas          | Criar disparos em massa, pausar, agenda, relatórios rápidos da área. |
|               | Contatos           | Base de contatos, **listas**, importação, filtros e temperatura (quente/morno/frio). |
|               | Relatórios         | Números consolidados, gráficos e **exportar CSV**. |
| **Operações** | Aquecimento       | “Educar” chips novos com envios graduais para reduzir risco de bloqueio. |
| **Sistema**   | Minha assinatura  | Plano, datas, pagamento, upgrade de canais (quando existir). |
|               | Configurações     | Intervalos de envio, tema, notificações, conta e termos legais. |

Itens **Painel do criador**, **Servidor & alertas** e **Estúdio** só aparecem para **equipe administradora** — utilizadores normais ignoram.

---

## 4. Painel (Dashboard)

- Visão geral dos **números importantes**: envios, chips online, atalhos.
- **Aniversariantes** (quando configurado): lista de quem faz aniversário em breve com opção de montar uma mensagem e disparar um teste.
- Explore os **cartões e botões** como “ir para Conexões”, “Campanhas” ou “Contatos” — são atalhos para ganhar tempo.

---

## 5. Conexões (frota de WhatsApp)

É aqui que você **adiciona cada chip** (cada número WhatsApp usado para disparo).

- **Novo / Adicionar conexão**: segue o assistente (nome do chip, QR Code no celular).
- **Cartões ou lista**: cada conexão mostra **Online** ou **Offline**, fila de mensagens e ferramentas como **reconectar**, **atualizar**, **QR**.
- **Pins** (alfinete): pode **fixar** os chips que mais usa no topo.
- **Filtros**: ver só online, offline, em pareamento, etc.
- Respeite sempre o **limite de chips** do seu plano — a tela avisa quando está no teto.

---

## 6. Pipeline (Chat)

- Lista de **conversas** por chip.
- Serve para **acompanhar dialogar** depois de um disparo ou falar 1:1, com foco em fluxo de trabalho (de envio até resposta).
- Use a **busca** e os **filtros** quando tiver muitas conversas.

---

## 7. Campanhas (quatro “sub-abas”)

No topo da área Campanhas existem abas internas:

### 7.1 Dashboard (da área Campanhas)

- Painel resumido ligado a campanhas (visão rápida antes de mergulhar na lista).

### 7.2 Centro (Centro de missões)

- Texto introdutório explica: **planejamento, frota e histórico**.
- Botão **Nova campanha** no topo abre o assistente de criação.
- Dentro do Centro existem **mais quatro sub-abas**:
  - **Calendário**: mapa de calor dos dias em que você criou campanhas (últimos meses) e estatísticas rápidas.
  - **Saúde dos chips**: “pontuação” e volume por chip para ver **qual número está melhor** para disparos.
  - **Modelos**: guardar e reutilizar **modelos de mensagem** (após preencher o assistente e guardar rascunho onde o sistema indicar).
  - **Auditoria**: registro local de ações (criar, pausar, exportar, etc.) para consulta.

### 7.3 Campanhas (rótulo tipo `Campanhas (N)`)

- **N** é a quantidade de campanhas na lista.
- Inclui **agenda semanal** (visão de calendário) e a **lista completa** com ações: **detalhes**, **pausar / retomar**, **clonar**, **apagar** (quando permitido).

### 7.4 Nova (aba “Nova” — assistente de campanha)

Assistência passo a passo:

1. **Público**: lista salva, filtro por cidade/igreja/DDD/etc., números manuais, ou filtros especiais (**temperatura** do contato quando disponível — quente, morno, frio).
2. **Mensagem**: uma ou várias etapas; modo **fluxo por respostas** (só envia o próximo quando o contato responde) ou sequência direta.
3. **Canais**: marca **quais chips** participam; em sequencial pode definir **carga igual** ou **pesos** entre chips; intervalo **anti-ban** (tempo mínimo entre envios).
4. **Revisão**: confere tudo e dispara **agora** ou **agendado** (data/hora e repetição semanal se existir).

Também pode haver **teste de disparo** (área colapsável) para enviar uma mensagem de teste para um número.

---

## 8. Contatos

### 8.1 Barra lateral (filtros inteligentes)

- **Todos**, por **temperatura** (engajamento), **aniversário**, **retorno**, **duplicados**, etc.
- Ajuda a achar “quem precisa de atenção” sem precisar exportar para planilha.

### 8.2 Ações na tabela

- **Selecionar** vários contatos: barra inferior com **excluir**, **exportar**, **adicionar a lista**, **tags**, **criar campanha** com os selecionados.
- **Adicionar a lista**: abre escolha da **lista de destino** (em vez de digitar número no escuro).

### 8.3 Listas

- Liste à esquerda: **criar lista**, gerir membros em cada lista.
- O mesmo número pode estar em **várias listas** sem duplicar a ficha principal.

### 8.4 Importação

- Botões típicos: **CSV/Excel**, **vCard**, colar texto (“importação inteligente”). Sigam as colunas indicadas pelo sistema na hora de baixar o **modelo**.

### 8.5 Insights (se existir)

- Painel opcional com **segmentos prontos** (ex.: aniversários da semana) e atalho para criar campanha.

---

## 9. Relatórios

- Escolha o **período**: **7 dias**, **30 dias** ou **3 meses**.
- Veja totais como **mensagens enviadas**, **taxa de sucesso**, funil (entrega / leitura / resposta em medida disponível).
- **Mapa de calor** (hora × dia da semana) sugere horários onde você mais enviou.
- **Exportar CSV**: baixa planilha com campanhas do período filtrado para Excel ou arquivo.

---

## 10. Aquecimento (warmup)

- Ferramentas para **não esgotar chips novos** de uma vez só.
- Sigam sempre as **recomendações na própria tela** sobre volume gradual.

---

## 11. Minha assinatura

- Ver **situação do plano** (ativo, teste, data de renovação ou fim onde aplicável).
- **Renovar**, **mudar plano**, **canais extras** quando o sistema oferecer.
- **Mercado Pago / Pix / cartão** conforme as opções aparecerem nos botões.

---

## 12. Configurações (abas internas em “chips”)

| Aba               | Serve para |
|-------------------|------------|
| **Disparo**       | Intervalo mínimo/máximo entre mensagens, limite diário, modo “silêncio” noturno. Use **Salvar** depois de mudar. |
| **Aparência**     | Cor de destaque e **tema claro ou escuro**. |
| **Notificações**  | E-mail de alerta e URL de **webhook** (integrações avançadas). |
| **Minha conta**   | Dados do login; versão da API (informação técnica). |
| **Termo e responsabilidade** | LGPD, política do WhatsApp, aceite de risco de uso em massa — leia com calma. |

Há ainda ação **apagar todos os dados** (muito destrutiva): só após digitar a confirmação exigida na tela.

---

## 13. Teclas de atalho (área Campanhas)

Na barra de abas de Campanhas, o botão **Atalhos** (ícone ⌘) abre a lista. Resumo:

- **N** — abrir fluxo de **Nova campanha**
- **1** — ir para **Dashboard** (campanhas)
- **2** — ir para **Centro**
- **3** — ir para a **lista de campanhas**
- **T** — abrir/fechar **Teste de disparo** (quando esse bloco existir na tela)
- **?** — mostrar novamente esta janela de atalhos

---

## 14. Boas práticas em uma lista

1. **Sempre** ter pelo menos **um chip online** antes de campanha grande.  
2. **Não** disparar para listas sem opt-in explícito onde a lei exigir (LGPD / marketing).  
3. **Aumentar** intervalos se notar quedas ou bloqueios.  
4. **Usar** listas e filtros em vez de colar mil números sem organização.  
5. **Conferir** na **revisão** da campanha antes de “Disparar agora”.

---

# Parte 2 — Roteiro sugerido para vídeo (YouTube, treinamento interno ou onboarding)

O vídeo não substitui este documento, mas **reforça** com imagem. Sugestão: **8 a 15 minutos** no total, ou **série curta** de 2–3 min por módulo.

## Objetivo do vídeo

Mostrar, na prática, **onde clicar** e **qual ordem seguir** no primeiro dia de uso: conectar um chip → importar contatos → criar uma lista → enviar uma campanha pequena → ver o relatório.

## Roteiro por capítulos (com estimativa de tempo)

| Min | O que mostrar na tela |
|-----|------------------------|
| 0:00–0:30 | Abertura: logo ZapMass, login, bolinha verde “servidor OK”. |
| 0:30–2:00 | **Conexões**: adicionar ou reconectar um chip (QR), mostrar online. |
| 2:00–4:00 | **Contatos**: importar 3–5 contatos de teste ou colar; criar uma **lista** e pôr contatos nela. |
| 4:00–7:00 | **Campanhas → Nova campanha**: público = lista; mensagem simples; escolher chip; intervalo; revisar; **não** precisa ser milhares de números — use poucos para demo. |
| 7:00–9:00 | **Relatórios**: mudar período 7/30 dias; mostrar **Exportar CSV**. |
| 9:00–10:30 | **Minha assinatura** e **Configurações** (só passar pelas abas principais, sem expor dados sensíveis). |
| 10:30–11:30 | **Pipeline** ou **Painel** (o que fizer mais sentido para o seu público). |
| 11:30–12:00 | Fechamento: “Sugestão” na barra, onde achar ajuda, link deste tutorial. |

## Dicas de produção (simples)

- **Grave a tela** (OBS Studio, Xbox Game Bar no Windows, ou QuickTime no Mac) em **1080p**, zoom do navegador em **100–110%** para leitura confortável.
- **Áudio**: microfone perto da boca; ambiente silencioso. Música de fundo baixa ou nenhuma.
- **Privacidade**: borre telefones reais, nomes de clientes e dados de pagamento.
- **Legendas**: no YouTube ou CapCut, ative **legendas em português** — ajuda quem assiste sem som.
- **Thumbnail**: logo + texto curto tipo “ZapMass em 10 min”.

## Onde publicar

- Página de ajuda do produto, **YouTube** da marca, ou **vídeo fixo** no primeiro login (link externo).

---

*Documento alinhado à estrutura de menus do ZapMass (Principal / Disparos / Operações / Sistema). Ajuste nomes finos se a interface evoluir.*
