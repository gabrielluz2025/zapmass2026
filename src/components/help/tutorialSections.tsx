export type ContentBlock =
  | { type: 'intro' | 'text' | 'tip' | 'warning'; text: string }
  | { type: 'path'; crumbs: string[] }
  | { type: 'list'; title?: string; items: { icon: string; text: string }[] }
  | { type: 'steps'; title?: string; items: string[] }
  | { type: 'grid'; items: { icon: string; title: string; desc: string }[] }
  | { type: 'checklist'; title?: string; items: string[] };

export type TutorialSection = {
  id: string;
  icon: string;
  title: string;
  color: string;
  /** Chave em ILLUSTRATIONS */
  illuKey?: string;
  /** Chave em TUTORIAL_DEMOS */
  demoId?: string;
  /** View do AppViewContext para “Ir para esta área” */
  viewId?: string;
  content: ContentBlock[];
};

export const TUTORIAL_SECTIONS: TutorialSection[] = [
  {
    id: 'visao-geral',
    icon: '🚀',
    title: 'O que é o ZapMass',
    color: '#10b981',
    content: [
      {
        type: 'intro',
        text: 'O ZapMass é um painel web para organizar contatos, ligar chips de WhatsApp, enviar mensagens em massa ou programadas e acompanhar resultados — com cuidado anti-bloqueio (intervalos, aquecimento e limites diários).',
      },
      {
        type: 'grid',
        items: [
          { icon: '📱', title: 'Múltiplos chips', desc: 'Conecte vários números e distribua envios entre eles ou em pools' },
          { icon: '👥', title: 'Gestão de contatos', desc: 'Base com listas, tags, importação e temperatura (quente/morno/frio)' },
          { icon: '📣', title: 'Campanhas', desc: 'Broadcast Studio em 4 passos, agendamento e fluxo por resposta' },
          { icon: '📊', title: 'Relatórios', desc: 'Métricas, mapa de calor e exportação CSV' },
          { icon: '🛡️', title: 'Anti-bloqueio', desc: 'Intervalos, aquecimento de chips e silêncio noturno' },
          { icon: '👨‍💼', title: 'Equipe', desc: 'Funcionários com usuário/senha sob o plano do responsável' },
        ],
      },
      {
        type: 'tip',
        text: 'Roteiro do 1º dia: Conexões (chip online) → Contatos (importar lista) → Campanhas (teste pequeno) → Relatórios.',
      },
    ],
  },
  {
    id: 'primeiros-passos',
    icon: '🧭',
    title: 'Primeiros passos',
    color: '#38bdf8',
    viewId: 'dashboard',
    content: [
      {
        type: 'path',
        crumbs: ['Login', 'Menu lateral', 'Painel'],
      },
      {
        type: 'text',
        text: 'Antes de disparar, entenda os sinais da interface e como entrar na conta certa.',
      },
      {
        type: 'list',
        title: 'Bolinha ao lado do nome ZapMass (menu lateral)',
        items: [
          { icon: '🟢', text: 'Verde — o navegador está falando com o servidor. Pode usar o sistema.' },
          { icon: '🔴', text: 'Vermelha — sem ligação ao servidor. Atualize a página; se continuar, avise quem mantém a VPS.' },
        ],
      },
      {
        type: 'list',
        title: 'Como entrar',
        items: [
          { icon: '👤', text: 'Responsável — Entrar com Google (conta principal). É nesse login que o teste grátis costuma ativar.' },
          { icon: '🧑‍💼', text: 'Funcionário — separador Funcionário: e-mail do responsável + usuário/senha cadastrados em Funcionários.' },
        ],
      },
      {
        type: 'list',
        title: 'Barra superior (qualquer tela)',
        items: [
          { icon: '🔔', text: 'Sino — notificações (campanha concluída, avisos).' },
          { icon: '💡', text: 'Sugestão — envia ideias de melhoria à equipe (opcional).' },
        ],
      },
      {
        type: 'warning',
        text: 'Se aparecer aviso de assinatura / modo leitura, você ainda navega, mas ações grandes (nova campanha, novo chip) ficam bloqueadas até regularizar em Minha assinatura.',
      },
      {
        type: 'list',
        title: 'Mapa do menu lateral (nomes reais)',
        items: [
          { icon: '📊', text: 'Principal → Painel, Funcionários, Conexões, Bate-papo' },
          { icon: '📣', text: 'Disparos → Campanhas, Contatos, Relatórios' },
          { icon: '🔥', text: 'Operações → Aquecimento, Atendimento' },
          { icon: '⚙️', text: 'Sistema → Como usar, Minha assinatura, Configurações' },
        ],
      },
      {
        type: 'tip',
        text: 'Itens como Painel do criador, Servidor & alertas e Estúdio só aparecem para administradores — ignore se não os vir.',
      },
    ],
  },
  {
    id: 'painel',
    icon: '📊',
    title: 'Painel (Dashboard)',
    color: '#3b82f6',
    illuKey: 'painel',
    demoId: 'painel',
    viewId: 'dashboard',
    content: [
      { type: 'path', crumbs: ['Principal', 'Painel'] },
      {
        type: 'text',
        text: 'É a primeira tela após o login: resumo do dia, saúde da operação e atalhos para as áreas mais usadas.',
      },
      {
        type: 'list',
        title: 'O que você encontra',
        items: [
          { icon: '📈', text: 'Cartões: envios do dia, chips online, taxa de sucesso' },
          { icon: '📅', text: 'Gráfico de envios recentes' },
          { icon: '🎂', text: 'Aniversariantes (quando configurado) com atalho para mensagem' },
          { icon: '⚡', text: 'Atalhos para Conexões, Campanhas e Contatos' },
          { icon: '🔔', text: 'Alertas (chip offline, campanha concluída)' },
        ],
      },
      {
        type: 'tip',
        text: 'Antes de uma campanha grande, abra o Painel e confirme que há chips online.',
      },
    ],
  },
  {
    id: 'conexoes',
    icon: '📱',
    title: 'Conexões (Chips WhatsApp)',
    color: '#10b981',
    illuKey: 'conexoes',
    demoId: 'conexoes',
    viewId: 'connections',
    content: [
      { type: 'path', crumbs: ['Principal', 'Conexões', 'Nova conexão'] },
      {
        type: 'text',
        text: 'Aqui você adiciona e gerencia cada chip (número WhatsApp usado para disparo). O limite de chips vem do seu plano — a tela avisa quando chega ao teto.',
      },
      {
        type: 'steps',
        title: 'Como adicionar um chip',
        items: [
          'Clique em Nova conexão (canto superior)',
          'Dê um nome ao chip (ex.: Chip Marketing 1)',
          'No celular: WhatsApp → Aparelhos conectados → Conectar aparelho',
          'Escaneie o QR Code (ou use código de pareamento, se aparecer)',
          'Aguarde o status Online (ponto verde)',
        ],
      },
      {
        type: 'list',
        title: 'Status e ações',
        items: [
          { icon: '🟢', text: 'Online — pronto para enviar' },
          { icon: '🟡', text: 'Conectando / pareando — aguarde a sincronização' },
          { icon: '🔴', text: 'Offline — use Reconectar ou QR de novo' },
          { icon: '📌', text: 'Pin — fixa os chips mais usados no topo' },
          { icon: '🔍', text: 'Filtros — só online, offline, em pareamento, etc.' },
        ],
      },
      {
        type: 'warning',
        text: 'Se o celular ainda mostrar o ZapMass em “Aparelhos conectados” depois de desligar no painel, remova o aparelho no WhatsApp para evitar sessão fantasma e notificações.',
      },
      {
        type: 'tip',
        text: 'Chip novo: nunca dispare em massa no primeiro dia. Use Aquecimento por pelo menos 2 semanas.',
      },
    ],
  },
  {
    id: 'pools',
    icon: '⚡',
    title: 'Pools de Chips',
    color: '#3b82f6',
    illuKey: 'pools',
    viewId: 'connections',
    content: [
      { type: 'path', crumbs: ['Principal', 'Conexões', 'Pools de Chips'] },
      {
        type: 'text',
        text: 'Um pool agrupa vários chips como uma equipe. Na campanha você escolhe o pool; o sistema divide envios e faz failover se um chip cair.',
      },
      {
        type: 'list',
        title: 'Estratégias de distribuição',
        items: [
          { icon: '🔄', text: 'Rodízio igual — divide em partes iguais (recomendado na maioria dos casos)' },
          { icon: '⚖️', text: 'Pesos — você define % por chip (ex.: 70% / 30%)' },
          { icon: '🥇', text: 'Prioridade — usa o 1º; se cair, passa ao 2º (preserva o principal)' },
        ],
      },
      {
        type: 'steps',
        title: 'Como criar',
        items: [
          'Em Conexões, role até Pools de Chips',
          'Clique em Novo Pool',
          'Nome + estratégia + marque os chips',
          'Salvar pool',
          'Na campanha, selecione o pool em Canais',
        ],
      },
      {
        type: 'tip',
        text: 'Use Prioridade quando quiser “descansar” o chip principal e só acionar reservas se ele cair.',
      },
    ],
  },
  {
    id: 'bate-papo',
    icon: '💬',
    title: 'Bate-papo (Chat)',
    color: '#a855f7',
    illuKey: 'bate-papo',
    demoId: 'bate-papo',
    viewId: 'chat',
    content: [
      { type: 'path', crumbs: ['Principal', 'Bate-papo'] },
      {
        type: 'text',
        text: 'Inbox multi-chip: conversas dos seus números em uma só interface, para acompanhar respostas de campanha e falar 1:1.',
      },
      {
        type: 'list',
        title: 'Recursos',
        items: [
          { icon: '📋', text: 'Lista à esquerda com busca e filtros (não lidas, por canal)' },
          { icon: '💬', text: 'Histórico da conversa no painel principal' },
          { icon: '📎', text: 'Mídia: imagens, áudios, documentos' },
          { icon: '🤖', text: 'Integra com Atendimento (bot) quando configurado' },
          { icon: '👥', text: 'Atribuição para membros da equipe (quando disponível)' },
        ],
      },
      {
        type: 'tip',
        text: 'Depois de um disparo, abra o Bate-papo filtrando por não lidas para priorizar quem respondeu.',
      },
    ],
  },
  {
    id: 'campanhas',
    icon: '📣',
    title: 'Campanhas',
    color: '#f59e0b',
    illuKey: 'campanhas',
    demoId: 'campanhas',
    viewId: 'campaigns',
    content: [
      { type: 'path', crumbs: ['Disparos', 'Campanhas', 'Nova'] },
      {
        type: 'text',
        text: 'Coração do ZapMass: criar, pausar, agendar e acompanhar disparos. No topo da área há abas internas.',
      },
      {
        type: 'list',
        title: 'Abas da área Campanhas',
        items: [
          { icon: '📊', text: 'Dashboard — resumo rápido da área' },
          { icon: '🎯', text: 'Centro — calendário, saúde dos chips, modelos e auditoria' },
          { icon: '📋', text: 'Campanhas (N) — lista + agenda; detalhes, pausar, clonar' },
          { icon: '✨', text: 'Nova — Broadcast Studio (assistente em 4 passos)' },
        ],
      },
      {
        type: 'steps',
        title: 'Broadcast Studio — 4 passos',
        items: [
          'Público — lista salva, filtros (cidade/tag/temperatura) ou números manuais',
          'Mensagem — texto, variáveis {nome}, spintax {Olá|Oi}, anexos; ou fluxo por resposta',
          'Canais — chips ou pool; intervalo anti-ban; pesos se sequencial',
          'Revisão — confira e Disparar agora ou agende data/hora',
        ],
      },
      {
        type: 'grid',
        items: [
          { icon: '📢', title: 'Disparo único', desc: 'Uma mensagem por contato — avisos e promoções' },
          { icon: '🔀', title: 'Fluxo por resposta', desc: 'Só envia a próxima após o contato responder' },
          { icon: '📅', title: 'Agendamento', desc: 'Data/hora futura e repetição semanal se existir' },
          { icon: '🧪', title: 'Teste de disparo', desc: 'Envie para 1–3 números antes da massa' },
        ],
      },
      {
        type: 'list',
        title: 'Atalhos de teclado (botão ⌘ Atalhos)',
        items: [
          { icon: 'N', text: 'Nova campanha' },
          { icon: '1', text: 'Dashboard da área' },
          { icon: '2', text: 'Centro' },
          { icon: '3', text: 'Lista de campanhas' },
          { icon: 'T', text: 'Teste de disparo' },
          { icon: '?', text: 'Abrir lista de atalhos' },
        ],
      },
      {
        type: 'tip',
        text: 'Spintax reduz mensagens idênticas: {Olá|Oi|Bom dia} {nome}, tudo bem?',
      },
    ],
  },
  {
    id: 'fluxo-resposta',
    icon: '🔀',
    title: 'Fluxo por Resposta',
    color: '#3b82f6',
    illuKey: 'fluxo-resposta',
    viewId: 'campaigns',
    content: [
      { type: 'path', crumbs: ['Disparos', 'Campanhas', 'Nova', 'Mensagem'] },
      {
        type: 'text',
        text: 'Cria diálogo automatizado: o sistema espera a resposta do contato antes de enviar a próxima etapa.',
      },
      {
        type: 'list',
        title: 'Como funciona',
        items: [
          { icon: '1️⃣', text: 'Envia a mensagem inicial para o público' },
          { icon: '💬', text: 'Contato responde (qualquer texto ou palavra-chave)' },
          { icon: '🤖', text: 'Sistema reconhece e envia a próxima mensagem' },
          { icon: '🔀', text: 'Várias opções podem abrir caminhos diferentes' },
          { icon: '🛑', text: 'Palavras como sair / parar encerram o fluxo' },
        ],
      },
      {
        type: 'tip',
        text: 'Reconhece variações: “SAIR”, “Sair” e “saír” são tratados como a mesma intenção.',
      },
    ],
  },
  {
    id: 'contatos',
    icon: '👥',
    title: 'Contatos',
    color: '#10b981',
    illuKey: 'contatos',
    demoId: 'contatos',
    viewId: 'contacts',
    content: [
      { type: 'path', crumbs: ['Disparos', 'Contatos', 'Importar'] },
      {
        type: 'text',
        text: 'Base de clientes: importar, filtrar, listar e selecionar em lote para campanhas.',
      },
      {
        type: 'list',
        title: 'Barra lateral (filtros)',
        items: [
          { icon: '📋', text: 'Todos' },
          { icon: '🔥', text: 'Temperatura — Quente / Morno / Frio' },
          { icon: '🎂', text: 'Aniversário, retorno, duplicados (quando disponíveis)' },
        ],
      },
      {
        type: 'list',
        title: 'Ações na tabela',
        items: [
          { icon: '☑️', text: 'Selecionar vários → excluir, exportar, lista, tags, criar campanha' },
          { icon: '📥', text: 'Importar CSV/Excel, vCard ou colar texto (baixe o modelo de colunas)' },
          { icon: '📁', text: 'Listas — um número pode estar em várias listas sem duplicar a ficha' },
          { icon: '🗺️', text: 'Mapa dos contatos — visão por cidade/DDD (menu Disparos)' },
        ],
      },
      {
        type: 'steps',
        title: 'Importar com segurança',
        items: [
          'Clique em Importar',
          'Baixe o modelo e preencha nome + telefone (+ colunas opcionais)',
          'Faça upload ou cole o texto',
          'Confirme a prévia e importe',
          'Crie uma lista (ex.: Campanha Março) e adicione os novos',
        ],
      },
      {
        type: 'warning',
        text: 'Só dispare para quem autorizou receber (opt-in). Listas compradas aumentam risco de ban e problema legal (LGPD).',
      },
    ],
  },
  {
    id: 'relatorios',
    icon: '📈',
    title: 'Relatórios',
    color: '#a855f7',
    illuKey: 'relatorios',
    viewId: 'reports',
    content: [
      { type: 'path', crumbs: ['Disparos', 'Relatórios'] },
      {
        type: 'text',
        text: 'Desempenho consolidado: totais, funil (quando disponível), mapa de calor e CSV.',
      },
      {
        type: 'list',
        title: 'O que analisar',
        items: [
          { icon: '🗓️', text: 'Período: 7 dias, 30 dias ou 3 meses' },
          { icon: '📊', text: 'Mensagens enviadas, sucesso e falhas' },
          { icon: '🌡️', text: 'Mapa de calor hora × dia da semana' },
          { icon: '⬇️', text: 'Exportar CSV para Excel / Sheets' },
        ],
      },
      {
        type: 'tip',
        text: 'Use o mapa de calor para agendar campanhas nos horários em que seu público mais engaja.',
      },
    ],
  },
  {
    id: 'aquecimento',
    icon: '🔥',
    title: 'Aquecimento (Warmup)',
    color: '#f59e0b',
    illuKey: 'aquecimento',
    viewId: 'warmup',
    content: [
      { type: 'path', crumbs: ['Operações', 'Aquecimento'] },
      {
        type: 'text',
        text: 'Educa chips novos com volume gradual. Siga as recomendações da própria tela e o plano abaixo.',
      },
      {
        type: 'steps',
        title: 'Plano sugerido (msgs/dia)',
        items: [
          'Dias 1–3: até 20 (conversas naturais)',
          'Dias 4–7: até 50',
          'Semana 2: até 100',
          'Semana 3: até 200',
          'Semana 4+: até 300 (teto seguro por chip)',
        ],
      },
      {
        type: 'checklist',
        title: 'Regras de ouro',
        items: [
          'Aquecer chips novos por pelo menos 2 semanas antes de massa',
          'Intervalo mínimo 8–15s entre mensagens',
          'Não disparar lista fria com chip novo',
          'Não ultrapassar ~300 msgs/dia por chip, mesmo aquecido',
        ],
      },
    ],
  },
  {
    id: 'atendimento',
    icon: '🤖',
    title: 'Atendimento (Bot)',
    color: '#6366f1',
    viewId: 'support-bot',
    content: [
      { type: 'path', crumbs: ['Operações', 'Atendimento'] },
      {
        type: 'text',
        text: 'Configure respostas automáticas e handoff para humano quando a conversa precisar de atendimento manual.',
      },
      {
        type: 'list',
        title: 'Ideia geral',
        items: [
          { icon: '🤖', text: 'Bot responde enquanto a equipe não está disponível' },
          { icon: '🙋', text: 'Handoff — passa a conversa para um atendente no Bate-papo' },
          { icon: '⚙️', text: 'Regras e textos ficam nesta tela — teste antes de ligar em produção' },
        ],
      },
      {
        type: 'tip',
        text: 'Combine Atendimento + Bate-papo: o bot filtra o básico; humanos fecham a venda ou o suporte.',
      },
    ],
  },
  {
    id: 'assinatura',
    icon: '👑',
    title: 'Minha assinatura',
    color: '#eab308',
    viewId: 'subscription',
    content: [
      { type: 'path', crumbs: ['Sistema', 'Minha assinatura'] },
      {
        type: 'text',
        text: 'Situação do plano, renovação, upgrade de canais e pagamentos (Pix / cartão conforme opções na tela).',
      },
      {
        type: 'list',
        title: 'O que fazer aqui',
        items: [
          { icon: '📅', text: 'Ver se está ativo, em teste ou precisa renovar' },
          { icon: '📶', text: 'Canais extras quando o sistema oferecer' },
          { icon: '💳', text: 'Renovar ou mudar plano pelos botões de pagamento' },
        ],
      },
    ],
  },
  {
    id: 'configuracoes',
    icon: '⚙️',
    title: 'Configurações',
    color: '#8b949e',
    illuKey: 'configuracoes',
    viewId: 'settings',
    content: [
      { type: 'path', crumbs: ['Sistema', 'Configurações'] },
      {
        type: 'text',
        text: 'Ajustes em abas (chips): disparo, aparência, notificações, conta e termos.',
      },
      {
        type: 'grid',
        items: [
          { icon: '⏱️', title: 'Disparo', desc: 'Intervalo min/máx, limite diário, silêncio noturno — Salvar após mudar' },
          { icon: '🎨', title: 'Aparência', desc: 'Tema claro/escuro e cor de destaque' },
          { icon: '🔔', title: 'Notificações', desc: 'E-mail de alerta e webhook' },
          { icon: '👤', title: 'Minha conta', desc: 'Dados do login e versão da API' },
          { icon: '📄', title: 'Termos', desc: 'LGPD, política WhatsApp e aceite de risco' },
        ],
      },
      {
        type: 'warning',
        text: 'Apagar todos os dados é irreversível — só use após digitar a confirmação exigida na tela.',
      },
      {
        type: 'tip',
        text: 'Intervalo mínimo entre 8 e 15 segundos reduz risco de bloqueio.',
      },
    ],
  },
  {
    id: 'boas-praticas',
    icon: '✅',
    title: 'Boas Práticas',
    color: '#10b981',
    content: [
      {
        type: 'text',
        text: 'Seguir isto melhora entregabilidade e protege seus chips.',
      },
      {
        type: 'checklist',
        title: 'Antes de cada campanha',
        items: [
          'Chips Online em Conexões',
          'Lista com opt-in',
          'Mensagem com {nome} e spintax',
          'Intervalo ≥ 8s em Configurações → Disparo',
          'Teste para 2–3 números',
          'Revisão final antes de Disparar agora',
        ],
      },
      {
        type: 'checklist',
        title: 'Manter chips saudáveis',
        items: [
          'Máximo ~300 msgs/dia por chip',
          'Aquecer chips novos 2+ semanas',
          'Evitar listas desatualizadas ou compradas',
          'Pausar se a taxa de erro subir',
          'Monitorar saúde dos chips no Centro de Campanhas',
        ],
      },
    ],
  },
];
