/** Textos centralizados para ZmFieldHelp — telas comerciais (PT-BR). */

export const FIELD_HELP = {
  antiBanInterval:
    'Tempo aleatório entre cada envio. Recomendamos 15–45 s no mínimo e até 90–120 s no máximo em chips novos. Valores baixos demais aumentam risco de bloqueio pelo WhatsApp.',
  humanizedPauses:
    'Depois de um lote de mensagens, o sistema faz uma pausa extra (como uma pausa para café) para parecer uso humano e reduzir alertas automáticos.',
  dailyLimitPerChip:
    'Cada chip para de enviar campanhas ao atingir esse total no dia (horário de Brasília). Reinicia sozinho à meia-noite. Chips novos: comece com ~100/dia.',
  sleepMode:
    'Entre o horário de início e fim, nenhuma campanha dispara — útil para não incomodar contatos à noite ou respeitar políticas internas.',
  channelWeight:
    'Chips com peso maior recebem mais mensagens da campanha. Use para priorizar linha comercial vs. suporte.',
  chipName:
    'Nome interno só para você reconhecer o chip no painel (ex.: Comercial, Suporte). Não aparece para o contato.',
  chipProxy:
    'IP dedicado por chip (proxy residencial ou datacenter). Opcional; após conectar, alterações ficam bloqueadas por 7 dias.',
  pairingCode:
    'Alternativa ao QR: informe o número com DDI (5511…) e digite o código de 8 dígitos que aparece no celular.',
  campaignAudience:
    'Quem recebe a campanha: lista salva, filtros da base ou números colados manualmente. Revise duplicados antes de disparar.',
  campaignAudienceList:
    'Escolha uma lista já criada na aba Contatos. É o caminho mais simples: você vê quantos números válidos existem antes de disparar.',
  campaignAudienceFilter:
    'Combine cidade, DDD, cargo e outros campos para montar um segmento dinâmico. Ideal quando a base é grande e você não quer manter listas fixas.',
  campaignAudienceManual:
    'Cole números avulsos (DDI + DDD). Útil para testes rápidos ou listas de fora do CRM — sem variáveis extras além do telefone.',
  campaignAudienceSpreadsheet:
    'Baixe o modelo XLSX, preencha e importe. Você pode validar no WhatsApp antes de avançar — bom para bases de eventos ou parceiros.',
  campaignKindStandard:
    'Campanha clássica: você escolhe lista, filtros ou números, escreve a mensagem e dispara (ou agenda) uma vez.',
  campaignKindProspecting:
    'Varre a base inteira (exceto opt-out): quem responde entra no plano de follow-up; quem fica em silêncio recebe lembretes semanais automáticos.',
  campaignWizardName:
    'Nome interno só para você achar a campanha depois — contatos não veem. Ex.: «Promoção VIP — março».',
  campaignWizardMessage:
    'Texto que o contato recebe no WhatsApp. Use modelos rápidos, variáveis como {nome} e, se quiser, anexo na 1ª mensagem.',
  campaignFlowModePicker:
    'Disparo único = uma mensagem para todos. Fluxo por respostas = abertura + respostas automáticas conforme o que a pessoa mandar.',
  campaignFlowSingle:
    'Ideal para avisos, convites, lembretes e promoções: o mesmo texto vai para cada contato da lista, de uma vez.',
  campaignFlowReply:
    'Ideal para funis, opt-in e menus (1, 2, 3): você envia a abertura e o sistema responde sozinho quando o contato interage.',
  campaignMessageTemplates:
    'Modelos prontos preenchem o editor com um clique — você pode editar antes de disparar. Não substituem modelos salvos na biblioteca.',
  campaignMessageVariables:
    'Variáveis como {nome} e {cidade} são trocadas pelos dados do contato no envio. Se o campo estiver vazio no cadastro, a variável sai em branco.',
  campaignMessageAttachment:
    'Imagem, vídeo ou PDF na 1ª mensagem — o texto vira legenda. Só em disparo imediato (sem agendamento). Tamanho máximo conforme limite do WhatsApp.',
  campaignWizardReview:
    'Última checagem antes do disparo: público, mensagem, chips e horário. Use o teste rápido para enviar ao seu número.',
  campaignSchedule:
    'Escolha disparar agora ou reservar horários na semana. O fuso segue o relógio do seu navegador — ideal para não enviar de madrugada.',
  replyFlow:
    'Fluxo por respostas: cada etapa só avança quando o contato manda a palavra-gatilho (ex.: QUERO). Ideal para funis e opt-in.',
  spinTrax:
    'Variações de texto ({A|B|C}) para cada contato receber uma versão ligeiramente diferente — reduz padrão repetitivo.',
  silentBump:
    'Para quem não respondeu à abertura: lembrete semanal automático até o limite de semanas que você definir.',
  channelExtras:
    'Canais além do incluído no plano. Cobrança separada no Mercado Pago; liberam slots extras na aba Conexões.',
  creatorBillingTiers:
    'Valores reais cobrados no checkout Mercado Pago (1 a 5 canais). Alterações aqui valem para novos pagamentos; assinaturas já ativas mantêm o valor contratado até mudar de plano.',
  creatorMarketingPrices:
    'Textos exibidos na landing e no modal Pro. Não alteram a cobrança — use para copy comercial ou promoções visuais.',
  creatorChannelAddon:
    'Preço mensal de referência por slot extra (legado). O MRR estimado na aba Ganhos usa este valor para add-ons.',
  trialPro:
    'Teste libera envios e todas as abas pelo período promocional. Sem cartão. Ao terminar, você escolhe o Pro ou fica só em leitura.',
  warmup:
    'Simula conversas leves entre seus chips para “aquecer” números novos antes de campanhas pesadas. Não substitui intervalo anti-ban.',
  diagnosticsExport:
    'Pacote JSON com erros recentes — envie ao suporte ou anexe em ticket. Não contém senhas; pode incluir IDs internos.',
  dispatchQueue:
    'Fila técnica BullMQ no servidor — só administradores. Clientes não precisam abrir esta tela.',
  connectionPool:
    'Agrupa chips para rodízio automático: se um cair offline, outro do mesmo pool continua os envios pendentes.',
  nurtureJourney:
    'Sequência automática para leads quentes após palavra-gatilho — complementa campanhas de abertura.',
  supportBot:
    'Menu de respostas automáticas no WhatsApp (fora do horário ou sempre). Handoff passa para o Bate-papo humano.',
  teamMembers:
    'Convide funcionários com login próprio. Eles usam os chips e campanhas da conta principal, sem ver cobrança.',
  contactsMap:
    'Visualize concentração por DDD/região e planeje campanhas territoriais. Dados vêm dos telefones cadastrados.',
  minDelaySettings:
    'Valor mínimo da faixa aleatória entre mensagens. Vale como padrão para novas campanhas se você não alterar no assistente.',
  maxDelaySettings:
    'Valor máximo da faixa. Quanto maior a diferença entre mínimo e máximo, mais natural o ritmo de envio.',
  chipProtection:
    'Reduz sync pesado e pausas automáticas quando o chip cai, leva ban ou muitas reconexões seguidas — protege a linha sem parar campanhas nos outros chips do pool.',
  contactsToolbar:
    'Use «Novo contato» ou «Importar planilha» no dia a dia. Baixe o modelo XLSX antes da primeira importação. Ferramentas avançadas (exportar, corrigir base, agenda no chip) ficam em «Mais ações».',
  contactsImportAuto:
    'Com as opções ligadas, o ZapMass padroniza nomes, ajusta telefones para o formato Brasil (55…) e destaca duplicados antes de gravar. Você ainda pode revisar linha a linha.',
  contactsImportDestination:
    'Listas organizam campanhas: contatos novos entram na lista escolhida; quem já existe no CRM pode ser só vinculado à lista, sem criar outro cadastro.',
  contactsImportTemplate:
    'Planilha oficial com colunas «Nome» e «Telefone» (obrigatórias) e campos extras opcionais. Preencha e use «Importar planilha».',
  contactsInsights:
    'Painel de segmentos, mapas e métricas da base — ideal para planejar campanhas sem misturar com importação do dia a dia.',
  dashboardAnalytics:
    'Blocos opcionais abaixo do pulso do dia: campanhas, canais, funil e qualidade da base. Expanda só o que precisar.',
  dashboardCampaignRadar:
    'Visão rápida do que está em disparo, agendado e qual campanha performou melhor — sem abrir a lista completa.',
  dashboardChipHealth:
    'Ritmo de envio por canal, fila e pausas automáticas de proteção. Chips “quente” já aguentam mais volume.',
  dashboardFunnel:
    'Últimos 7 dias mostram envios por dia; Histórico total acumula desde que você começou (persiste após reinícios).',
  dashboardContactTemp:
    'Classifica contatos por última interação: quentes respondem recente; frios precisam de reativação.',
  dashboardBaseQuality:
    'Percentual pronto para disparo (nome + telefone válidos) e alertas de duplicados, nomes genéricos ou opt-out.',
  dashboardLiveReplies:
    'Feed das últimas respostas nas conversas carregadas — atalho para abrir o chat sem procurar na lista.'
} as const;
