import type { Express, Request, Response } from 'express';
import { getUserSubscription, mergeUserSubscription } from './subscriptionStore.js';
import { getTrialDurationMs } from './appConfigStore.js';
import { notifyAdminsNewClientSignup } from './adminNewSignupNotify.js';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';

export function registerBillingTrialRoutes(app: Express): void {
  app.post('/api/billing/trial/start', async (req: Request, res: Response) => {
    try {
      const token = parseBearer(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
      }
      const principal = await resolveAuthPrincipal(token);
      if (!principal) {
        return res.status(401).json({ ok: false, error: 'Token inválido ou expirado.' });
      }
      if (principal.role === 'staff') {
        return res.status(403).json({
          ok: false,
          error: 'Somente o responsavel pela conta pode iniciar o teste gratuito.'
        });
      }
      const uid = principal.tenantUid;

      const d = await getUserSubscription(uid);

      if (d?.freeTrialUsed) {
        return res.status(400).json({ ok: false, error: 'O teste gratuito desta conta ja foi utilizado.' });
      }

      const now = Date.now();
      const accessEnd =
        d?.accessEndsAt && typeof d.accessEndsAt === 'string'
          ? Date.parse(d.accessEndsAt)
          : typeof (d?.accessEndsAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (d!.accessEndsAt as { toMillis: () => number }).toMillis()
            : null;
      if (d?.status === 'active' && accessEnd != null && accessEnd > now) {
        return res.status(400).json({ ok: false, error: 'Voce ja possui assinatura ativa.' });
      }

      const trialEndMs =
        d?.trialEndsAt && typeof d.trialEndsAt === 'string'
          ? Date.parse(d.trialEndsAt)
          : typeof (d?.trialEndsAt as { toMillis?: () => number })?.toMillis === 'function'
            ? (d!.trialEndsAt as { toMillis: () => number }).toMillis()
            : null;
      if (d?.status === 'trialing' && trialEndMs != null && trialEndMs > now) {
        return res.json({
          ok: true,
          alreadyActive: true,
          trialEndsAt: new Date(trialEndMs).toISOString()
        });
      }

      const trialMs = await getTrialDurationMs();
      const trialEnds = new Date(Date.now() + trialMs);
      const merged = await mergeUserSubscription(uid, {
        status: 'trialing',
        provider: 'none',
        plan: null,
        includedChannels: 1,
        trialEndsAt: trialEnds.toISOString(),
        freeTrialUsed: true,
        extraChannelSlots: 0,
        mercadoPagoChannelAddonPreapprovalId: null as unknown as undefined,
        mercadoPagoChannelAddonOneTimePaymentId: null as unknown as undefined
      });

      if (!merged) {
        return res.status(503).json({ ok: false, error: 'Persistencia de assinatura indisponivel.' });
      }

      void notifyAdminsNewClientSignup({ uid, source: 'trial' }).catch((e) => {
        console.error('[billing/trial/start] notify admins novo cliente', e);
      });

      return res.json({ ok: true, trialEndsAt: trialEnds.toISOString() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[billing/trial/start]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
