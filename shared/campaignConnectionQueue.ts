/** Jobs na fila Bull por chip (`campaign-ch-*`) — exclui reply flow e nurture na fila global de respostas. */
export function shouldCountJobOnConnectionMassQueue(item: {
  replyFlowResponse?: boolean;
  nurtureFollowUp?: boolean;
}): boolean {
  return !item.replyFlowResponse && !item.nurtureFollowUp;
}
