import type { AssistantIntent } from './assistantTypes.js';

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

const NAV_MAP: Array<{ view: string; words: string[] }> = [
  { view: 'connections', words: ['conexoes', 'conexao', 'chips', 'qr'] },
  { view: 'contacts', words: ['contatos', 'contato', 'lista de contatos'] },
  { view: 'campaigns', words: ['campanhas', 'campanha', 'disparos'] },
  { view: 'chat', words: ['chat', 'bate papo', 'conversas'] },
  { view: 'dashboard', words: ['painel', 'dashboard', 'inicio'] },
  { view: 'reports', words: ['relatorios', 'relatorio'] },
  { view: 'warmup', words: ['aquecimento', 'warmup'] },
  { view: 'subscription', words: ['assinatura', 'plano', 'pagamento'] },
  { view: 'settings', words: ['configuracoes', 'configuracao', 'ajustes'] },
  { view: 'help', words: ['tutorial', 'como usar', 'ajuda'] },
  { view: 'team', words: ['funcionarios', 'equipe'] }
];

export function classifyIntent(question: string): AssistantIntent {
  const q = normalize(question);
  if (!q) return 'unknown';

  if (
    hasAny(q, [
      'quantos contatos',
      'total de contatos',
      'numero de contatos',
      'qtd contatos',
      'base de contatos'
    ])
  ) {
    return 'data_contacts';
  }

  if (
    hasAny(q, [
      'quantas campanhas',
      'campanhas ativas',
      'campanha ativa',
      'campanhas rodando',
      'ultima campanha',
      'última campanha',
      'status campanha'
    ])
  ) {
    return 'data_campaigns';
  }

  if (
    hasAny(q, [
      'quantos chips',
      'chips online',
      'chips offline',
      'conexoes online',
      'conexões online',
      'status dos chips',
      'whatsapp conectado'
    ])
  ) {
    return 'data_connections';
  }

  if (
    hasAny(q, [
      'meu plano',
      'minha assinatura',
      'assinatura',
      'trial',
      'teste gratis',
      'teste grátis',
      'quando expira',
      'renovacao',
      'renovação'
    ]) &&
    !hasAny(q, ['como', 'onde', 'tutorial'])
  ) {
    return 'data_subscription';
  }

  if (
    hasAny(q, [
      'resumo',
      'visao geral',
      'visão geral',
      'como esta',
      'como está',
      'meus numeros',
      'meus números',
      'situacao',
      'situação',
      'overview'
    ])
  ) {
    return 'data_overview';
  }

  if (
    hasAny(q, [
      'sugira',
      'sugere',
      'escreva',
      'escrever',
      'mensagem para',
      'texto para',
      'modelo de',
      'crie uma mensagem',
      'me ajude a escrever'
    ])
  ) {
    return 'creative';
  }

  if (hasAny(q, ['abrir', 'ir para', 'mostrar', 'onde fica', 'onde esta', 'onde está'])) {
    for (const nav of NAV_MAP) {
      if (hasAny(q, nav.words)) return 'navigate';
    }
  }

  if (
    hasAny(q, [
      'como',
      'onde',
      'o que e',
      'o que é',
      'passo a passo',
      'tutorial',
      'explicar',
      'funciona',
      'importar',
      'conectar',
      'agendar',
      'intervalo',
      'bloqueio',
      'aquecimento'
    ])
  ) {
    return 'tutorial';
  }

  for (const nav of NAV_MAP) {
    if (q.split(' ').length <= 4 && hasAny(q, nav.words)) {
      return 'navigate';
    }
  }

  return 'tutorial';
}

export function resolveNavigateView(question: string): string | undefined {
  const q = normalize(question);
  for (const nav of NAV_MAP) {
    if (hasAny(q, nav.words)) return nav.view;
  }
  return undefined;
}

export function normalizeQuestionKey(question: string): string {
  return normalize(question).slice(0, 500);
}
