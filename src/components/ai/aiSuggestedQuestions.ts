export type AiSuggestion = {
  label: string;
  question: string;
};

const GLOBAL: AiSuggestion[] = [
  { label: 'Resumo da conta', question: 'Me dê um resumo rápido da minha conta hoje' },
  { label: 'Total de contatos', question: 'Quantos contatos tenho na base?' },
  { label: 'Conversas pendentes', question: 'Quantas conversas não lidas tenho?' },
];

const BY_SCREEN: Record<string, AiSuggestion[]> = {
  dashboard: [
    { label: 'Campanhas ativas', question: 'Quantas campanhas estão ativas agora?' },
    { label: 'Chips conectados', question: 'Quantos chips WhatsApp estão conectados?' },
    { label: 'Top cidades', question: 'Quais cidades têm mais contatos?' },
    { label: 'Saúde da base', question: 'Quantos contatos têm bairro preenchido?' },
  ],
  contacts: [
    { label: 'Importar melhor', question: 'Como organizar contatos antes de importar?' },
    { label: 'Duplicados', question: 'Como identificar duplicados na importação?' },
    { label: 'Maiores listas', question: 'Quais são minhas maiores listas de contatos?' },
    { label: 'Cidade com mais', question: 'Qual cidade tem mais contatos na base?' },
  ],
  'contacts-map': [
    { label: 'Blumenau por bairro', question: 'Quantos contatos tenho em Blumenau por bairro?' },
    { label: 'Bairro Água Verde', question: 'Quantos contatos tenho no bairro Água Verde?' },
    { label: 'Dados incompletos', question: 'Quantos contatos estão sem bairro ou cidade?' },
    { label: 'Maior concentração', question: 'Qual bairro tem mais contatos?' },
  ],
  campaigns: [
    { label: 'Última campanha', question: 'Como está o desempenho da última campanha?' },
    { label: 'Taxa de resposta', question: 'Qual a taxa de resposta das campanhas recentes?' },
    { label: 'Campanhas agendadas', question: 'Tenho campanhas agendadas? Quais?' },
    { label: 'Sugerir mensagem', question: 'Dê dicas para melhorar mensagem de campanha no WhatsApp' },
  ],
  chat: [
    { label: 'Quem escreveu', question: 'Quem me mandou mensagem mais recentemente?' },
    { label: 'Não lidas', question: 'Liste conversas com mensagens não lidas' },
    { label: 'Total inbox', question: 'Quantas conversas tenho no bate-papo?' },
  ],
  connections: [
    { label: 'Status dos chips', question: 'Quais chips estão conectados e qual a fila de envio?' },
    { label: 'Envios hoje', question: 'Quantas mensagens foram enviadas hoje pelos chips?' },
  ],
  reports: [
    { label: 'Performance', question: 'Resuma o desempenho das minhas campanhas' },
    { label: 'Contatos por UF', question: 'Como estão distribuídos meus contatos por estado?' },
  ],
  warmup: [
    { label: 'Aquecimento', question: 'O que é aquecimento de chip e quando usar?' },
  ],
  'ai-assistant': [
    { label: 'Blumenau bairros', question: 'Quantos contatos tenho em Blumenau por bairro?' },
    { label: 'Listas', question: 'Quais são minhas listas e quantos contatos cada uma tem?' },
    { label: 'Campanha ativa', question: 'Há alguma campanha ativa? Como está?' },
    { label: 'Inbox', question: 'Quantas conversas não lidas tenho agora?' },
  ],
};

/** Sugestões contextuais por tela + perguntas gerais (sem duplicar). */
export function getAiSuggestions(screen: string, limit = 8): AiSuggestion[] {
  const screenItems = BY_SCREEN[screen] ?? BY_SCREEN.dashboard ?? [];
  const seen = new Set<string>();
  const out: AiSuggestion[] = [];
  for (const item of [...screenItems, ...GLOBAL]) {
    const key = item.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
