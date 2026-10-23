import { Campaign, CampaignStatus } from '../types';
import type { CampaignProgressMetrics } from './campaignMetrics';

/** Dica curta de próxima ação na lista de campanhas (linguagem comercial). */
export function getCampaignNextActionHint(
  campaign: Campaign,
  metrics: CampaignProgressMetrics
): string {
  const st = campaign.status;

  if (st === CampaignStatus.RUNNING) {
    if (metrics.pending > 0) return 'Envios em andamento — acompanhe o progresso ou pause se precisar.';
    if (metrics.progressPct >= 100) return 'Finalizando últimos registros no painel.';
    return 'Aguardando início dos envios — confira se os chips estão online.';
  }
  if (st === CampaignStatus.PAUSED) return 'Retome quando quiser continuar de onde parou.';
  if (st === CampaignStatus.SCHEDULED) return 'Aguardando horário — abra para ver quando dispara.';
  if (st === CampaignStatus.WAITING_REPLY) return 'Aguardando respostas dos contatos para avançar o fluxo.';
  if (st === CampaignStatus.COMPLETED) return 'Concluída — abra o relatório ou clone para repetir.';
  if (st === CampaignStatus.FAILED) return 'Algo falhou — abra detalhes e use «Tentar de novo».';
  if (st === CampaignStatus.DRAFT) return 'Rascunho — conclua o assistente ou inicie o disparo.';
  return 'Abra para ver detalhes e ações disponíveis.';
}
