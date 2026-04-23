/**
 * Envio de email transacional via Resend (https://resend.com).
 *
 * Config por env (todos opcionais; se ausentes, o servico apenas loga e retorna):
 *   RESEND_API_KEY   - chave (re_...) obtida no painel do Resend.
 *   EMAIL_FROM       - remetente. Ex.: "ZapMass <no-reply@zap-mass.com>".
 *                      Para usar dominio proprio, faz DNS verification no Resend.
 *                      Fallback: "ZapMass <onboarding@resend.dev>" (so teste).
 *   EMAIL_REPLY_TO   - email para onde o cliente responde (ex.: suporte@zap-mass.com).
 *
 * Uso: `await sendPaymentConfirmationEmail({ ... })`.
 * O erro de envio nao quebra o webhook (log + retorna false).
 */

interface PaymentConfirmationParams {
  to: string;
  /** Nome do cliente (de MP payer.first_name + last_name). Opcional. */
  name?: string;
  plan: 'monthly' | 'annual';
  /** Metodo: pix | card | recurring (debito auto). */
  method: 'pix' | 'card' | 'recurring' | string;
  /** Valor em R$ (numero, ex.: 199.90). */
  amount: number;
  /** Data do fim do periodo pago (ISO string). */
  accessEndsAt: Date | null;
  /** URL para a pagina "Minha assinatura". */
  subscriptionUrl: string;
  /** True se NFS-e sera emitida (NFE.io ativo). */
  nfeEnabled: boolean;
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDatePtBR(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function planLabel(plan: string): string {
  return plan === 'annual' ? 'Anual (12 meses)' : 'Mensal (30 dias)';
}

function methodLabel(method: string): string {
  if (method === 'pix') return 'Pix';
  if (method === 'recurring') return 'Débito automático (cartão)';
  if (method === 'card') return 'Cartão de crédito';
  return method;
}

function buildHtml(p: PaymentConfirmationParams): string {
  const amountStr = formatBRL(p.amount);
  const expires = formatDatePtBR(p.accessEndsAt);
  const greeting = p.name ? `Olá, ${p.name.split(' ')[0]}!` : 'Olá!';
  const isRecurring = p.method === 'recurring';

  const renewalBlock = isRecurring
    ? `<p style="margin:0 0 16px;color:#4b5563;line-height:1.55;font-size:15px">
        Seu cartão será cobrado automaticamente no próximo ciclo.
        Você pode cancelar o débito automático a qualquer momento na página
        <a href="${p.subscriptionUrl}" style="color:#059669;text-decoration:none;font-weight:600">Minha assinatura</a>.
       </p>`
    : `<p style="margin:0 0 16px;color:#4b5563;line-height:1.55;font-size:15px">
        Este é um pagamento único. Antes da expiração acima, enviaremos um lembrete
        para você renovar. Renove a qualquer momento em
        <a href="${p.subscriptionUrl}" style="color:#059669;text-decoration:none;font-weight:600">Minha assinatura</a>.
       </p>`;

  const nfeBlock = p.nfeEnabled
    ? `<p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">
         <strong style="color:#374151">Nota fiscal:</strong> será emitida automaticamente em até 2 dias úteis e enviada para este email.
       </p>`
    : `<p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5">
         <strong style="color:#374151">Nota fiscal:</strong> se precisar de nota fiscal para declaração,
         responda a este email com o nome completo/razão social, CPF/CNPJ e endereço que enviaremos em seguida.
       </p>`;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pagamento confirmado — ZapMass</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px">
      <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.06)">
        <div style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:28px 24px;text-align:center">
          <div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:14px;line-height:56px;text-align:center;color:#fff;font-size:30px;font-weight:700">✓</div>
          <h1 style="margin:14px 0 4px;color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.02em">Pagamento confirmado</h1>
          <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px">Seu acesso Pro já está liberado</p>
        </div>

        <div style="padding:28px 24px">
          <p style="margin:0 0 16px;color:#111827;font-size:17px;font-weight:600">${greeting}</p>
          <p style="margin:0 0 20px;color:#4b5563;line-height:1.55;font-size:15px">
            Recebemos seu pagamento da assinatura <strong>ZapMass Pro</strong>. Abaixo os detalhes:
          </p>

          <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em">Plano</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right">${planLabel(p.plan)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em">Valor</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right">${amountStr}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em">Método</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right">${methodLabel(p.method)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em">Acesso válido até</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#059669;font-size:14px;font-weight:700;text-align:right">${expires}</td>
            </tr>
          </table>

          ${renewalBlock}

          <div style="text-align:center;margin:24px 0 8px">
            <a href="${p.subscriptionUrl}" style="display:inline-block;background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(16,185,129,0.25)">
              Abrir ZapMass
            </a>
          </div>
        </div>

        <div style="padding:18px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
          ${nfeBlock}
        </div>
      </div>

      <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.55">
        Este email foi enviado porque você assinou o ZapMass Pro.<br/>
        Em caso de dúvidas, responda a este email.
      </p>
    </div>
  </body>
</html>`;
}

export async function sendPaymentConfirmationEmail(params: PaymentConfirmationParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.log('[EmailService] RESEND_API_KEY nao configurada - email nao enviado para', params.to);
    return false;
  }

  const from = (process.env.EMAIL_FROM || 'ZapMass <onboarding@resend.dev>').trim();
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();

  const subject =
    params.method === 'recurring'
      ? 'Débito automático autorizado — ZapMass Pro ativo'
      : 'Pagamento confirmado — ZapMass Pro ativo';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject,
        html: buildHtml(params),
        reply_to: replyTo || undefined
      })
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[EmailService] Resend', res.status, text);
      return false;
    }
    console.log('[EmailService] Email enviado para', params.to, '(plano:', params.plan, ')');
    return true;
  } catch (e) {
    console.error('[EmailService] Erro ao enviar:', e);
    return false;
  }
}
