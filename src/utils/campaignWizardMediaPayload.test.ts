import { describe, expect, it } from 'vitest';
import { buildCampaignAttachmentPayload } from './campaignWizardMediaPayload';
import type { CampaignAttachmentState } from '../components/campaigns/CampaignAttachmentBlock';

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

  it('retorna undefined quando só persistedOnServer (já na VPS)', async () => {
    const att: CampaignAttachmentState = { persistedOnServer: true, fileName: 'x.jpg' };
    expect(await buildCampaignAttachmentPayload(att)).toBeUndefined();
  });
});
