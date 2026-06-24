import type { KnowledgeChunk } from './assistantTypes.js';

/** Base de conhecimento embutida (sempre disponível no Docker, sem depender de docs/ no runtime). */
export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  {
    id: 'intro',
    title: 'O que é o ZapMass',
    keywords: ['zapmass', 'o que é', 'para que serve', 'sistema', 'painel'],
    body:
      'O ZapMass é um painel web para organizar contatos, ligar chips de WhatsApp, enviar mensagens em massa ou programadas e acompanhar resultados, com cuidado anti-bloqueio (intervalos entre envios, aquecimento dos chips, etc.).',
    navigateTo: 'help'
  },
  {
    id: 'connections',
    title: 'Conexões WhatsApp',
    keywords: [
      'conexão',
      'conexões',
      'conectar',
      'chip',
      'chips',
      'qr',
      'qrcode',
      'whatsapp',
      'online',
      'offline',
      'reconectar',
      'pareamento'
    ],
    body:
      'Em **Conexões** você adiciona cada chip (número WhatsApp). Clique em **Novo / Adicionar conexão**, escaneie o QR Code no celular e aguarde o status **Online**. Use **reconectar** ou **QR** se cair. Respeite o limite de chips do seu plano.',
    navigateTo: 'connections'
  },
  {
    id: 'contacts',
    title: 'Contatos e listas',
    keywords: [
      'contato',
      'contatos',
      'lista',
      'listas',
      'importar',
      'csv',
      'excel',
      'xlsx',
      'vcard',
      'duplicado',
      'temperatura',
      'quente',
      'morno',
      'frio'
    ],
    body:
      'Em **Contatos** você gerencia a base, cria **listas**, importa CSV/Excel/vCard e filtra por temperatura (engajamento), aniversário, etc. Selecione vários contatos para exportar, excluir ou **criar campanha** com os selecionados.',
    navigateTo: 'contacts'
  },
  {
    id: 'campaigns',
    title: 'Campanhas',
    keywords: [
      'campanha',
      'campanhas',
      'disparo',
      'disparos',
      'envio em massa',
      'agendar',
      'agenda',
      'sequencial',
      'fluxo',
      'resposta',
      'anti-ban',
      'intervalo'
    ],
    body:
      'Em **Campanhas**, use **Nova campanha**: (1) escolha o público (lista, filtros ou números); (2) escreva a mensagem (uma ou várias etapas, fluxo por respostas ou sequência); (3) selecione os chips e intervalo anti-ban; (4) revise e dispare agora ou agende. Sempre confira na revisão antes de disparar.',
    navigateTo: 'campaigns'
  },
  {
    id: 'chat',
    title: 'Bate-papo / Pipeline',
    keywords: ['chat', 'bate-papo', 'conversa', 'conversas', 'pipeline', 'inbox', 'mensagem individual'],
    body:
      'O **Bate-papo** lista conversas por chip. Serve para acompanhar diálogos após disparos ou falar 1:1. Use busca e filtros quando tiver muitas conversas.',
    navigateTo: 'chat'
  },
  {
    id: 'warmup',
    title: 'Aquecimento',
    keywords: ['aquecimento', 'warmup', 'educar', 'chip novo', 'bloqueio', 'ban'],
    body:
      'O **Aquecimento** envia mensagens graduais em chips novos para reduzir risco de bloqueio. Use antes de campanhas grandes em números recém-conectados.',
    navigateTo: 'warmup'
  },
  {
    id: 'reports',
    title: 'Relatórios',
    keywords: ['relatório', 'relatórios', 'exportar', 'csv', 'funil', 'taxa', 'gráfico'],
    body:
      'Em **Relatórios** escolha o período (7, 30 ou 90 dias), veja envios, taxa de sucesso e funil. Exporte CSV para Excel quando precisar.',
    navigateTo: 'reports'
  },
  {
    id: 'subscription',
    title: 'Assinatura e plano',
    keywords: [
      'assinatura',
      'plano',
      'pagamento',
      'renovar',
      'teste',
      'trial',
      'pix',
      'mercado pago',
      'bloqueado',
      'só leitura'
    ],
    body:
      'Em **Minha assinatura** você vê situação do plano (ativo, teste, renovação), pode renovar ou mudar plano. Sem plano ativo, algumas ações ficam bloqueadas, mas você ainda navega nas telas.',
    navigateTo: 'subscription'
  },
  {
    id: 'settings',
    title: 'Configurações',
    keywords: [
      'configuração',
      'configurações',
      'intervalo',
      'tema',
      'notificação',
      'webhook',
      'disparo',
      'aparência'
    ],
    body:
      'Em **Configurações**: aba **Disparo** (intervalos e limite diário), **Aparência** (tema), **Notificações** (e-mail e webhook), **Minha conta** e termos legais. Salve após alterar intervalos.',
    navigateTo: 'settings'
  },
  {
    id: 'team',
    title: 'Funcionários',
    keywords: ['funcionário', 'funcionários', 'equipe', 'staff', 'senha', 'convite', 'acesso'],
    body:
      'O gestor cadastra **funcionários** com usuário e senha em **Funcionários**. Eles usam a mesma base e assinatura do responsável, sem criar outra conta de pagamento.',
    navigateTo: 'team'
  },
  {
    id: 'server-status',
    title: 'Ligação ao servidor',
    keywords: ['servidor', 'offline', 'verde', 'vermelha', 'bolinha', 'latência', 'travou', 'lento'],
    body:
      'A bolinha verde no menu indica ligação ao servidor. Se estiver vermelha, atualize a página (Ctrl+F5). Latência alta pode indicar sobrecarga — evite abrir muitas abas pesadas ao mesmo tempo.',
    navigateTo: 'dashboard'
  },
  {
    id: 'best-practices',
    title: 'Boas práticas',
    keywords: ['lgpd', 'opt-in', 'bloqueio', 'boas práticas', 'consentimento', 'spam'],
    body:
      'Boas práticas: (1) tenha pelo menos um chip online antes de campanha grande; (2) respeite opt-in/LGPD; (3) aumente intervalos se notar quedas; (4) use listas e filtros; (5) confira a revisão antes de disparar.',
    navigateTo: 'help'
  },
  {
    id: 'shortcuts',
    title: 'Atalhos de campanhas',
    keywords: ['atalho', 'atalhos', 'tecla', 'teclado'],
    body:
      'Na área Campanhas, botão **Atalhos**: **N** = nova campanha, **1** = dashboard, **2** = centro, **3** = lista, **T** = teste de disparo, **?** = ajuda de atalhos.',
    navigateTo: 'campaigns'
  },
  {
    id: 'global-search',
    title: 'Busca global',
    keywords: ['buscar', 'busca', 'ctrl+k', 'cmd+k', 'atalho busca'],
    body:
      'Use **Buscar** na barra superior ou **Ctrl+K** (Mac: Cmd+K) para achar campanhas, contatos, chips e ações rápidas.',
    navigateTo: 'dashboard'
  }
];

