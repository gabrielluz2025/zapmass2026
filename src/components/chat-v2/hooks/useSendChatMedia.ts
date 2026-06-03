import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { prepareCampaignAttachmentForSend } from '../../../utils/campaignMediaCompress';

type SendMediaFn = (
  conversationId: string,
  payload: {
    dataBase64: string;
    mimeType: string;
    fileName: string;
    caption?: string;
    sendMediaAsDocument?: boolean;
  }
) => Promise<{ ok: boolean; error?: string }>;

export function useSendChatMedia(sendMedia: SendMediaFn) {
  const [sending, setSending] = useState(false);

  const sendFile = useCallback(
    async (conversationId: string, file: File, caption?: string) => {
      if (!conversationId) return;
      setSending(true);
      try {
        const prep = await prepareCampaignAttachmentForSend(file);
        for (const h of prep.hints) toast(h, { duration: 5000 });
        const fileToSend = prep.file;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
          reader.readAsDataURL(fileToSend);
        });
        const commaIdx = dataUrl.indexOf(',');
        const dataBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
        const mimeType = fileToSend.type || 'application/octet-stream';
        if (!dataBase64) throw new Error('Não foi possível processar o arquivo.');
        const resp = await sendMedia(conversationId, {
          dataBase64,
          mimeType,
          fileName: fileToSend.name || 'arquivo',
          caption: caption?.trim() || undefined,
          sendMediaAsDocument: prep.sendMediaAsDocument
        });
        if (!resp.ok) throw new Error(resp.error || 'Falha ao enviar arquivo.');
        toast.success('Arquivo enviado', { duration: 2500 });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Falha ao enviar arquivo.';
        toast.error(msg, { duration: 7000 });
      } finally {
        setSending(false);
      }
    },
    [sendMedia]
  );

  return { sending, sendFile };
}
