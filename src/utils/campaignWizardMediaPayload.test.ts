import { describe, expect, it, vi } from 'vitest';
import { buildCampaignAttachmentPayload } from './campaignWizardMediaPayload';
import type { CampaignAttachmentState } from '../components/campaigns/CampaignAttachmentBlock';

vi.mock('../services/campaignsApi', () => ({
  fetchCampaignMediaAttachments: vi.fn(async () => ({
    mediaAttachment: {
      dataBase64: 'aGVsbG8=',
      mimeType: 'image/jpeg',
      fileName: 'disk.jpg',
    },
  })),
}));

describe('buildCampaignAttachmentPayload', () => {
  it('usa mediaPayload pronto sem reler File', async () => {
    const att: CampaignAttachmentState = {
      mediaPayload: {
        dataBase64: 'aGVsbG8=',
        mimeType: 'image/jpeg',
        fileName: 'foto.jpg',
      },
    };
    const out = await buildCampaignAttachmentPayload(att);
    expect(out?.dataBase64).toBe('aGVsbG8=');
    expect(out?.mimeType).toBe('image/jpeg');
  });

  it('retorna undefined quando só persistedOnServer sem campaignId', async () => {
    const att: CampaignAttachmentState = { persistedOnServer: true, fileName: 'x.jpg' };
    expect(await buildCampaignAttachmentPayload(att)).toBeUndefined();
  });

  it('busca anexo na VPS quando persistedOnServer e campaignId', async () => {
    const att: CampaignAttachmentState = { persistedOnServer: true, fileName: 'x.jpg' };
    const out = await buildCampaignAttachmentPayload(att, { campaignId: 'camp-1' });
    expect(out?.dataBase64).toBe('aGVsbG8=');
    expect(out?.fileName).toBe('disk.jpg');
  });
});
