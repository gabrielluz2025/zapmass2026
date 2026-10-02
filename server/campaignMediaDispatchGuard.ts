/** Job de abertura de campanha em massa deve enviar mídia — não degradar para só texto. */
export function massCampaignMustSendOpeningMedia(item: {
  sendAsMedia?: boolean;
  expectsOpeningMediaOnSend?: boolean;
  stageIndex?: number;
  replyFlowResponse?: boolean;
  nurtureFollowUp?: boolean;
}): boolean {
  if (item.replyFlowResponse || item.nurtureFollowUp) return false;
  const stage = item.stageIndex ?? 0;
  if (stage !== 0) return false;
  return Boolean(item.sendAsMedia || item.expectsOpeningMediaOnSend);
}
