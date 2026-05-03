import type { UseSegmentId } from './useSegments';

export type SegmentMessageBlueprint = {
  id: string;
  label: string;
  /** Texto com variáveis {nome} alinhadas ao assistente de campanhas. */
  body: string;
};

export type SegmentTutorialHint = {
  /** Título curto (ex.: secção do tutorial). */
  title: string;
  /** Por que ler neste segmento. */
  why: string;
};

export type SegmentExperience = {
  /** Linha curta sob o cumprimento no Painel. */
  dashboardTagline: string;
  /** Dicas práticas (lista). */
  dashboardTips: string[];
  /** Atalhos extra sugeridos: id da vista em AppViewContext. */
  suggestedNav: Array<{ view: string; label: string; hint: string }>;
  /** Modelos de mensagem para copiar ou colar na campanha. */
  messageBlueprints: SegmentMessageBlueprint[];
  /** Ordem sugerida de leitura no tutorial (doc `TUTORIAL-USUARIO-ZAPMASS.md`). */
  tutorialHints: SegmentTutorialHint[];
};

const RELIGIOUS: SegmentExperience = {
  dashboardTagline: 'Organize avisos, grupos e pastoral com respeito ao ritmo das pessoas.',
  dashboardTips: [
    'Use horários sensatos (evite madrugada) e intervalos maiores entre envios para parecer conversa, não robô.',
    'Em Contatos, preencha {igreja} e {cargo} para mensagens mais pessoais nas campanhas.',
    'O aquecimento de chips novos ajuda antes de avisos a listas grandes — veja o menu Aquecimento.'
  ],
  suggestedNav: [
    {
      view: 'religious-members',
      label: 'Ficha de membro',
      hint: 'Formulário rápido só no segmento religioso.'
    },
    {
      view: 'pastoral-visits',
      label: 'Visitas pastorais',
      hint: 'Agenda, ceia e quem está sem visita há tempo.'
    },
    { view: 'contacts', label: 'Contatos', hint: 'Listas por grupo, aniversários e etiquetas.' },
    { view: 'warmup', label: 'Aquecimento', hint: 'Prepare números novos antes de avisos em massa.' }
  ],
  messageBlueprints: [
    {
      id: 'culto',
      label: 'Lembrete de culto',
      body: 'Ola {nome}! Passando para lembrar do nosso culto neste domingo. Contamos com a sua presenca. Paz!'
    },
    {
      id: 'grupo',
      label: 'Grupo de estudo',
      body: 'Ola {nome}! O grupo se reune amanha as 20h. Se puder, confirme com um sim. Obrigado!'
    },
    {
      id: 'oracao',
      label: 'Pedido de oração',
      body: 'Ola {nome}, tudo bem? Estamos reunidos em oracao e lembramos de voce. Se precisar de algo, responda aqui.'
    }
  ],
  tutorialHints: [
    { title: 'Secção 3 — Menu lateral', why: 'Mapa dos menus: Painel, Contatos, Campanhas, etc.' },
    { title: 'Secção 7 — Campanhas', why: 'Agende avisos e use listas sem sobrecarregar um único chip.' },
    { title: 'Secção 8 — Contatos', why: 'Separe grupos (jovens, células) e use variáveis como {igreja}.' }
  ]
};

const SALES: SegmentExperience = {
  dashboardTagline: 'Acompanhe leads, follow-up e ofertas com intervalos que protegem o seu WhatsApp.',
  dashboardTips: [
    'Mensagens curtas e um call to action claro costumam responder melhor do que textos longos.',
    'Use listas por etapa do funil (novo lead, proposta enviada, fechamento) em Campanhas.',
    'Relatórios mostram leitura e resposta — ajuste o horário dos disparos com base nos chips online.'
  ],
  suggestedNav: [
    { view: 'contacts', label: 'Contatos', hint: 'Temperatura quente/morno/frio ajuda priorizar quem contatar.' },
    { view: 'reports', label: 'Relatórios', hint: 'Veja taxa de resposta e refine o pitch.' }
  ],
  messageBlueprints: [
    {
      id: 'followup',
      label: 'Follow-up suave',
      body: 'Ola {nome}, tudo bem? Vi que recebeu nossa proposta. Posso tirar alguma duvida rapida por aqui?'
    },
    {
      id: 'oferta',
      label: 'Oferta com prazo',
      body: 'Ola {nome}! Condição especial ate sexta para clientes de {cidade}. Quer que eu reserve?'
    },
    {
      id: 'posvenda',
      label: 'Pós-venda',
      body: 'Ola {nome}, aqui é da equipe comercial. Tudo certo com o seu pedido? Estamos a disposicao.'
    }
  ],
  tutorialHints: [
    { title: 'Secção 7 — Campanhas', why: 'Fluxo de etapas e respostas para nutrir leads.' },
    { title: 'Secção 6 — Pipeline (Chat)', why: 'Responda conversas após o primeiro contacto.' },
    { title: 'Secção 5 — Conexões', why: 'Distribua envios por vários chips quando o volume crescer.' }
  ]
};

