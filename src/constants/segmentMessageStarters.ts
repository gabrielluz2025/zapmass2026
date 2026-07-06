import type { MessageQuickStarter } from '../components/campaigns/CampaignMessageQuickStarters';

/** Modelos extras por segmento de uso (além dos genéricos). */
export const SEGMENT_MESSAGE_STARTERS: Record<string, Omit<MessageQuickStarter, 'icon'>[]> = {
  religious: [
    {
      id: 'culto',
      label: 'Convite culto',
      hint: 'Igreja / comunidade',
      body: 'Olá {nome}, {saudacao}! 🙏\n\nConvidamos você para nosso culto. Será uma alegria ter você conosco!',
      accent: '#6366f1'
    },
    {
      id: 'visita',
      label: 'Visita pastoral',
      hint: 'Agendar visita',
      body: 'Oi {nome}, tudo bem?\n\nGostaríamos de agendar uma visita pastoral. Qual horário seria melhor para você?',
      accent: '#10b981'
    }
  ],
  commerce: [
    {
      id: 'promo-loja',
      label: 'Promoção',
      hint: 'Varejo / loja',
      body: 'Oi {nome}! 🔥 Promoção especial em {cidade} só até amanhã.\n\nResponda SIM que te mando os detalhes!',
      accent: '#ef4444'
    },
    {
      id: 'carrinho',
      label: 'Carrinho',
      hint: 'Recuperação',
      body: 'Olá {nome}, viu que você deixou itens no carrinho. Posso te ajudar a finalizar?',
      accent: '#f59e0b'
    }
  ],
  health: [
    {
      id: 'consulta',
      label: 'Lembrete consulta',
      hint: 'Clínica',
      body: 'Olá {nome}! Lembrete: sua consulta está agendada. Confirme respondendo OK.',
      accent: '#06b6d4'
    }
  ],
  realestate: [
    {
      id: 'imovel',
      label: 'Novo imóvel',
      hint: 'Corretor',
      body: 'Oi {nome}! Separei opções de imóveis em {cidade} dentro do seu perfil. Quer ver as fotos?',
      accent: '#8b5cf6'
    }
  ]
};
