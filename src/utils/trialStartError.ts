const IGNORABLE_TRIAL_ERRORS = new Set([
  'Voce ja possui assinatura ativa.',
  'Seu teste gratuito ainda esta em andamento.'
]);

/** Erros que indicam trial já activo ou conta já coberta — não devem alarmar o utilizador. */
export function isIgnorableTrialStartError(raw: unknown): boolean {
  const msg = typeof raw === 'string' ? raw.trim() : '';
  return IGNORABLE_TRIAL_ERRORS.has(msg);
}

/** Mensagem amigável para falhas ao ativar teste (API /api/billing/trial/start). */
export function formatTrialStartError(raw: unknown, httpStatus?: number): string {
  const msg = typeof raw === 'string' ? raw.trim() : '';
  if (httpStatus === 503 || msg.includes('Firebase Admin')) {
    return 'Servidor ainda a configurar contas novas. Aguarde 1–2 minutos e recarregue a página.';
  }
  if (httpStatus === 401 || msg.includes('Token Firebase')) {
    return 'Sessão expirada. Saia, entre de novo e clique em «Começar teste grátis».';
  }
  if (msg === 'O teste gratuito desta conta ja foi utilizado.') {
    return 'Este e-mail já usou o teste de 1 hora. Assine o Pro para continuar a usar o sistema.';
  }
  if (msg === 'Seu teste gratuito ainda esta em andamento.') {
    return 'O teste já está activo — aguarde alguns segundos ou recarregue a página.';
  }
  if (msg.includes('responsavel') || msg.includes('responsável') || httpStatus === 403) {
    return msg || 'Só o responsável pela conta pode iniciar o teste gratuito.';
  }
  if (msg) return msg;
  if (httpStatus === 0 || httpStatus === undefined) {
    return 'Sem ligação ao servidor. Verifique a internet e tente de novo.';
  }
  return 'Não foi possível iniciar o teste. Tente de novo em instantes.';
}