const COLLECTIONS: SegmentExperience = {
  dashboardTagline: 'Lembretes de pagamento claros e tom respeitoso reduzem atrito e idas ao spam.',
  dashboardTips: [
    'Evite CAPS LOCK e muitos links na mesma mensagem; prefira um boleto ou um passo por vez.',
    'Indique vencimento e valor em uma linha; ofereça canal humano para renegociar.',
    'Use horário comercial e respeite lista de contatos — quem já pagou pode sair da lista de cobrança.'
  ],
  suggestedNav: [
    { view: 'contacts', label: 'Contatos', hint: 'Filtre por etiqueta “em atraso” ou listas por faixa de dias.' },
    { view: 'campaigns', label: 'Campanhas', hint: 'Dispare lembretes escalonados com intervalo seguro.' }
  ],
  messageBlueprints: [
    {
      id: 'vencimento',
      label: 'Vencimento amanhã',
      body: 'Ola {nome}, tudo bem? Lembramos que o boleto vence amanha ({data}). Se ja pagou, desconsidere. Qualquer duvida, responda aqui.'
    },
    {
      id: 'atraso',
      label: 'Após vencimento',
      body: 'Ola {nome}, identificamos titulo em aberto. Podemos enviar segunda via ou acordar parcelamento? Obrigado.'
    },
    {
      id: 'confirmacao',
      label: 'Confirmação de acordo',
      body: 'Ola {nome}! Registramos o combinado de pagamento. Obrigado pela confiança — estamos a disposicao.'
    }
  ],
  tutorialHints: [
    { title: 'Secção 7 — Campanhas', why: 'Agende lembretes e use intervalos para não parecer spam.' },
    { title: 'Secção 8 — Contatos', why: 'Listas por faixa de atraso ou produto.' },
    { title: 'Secção 14 — Boas práticas', why: 'Consentimento, horários e risco de bloqueio.' }
  ]
};

const MASS_BROADCAST: SegmentExperience = {
  dashboardTagline: 'Alto volume exige chips estáveis, aquecimento e limites diários alinhados ao plano.',
  dashboardTips: [
    'Parta o público em listas menores e dispare em janelas diferentes do dia.',
    'Monitore “Canais online” e a fila; pause se o WhatsApp sinalizar bloqueio ou queda de entregas.',
    'Use Relatórios para ver entrega vs. resposta e ajuste texto ou horário na próxima leva.'
  ],
  suggestedNav: [
    { view: 'connections', label: 'Conexões', hint: 'Vários chips distribuem carga e risco.' },
    { view: 'warmup', label: 'Aquecimento', hint: 'Essencial antes de picos grandes em chips novos.' }
  ],
  messageBlueprints: [
    {
      id: 'aviso',
      label: 'Aviso institucional',
      body: 'Comunicado importante: {data} havera alteracao no horario de atendimento. Qualquer duvida, responda esta mensagem.'
    },
    {
      id: 'lista',
      label: 'Mensagem curta em massa',
      body: 'Ola {nome}! Informamos: {data} os servicos funcionam em horario reduzido. Obrigado pela compreensao.'
    },
    {
      id: 'confirmacao',
      label: 'Pedir confirmação de leitura',
      body: 'Ola {nome}, por favor responda SIM ao receber este aviso para confirmarmos o contacto. Obrigado.'
    }
  ],
  tutorialHints: [
    { title: 'Secção 7 — Campanhas', why: 'Modo sequencial e pesos entre chips para volume alto.' },
    { title: 'Secção 10 — Aquecimento', why: 'Protege números novos antes de grandes disparos.' },
    { title: 'Secção 14 — Boas práticas', why: 'Limites, consentimento e risco de bloqueio.' }
  ]
};

const GENERAL: SegmentExperience = {
  dashboardTagline: 'Use o Painel para ver saúde dos chips, campanhas e contatos num só lugar.',
  dashboardTips: [
    'Comece por Conexões (QR) e depois importe ou organize Contatos em listas.',
    'Campanhas aceitam variáveis como {nome} e {cidade} — veja os atalhos no assistente.',
    'O tutorial em Sistema → Como usar explica cada menu em linguagem simples.'
  ],
  suggestedNav: [
    { view: 'help', label: 'Como usar', hint: 'Tutorial passo a passo.' },
    { view: 'settings', label: 'Configurações', hint: 'Intervalos entre envios e tema.' }
  ],
  messageBlueprints: [
    {
      id: 'generico',
      label: 'Mensagem genérica',
      body: 'Ola {nome}! Passando para manter contato. Se preferir nao receber mensagens, responda SAIR. Obrigado!'
    },
    {
      id: 'convite',
      label: 'Convite simples',
      body: 'Ola {nome}, tudo bem? Gostariamos de contar com a sua presenca no evento em {cidade}. Confirme por favor.'
    }
  ],
  tutorialHints: [
    { title: 'Secção 2 — Primeira vez', why: 'Modo leitura, menu e login responsável vs. funcionário.' },
    { title: 'Secção 3 — Menu lateral', why: 'Mapa completo das áreas do sistema.' },
    { title: 'Secção 7 — Campanhas', why: 'Criar o primeiro disparo com segurança.' }
  ]
};

const BY_SEGMENT: Record<UseSegmentId, SegmentExperience> = {
  religious: RELIGIOUS,
  sales: SALES,
  collections: COLLECTIONS,
  mass_broadcast: MASS_BROADCAST,
  general: GENERAL
};

export function getSegmentExperience(id: UseSegmentId): SegmentExperience {
  return BY_SEGMENT[id] ?? GENERAL;
}

/** Telemetria agregada (opcional): no futuro pode enviar-se `segment` no servidor ao guardar perfil ou em evento de campanha. */
