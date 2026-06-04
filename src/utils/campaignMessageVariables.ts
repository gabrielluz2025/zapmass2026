import { campaignClockVars } from './campaignClockVars';

/** Variáveis inseríveis no texto de campanha (substituição no servidor via `applyMessageVars`). */
export const WIZARD_CAMPAIGN_VARS_PRIMARY: string[] = [
  '{nome}',
  '{telefone}',
  '{cidade}',
  '{igreja}',
  '{cargo}',
  '{profissao}',
  '{data}',
  '{horario}',
  '{hora}'
];

export const WIZARD_CAMPAIGN_VARS_FICHA: string[] = [
  '{nome_completo}',
  '{email}',
  '{aniversario}',
  '{conjuge}',
  '{data_bodas}',
  '{anos_casamento}'
];

/** Pré-visualização local no assistente (contato fictício + relógio de Brasília agora para data/hora/saudação). */
export function applyCampaignMessagePreviewVars(text: string): string {
  const { data, horario, hora, saudacao } = campaignClockVars();
  return text
    .replace(/\{nome_completo\}/g, 'Maria Silva Santos')
    .replace(/\{nome\}/g, 'Maria')
    .replace(/\{telefone\}/g, '(11) 98888-7777')
    .replace(/\{email\}/g, 'maria.exemplo@email.com')
    .replace(/\{cidade\}/g, 'Sao Paulo')
    .replace(/\{igreja\}/g, 'Igreja Exemplo')
    .replace(/\{cargo\}/g, 'Lider de Celula')
    .replace(/\{profissao\}/g, 'Engenheira')
    .replace(/\{aniversario\}/g, '15/03/1990')
    .replace(/\{conjuge\}/g, 'Joao Silva')
    .replace(/\{data_bodas\}/g, '12/06/2018')
    .replace(/\{anos_casamento\}/g, '8')
    .replace(/\{data\}/g, data)
    .replace(/\{horario\}/g, horario)
    .replace(/\{saudacao\}/g, saudacao)
    .replace(/\{hora\}/g, hora);
}

export function insertCampaignTokenIntoTextarea(
  el: HTMLTextAreaElement | null,
  currentText: string,
  token: string,
  applyNewText: (next: string) => void
): void {
  if (!el) return;
  const startRaw = el.selectionStart;
  const endRaw = el.selectionEnd;
  const start = typeof startRaw === 'number' ? startRaw : currentText.length;
  const end = typeof endRaw === 'number' ? endRaw : currentText.length;
  const safeStart = Math.max(0, Math.min(start, currentText.length));
  const safeEnd = Math.max(safeStart, Math.min(end, currentText.length));
  const newMsg = currentText.slice(0, safeStart) + token + currentText.slice(safeEnd);
  applyNewText(newMsg);
  const pos = safeStart + token.length;
  requestAnimationFrame(() => {
    el.focus();
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* ignore */
    }
  });
}
