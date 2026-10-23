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
  replyFlow:
    'Fluxo por respostas: cada etapa só avança quando o contato manda a palavra-gatilho (ex.: QUERO). Ideal para funis e opt-in.',
  spinTrax:
    'Variações de texto ({A|B|C}) para cada contato receber uma versão ligeiramente diferente — reduz padrão repetitivo.',
  silentBump:
    'Para quem não respondeu à abertura: lembrete semanal automático até o limite de semanas que você definir.',
  channelExtras:
    'Canais além do incluído no plano. Cobrança separada no Mercado Pago; liberam slots extras na aba Conexões.',
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
    'Valor máximo da faixa. Quanto maior a diferença entre mínimo e máximo, mais natural o ritmo de envio.'
} as const;
