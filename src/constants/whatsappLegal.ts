/** Textos informativos — nao substituem assessoria juridica. */

export const WHATSAPP_META_CLOUD_OVERVIEW =
  'https://developers.facebook.com/docs/whatsapp/overview';

export const WHATSAPP_META_CLOUD_GET_STARTED =
  'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started';

export const WHATSAPP_META_POLICY = 'https://www.whatsapp.com/legal/business-policy';

export const WHATSAPP_RISK_VERSION = '2026-04-17';

export const WHATSAPP_RISK_SHORT =
  'O WhatsApp e de propriedade da Meta. Disparos em massa, automacao nao autorizada ou listas sem consentimento podem gerar banimento de numeros, bloqueio de contas e exigencias legais (incluindo LGPD no Brasil). Quem opera o sistema e o conteudo das mensagens e o cliente; o ZapMass e uma ferramenta.';

export const WHATSAPP_RISK_BULLETS: string[] = [
  'Banimento ou limitacao de numeros pela Meta por uso que viole os termos do WhatsApp.',
  'Responsabilidade civil e administrativa por base de contatos, consentimento, opt-out e conteudo (LGPD e legislacao aplicavel).',
  'O modo atual do ZapMass costuma usar sessao/automacao no estilo WhatsApp Web; isso nao e a "API oficial" Cloud API da Meta.',
  'A API oficial Cloud API exige conta Meta Business, numero aprovado, templates para mensagens iniciadas pelo negocio e custos/cotas proprios da Meta.'
];

export const WHATSAPP_OFFICIAL_API_INTRO =
  'Se voce quiser seguir o caminho oficial da Meta (WhatsApp Business Cloud API), pode registrar abaixo os identificadores para quando o ZapMass ou integracoes externas forem configuradas no servidor. O token e dado sensivel: em producao prefira variaveis de ambiente no backend, nao compartilhar tela e nao versionar em Git.';
