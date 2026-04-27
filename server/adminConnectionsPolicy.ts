import type { WhatsAppConnection } from './types.js';
import { ConnectionStatus } from './types.js';

/**
 * Só permitir forçar remoção (QR ainda) para canais que **nunca** vincularam
 * um número — ou o fluxo inicial de QR, não sessões pós-WhatsApp (reconexão, caída, suspensa).
 */
export function isAdminForceRemoveAllowed(c: WhatsAppConnection): boolean {
  const phone = c.phoneNumber && String(c.phoneNumber).trim();
  if (c.status === ConnectionStatus.CONNECTED) return false;
  if (c.status === ConnectionStatus.SUSPENDED) return false;
  if (c.status === ConnectionStatus.BUSY) return false;
  if (phone) return false;
  if (c.status === ConnectionStatus.DISCONNECTED) return true;
  if (c.status === ConnectionStatus.QR_READY) return true;
  if (c.status === ConnectionStatus.CONNECTING) {
    const la = c.lastActivity || '';
    if (/reconect|reconnect|re-conn|reconecta/i.test(la)) return false;
    if (/autenticad/i.test(la)) return false;
    return true;
  }
  return false;
}

export function explainAdminForceRemoveBlock(c: WhatsAppConnection): string {
  if (isAdminForceRemoveAllowed(c)) return '';
  if (c.status === ConnectionStatus.CONNECTED) {
    return 'Ligada ao WhatsApp (use a app do utilizador para sair/gerir).';
  }
  if (c.status === ConnectionStatus.SUSPENDED) {
    return 'Sessão suspensa; recuperar pelo app do utilizador, não forçar daqui.';
  }
  if (c.status === ConnectionStatus.BUSY) {
    return 'Canal em uso; aguardar ou gerir no app do utilizador.';
  }
  if (c.phoneNumber && String(c.phoneNumber).trim()) {
    return 'Já vinculou a um nº (sessão caiu ou a reconectar). Não forçar remoção por aqui.';
  }
  if (c.status === ConnectionStatus.CONNECTING) {
    if (/reconect|reconnect|re-conn|reconecta/i.test(c.lastActivity || '')) {
      return 'Reconexão de sessão existente; não forçar daqui.';
    }
    if (/autenticad/i.test(c.lastActivity || '')) {
      return 'A autenticar após QR; não interromper por aqui.';
    }
  }
  return 'Não é possível interromper esta sessão a partir do painel global.';
}
