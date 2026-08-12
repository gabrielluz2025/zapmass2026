/** Tipos e labels dos filtros da aba Contatos (antes em ContactsSidebar). */

export type SmartFilterId =
  | 'all'
  | 'hot'
  | 'warm'
  | 'cold'
  | 'new'
  | 'bday_today'
  | 'bday_week'
  | 'wedding_today'
  | 'wedding_week'
  | 'dormant'
  | 'invalid'
  | 'no_address'
  | 'duplicates'
  | 'retorno_todos'
  | 'retorno_atrasados'
  | 'retorno_hoje'
  | 'retorno_semana'
  | 'no_list'
  | 'blacklist'
  | `list:${string}`;

export interface SidebarCounts {
  all: number;
  hot: number;
  warm: number;
  cold: number;
  new: number;
  bday_today: number;
  bday_week: number;
  wedding_today: number;
  wedding_week: number;
  dormant: number;
  invalid: number;
  no_address: number;
  duplicates: number;
  retorno_todos: number;
  retorno_atrasados: number;
  retorno_hoje: number;
  retorno_semana: number;
  no_list: number;
  blacklist: number;
}

export const FILTER_LABELS: Record<string, string> = {
  all: 'Todos os contatos',
  hot: 'Quentes',
  warm: 'Mornos',
  cold: 'Frios',
  new: 'Sem histórico',
  bday_today: 'Aniversariantes hoje',
  bday_week: 'Aniversariantes (7 dias)',
  wedding_today: 'Bodas hoje',
  wedding_week: 'Bodas (7 dias)',
  dormant: 'Dormentes',
  invalid: 'Telefone inválido',
  no_address: 'Sem endereço',
  duplicates: 'Duplicados',
  retorno_todos: 'Com retorno',
  retorno_atrasados: 'Retorno atrasado',
  retorno_hoje: 'Retorno hoje',
  retorno_semana: 'Retorno (7 dias)',
  no_list: 'Sem lista',
  blacklist: 'Lista negra',
};
