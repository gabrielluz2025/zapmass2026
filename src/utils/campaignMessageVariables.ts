import { resolveCampaignSpintax } from '../../shared/campaignSpintax';
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

/** Pré-visualização local no assistente (contato fictício ou amostra do público). */
export type CampaignPreviewSample = {
  nome?: string;
  nome_completo?: string;
  telefone?: string;
  email?: string;
  cidade?: string;
  igreja?: string;
  cargo?: string;
  profissao?: string;
  aniversario?: string;
  conjuge?: string;
  data_bodas?: string;
  anos_casamento?: string;
};

export function applyCampaignMessagePreviewVars(text: string, sample?: CampaignPreviewSample): string {
  const { data, horario, hora, saudacao } = campaignClockVars();
  const s = {
    nome_completo: sample?.nome_completo ?? 'Maria Silva Santos',
    nome: sample?.nome ?? 'Maria',
    telefone: sample?.telefone ?? '(11) 98888-7777',
    email: sample?.email ?? 'maria.exemplo@email.com',
    cidade: sample?.cidade ?? 'Sao Paulo',
    igreja: sample?.igreja ?? 'Igreja Exemplo',
    cargo: sample?.cargo ?? 'Lider de Celula',
    profissao: sample?.profissao ?? 'Engenheira',
    aniversario: sample?.aniversario ?? '15/03/1990',
    conjuge: sample?.conjuge ?? 'Joao Silva',
    data_bodas: sample?.data_bodas ?? '12/06/2018',
    anos_casamento: sample?.anos_casamento ?? '8',
  };
  const withVars = text
    .replace(/\{nome_completo\}/g, s.nome_completo)
    .replace(/\{nome\}/g, s.nome)
    .replace(/\{telefone\}/g, s.telefone)
    .replace(/\{email\}/g, s.email)
    .replace(/\{cidade\}/g, s.cidade)
    .replace(/\{igreja\}/g, s.igreja)
    .replace(/\{cargo\}/g, s.cargo)
    .replace(/\{profissao\}/g, s.profissao)
    .replace(/\{aniversario\}/g, s.aniversario)
    .replace(/\{conjuge\}/g, s.conjuge)
    .replace(/\{data_bodas\}/g, s.data_bodas)
    .replace(/\{anos_casamento\}/g, s.anos_casamento)
    .replace(/\{data\}/g, data)
    .replace(/\{horario\}/g, horario)
    .replace(/\{saudacao\}/g, saudacao)
    .replace(/\{hora\}/g, hora);
  return resolveCampaignSpintax(withVars, 0);
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