/** Modelos de mensagem para intent criativo (sem LLM). */
export const CREATIVE_TEMPLATES: Array<{ label: string; keywords: string[]; body: string }> = [
  {
    label: 'Cobrança amigável',
    keywords: ['cobrança', 'cobrar', 'boleto', 'pagamento', 'vencimento', 'débito'],
    body:
      'Olá {nome}! Passando para lembrar que sua parcela vence em breve. Qualquer dúvida, responda esta mensagem. Obrigado!'
  },
  {
    label: 'Convite evento',
    keywords: ['convite', 'evento', 'presença', 'reunião', 'encontro'],
    body:
      'Olá {nome}, tudo bem? Gostaríamos de contar com sua presença no nosso evento em {cidade}. Confirme por favor respondendo SIM.'
  },
  {
    label: 'Aviso geral',
    keywords: ['aviso', 'comunicado', 'informar', 'importante'],
    body:
      'Olá {nome}! Temos um aviso importante para você. Leia com atenção e responda se tiver dúvidas. Obrigado!'
  },
  {
    label: 'Reengajamento',
    keywords: ['reengajar', 'sumiu', 'retorno', 'volta', 'reativar'],
    body:
      'Olá {nome}! Faz tempo que não conversamos. Posso ajudar com algo? Responda quando puder — estamos à disposição.'
  },
  {
    label: 'Opt-out LGPD',
    keywords: ['sair', 'descadastrar', 'lgpd', 'parar mensagens'],
    body:
      'Olá {nome}! Passando para manter contato. Se preferir não receber mensagens, responda SAIR. Obrigado!'
  }
];
