import type { Response } from 'express';
import type { AuthPrincipal } from './auth/types.js';
import { isUidTreatedAsServerAdmin, readUserSubscriptionForLimits } from './connectionLimits.js';
import { subscriptionEnforceFromEnv, userHasFullAppAccess } from './subscriptionAccess.js';

export const SUBSCRIPTION_REQUIRED_MSG =
  'Plano ativo ou teste válido é necessário. Abra Minha assinatura para assinar o ZapMass Pro e liberar o uso.';

/**
 * Equivalente HTTP do `requireActiveSubscription` do Socket.IO: ações que ENVIAM mensagens
 * (reenvio, retomada, teste de envio) não podem ser chamadas por conta sem plano apenas pulando a UI.
 * Responde 402 `SUBSCRIPTION_REQUIRED` e devolve false quando bloqueado.
 */
export async function requireActiveSubscriptionHttp(
  ctx: { principal: AuthPrincipal; tenantId: string },
  res: Response
): Promise<boolean> {
  try {
    if (!subscriptionEnforceFromEnv()) return true;
    if (await isUidTreatedAsServerAdmin(ctx.principal.authUid)) return true;
    const sub = await readUserSubscriptionForLimits(ctx.tenantId);
    if (userHasFullAppAccess(sub, Date.now())) return true;
  } catch (e) {
    // Falha ao ler assinatura (banco fora): não bloqueia cliente pagante por soluço de infra.
    console.warn('[httpSubscriptionGuard] leitura da assinatura falhou — liberando:', (e as Error)?.message);
    return true;
  }
  res.status(402).json({ ok: false, code: 'SUBSCRIPTION_REQUIRED', error: SUBSCRIPTION_REQUIRED_MSG });
  return false;
}
