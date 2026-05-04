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

// ============================================================================
// Sugestões de melhoria — notificação por email para o(s) criador(es)
// ============================================================================

interface SuggestionNotificationParams {
  /** Email do usuário que enviou a sugestão (pode ser vazio). */
  suggesterEmail: string;
  /** UID Firebase do remetente. */
  suggesterUid: string;
  /** Texto livre da sugestão (já trimmed). */
  text: string;
  /** Tela/área onde estava (slug interno, ex.: "campaigns"). */
  screen: string;
  /** Categoria escolhida ('usability' | 'campaigns' | 'reports' | 'integrations' | 'other'). */
  category: string;
  /** Data ISO em que a sugestão foi recebida. */
  createdAt: Date;
  /** URL para abrir o painel admin de sugestões (opcional). */
  adminPanelUrl?: string;
}

const CATEGORY_PT: Record<string, string> = {
  usability: 'Telas / usabilidade',
  campaigns: 'Campanhas e envios',
  reports: 'Relatórios e números',
  integrations: 'Conexões e canais',
  other: 'Outro tema'
};

const SCREEN_PT: Record<string, string> = {
  connections: 'Conexões WhatsApp',
  dashboard: 'Painel',
  chat: 'Chat',
  warmup: 'Aquecimento',
  campaigns: 'Campanhas',
  contacts: 'Contatos',
  reports: 'Relatórios',
  settings: 'Definições',
  subscription: 'Assinatura',
  help: 'Ajuda',
  team: 'Equipa',
  admin: 'Administrador',
  'creator-studio': 'Criador',
  'admin-ops': 'Operações servidor',
  'religious-members': 'Ficha de membro (igreja)'
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSuggestionHtml(p: SuggestionNotificationParams): string {
  const dateStr = p.createdAt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const categoryLabel = CATEGORY_PT[p.category] || p.category || '—';
  const screenLabel = p.screen ? SCREEN_PT[p.screen] || p.screen : '—';
  const fromLabel = p.suggesterEmail || `(sem email — uid ${p.suggesterUid.slice(0, 8)}…)`;
  const textHtml = escapeHtml(p.text).replace(/\n/g, '<br/>');
  const ctaUrl = p.adminPanelUrl || '';

  const cta = ctaUrl
    ? `<div style="text-align:center;margin:24px 0 8px">
         <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b 0%,#ea580c 100%);color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(245,158,11,0.25)">
           Ver no painel do criador
         </a>
       </div>`
    : '';

  return `
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nova sugestão — ZapMass</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <div style="max-width:580px;margin:0 auto;padding:32px 16px">
      <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.06)">
        <div style="background:linear-gradient(135deg,#f59e0b 0%,#ea580c 100%);padding:28px 24px;text-align:center">
          <div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,0.22);border-radius:14px;line-height:56px;text-align:center;color:#fff;font-size:30px">💡</div>
          <h1 style="margin:14px 0 4px;color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.02em">Nova sugestão recebida</h1>
          <p style="margin:0;color:rgba(255,255,255,0.92);font-size:14px">Um cliente compartilhou uma ideia sobre o ZapMass</p>
        </div>

        <div style="padding:28px 24px">
          <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;width:38%">De</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right;word-break:break-all">${escapeHtml(fromLabel)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em">Tema</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right">${escapeHtml(categoryLabel)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em">Tela atual</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right">${escapeHtml(screenLabel)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em">Recebida em</td>
              <td style="padding:10px 0;border-top:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right">${escapeHtml(dateStr)}</td>
            </tr>
          </table>

          <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:16px 18px;margin:0 0 8px">
            <p style="margin:0 0 8px;color:#92400e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Mensagem</p>
            <p style="margin:0;color:#1f2937;font-size:14.5px;line-height:1.6;white-space:pre-wrap">${textHtml}</p>
          </div>

          ${cta}
        </div>

        <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
          <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5">
            <strong style="color:#374151">Responder ao cliente:</strong>
            ${
              p.suggesterEmail
                ? `basta dar Reply neste email${p.suggesterEmail ? ` ou escrever para <a href="mailto:${escapeHtml(p.suggesterEmail)}" style="color:#ea580c;text-decoration:none;font-weight:600">${escapeHtml(p.suggesterEmail)}</a>` : ''}.`
                : 'o usuário enviou sem email vinculado — visível só pelo UID no painel.'
            }
          </p>
        </div>
      </div>

      <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.55">
        Notificação automática do botão «Ideias / Sugestões» do ZapMass.<br/>
        Para parar de receber estes emails, remova seu endereço de <code>ADMIN_EMAILS</code> ou de <code>SUGGESTION_NOTIFY_EMAIL</code>.
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Envia notificação de nova sugestão para os criadores/admins.
 *
 * Destino:
 *   1) `SUGGESTION_NOTIFY_EMAIL` (lista separada por vírgula) se existir;
 *   2) caso contrário, todos os endereços listados em `ADMIN_EMAILS`.
 *
 * Nunca lança — apenas loga e devolve `false` se algo falhar, para não quebrar
 * o POST de sugestão nem a experiência do usuário final.
 */
export async function sendSuggestionNotificationEmail(
  params: SuggestionNotificationParams
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.log('[EmailService] sugestão recebida mas RESEND_API_KEY ausente — notificação por email pulada');
    return false;
  }

  const explicit = (process.env.SUGGESTION_NOTIFY_EMAIL || '').trim();
  const adminList = (process.env.ADMIN_EMAILS || '').trim();
  const raw = explicit.length > 0 ? explicit : adminList;

  const recipients = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /@/.test(s));

  if (recipients.length === 0) {
    console.log(
      '[EmailService] sugestão recebida mas SUGGESTION_NOTIFY_EMAIL/ADMIN_EMAILS vazios — notificação pulada'
    );
    return false;
  }

  const from = (process.env.EMAIL_FROM || 'ZapMass <onboarding@resend.dev>').trim();

  const categoryLabel = CATEGORY_PT[params.category] || params.category || 'sugestão';
  const subject = `💡 Nova sugestão (${categoryLabel}) — ${
    params.suggesterEmail || params.suggesterUid.slice(0, 8)
  }`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html: buildSuggestionHtml(params),
        // Reply-To: o email do próprio cliente, para responder direto.
        reply_to: params.suggesterEmail || undefined
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[EmailService] sugestão Resend', res.status, text);
      return false;
    }
    console.log(
      '[EmailService] notificação de sugestão enviada para',
      recipients.join(','),
      '(de:',
      params.suggesterEmail || params.suggesterUid,
      ')'
    );
    return true;
  } catch (e) {
    console.error('[EmailService] erro ao enviar notificação de sugestão:', e);
    return false;
  }
}

// ============================================================================
// Resposta do criador a uma sugestão (envia email para o cliente)
// ============================================================================

interface SuggestionReplyParams {
  /** Email do cliente (destinatário). */
  to: string;
  /** Nome amigável do cliente (vem antes do "@", se não houver outro). */
  toName?: string;
  /** Mensagem original que o cliente enviou. */
  originalText: string;
  /** Categoria/tema escolhido pelo cliente. */
  originalCategory: string;
  /** Tela/área onde estava. */
  originalScreen: string;
  /** Quando o cliente enviou a sugestão. */
  originalCreatedAt: Date | null;
  /** Texto da resposta digitada pelo criador. */
  replyText: string;
  /** Email do admin/criador (vai como Reply-To para o cliente responder). */
  fromAdminEmail: string;
}

function buildSuggestionReplyHtml(p: SuggestionReplyParams): string {
  const greetingName =
    (p.toName && p.toName.trim()) ||
    (p.to ? p.to.split('@')[0].split(/[._-]/)[0] : '');
  const greeting = greetingName ? `Olá, ${escapeHtml(greetingName)}!` : 'Olá!';
  const originalDate = p.originalCreatedAt
    ? p.originalCreatedAt.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';
  const categoryLabel = CATEGORY_PT[p.originalCategory] || p.originalCategory || '';
  const screenLabel = p.originalScreen ? SCREEN_PT[p.originalScreen] || p.originalScreen : '';
  const originalHtml = escapeHtml(p.originalText).replace(/\n/g, '<br/>');
  const replyHtml = escapeHtml(p.replyText).replace(/\n/g, '<br/>');

  const contextLine = [originalDate, categoryLabel, screenLabel]
    .filter((x) => x && x.length > 0)
    .map((x) => escapeHtml(x))
    .join(' · ');

  return `
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Resposta à sua sugestão — ZapMass</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <div style="max-width:580px;margin:0 auto;padding:32px 16px">
      <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.06)">
        <div style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:26px 24px;text-align:center">
          <div style="display:inline-block;width:52px;height:52px;background:rgba(255,255,255,0.22);border-radius:14px;line-height:52px;text-align:center;color:#fff;font-size:26px">💬</div>
          <h1 style="margin:14px 0 4px;color:#fff;font-size:21px;font-weight:800;letter-spacing:-0.02em">A equipa do ZapMass respondeu</h1>
          <p style="margin:0;color:rgba(255,255,255,0.92);font-size:13.5px">Sobre a ideia que você compartilhou conosco</p>
        </div>

        <div style="padding:26px 24px">
          <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:600">${greeting}</p>
          <p style="margin:0 0 18px;color:#4b5563;line-height:1.55;font-size:14.5px">
            Obrigado por nos enviar a sua sugestão. Aqui está o que queremos te dizer:
          </p>

          <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px 18px;margin:0 0 22px">
            <p style="margin:0 0 6px;color:#065f46;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Resposta da equipa</p>
            <p style="margin:0;color:#064e3b;font-size:15px;line-height:1.65;white-space:pre-wrap">${replyHtml}</p>
          </div>

          <details style="margin:0 0 12px">
            <summary style="cursor:pointer;color:#6b7280;font-size:12.5px;font-weight:600;padding:8px 10px;border-radius:8px;background:#f9fafb;list-style:none">
              Ver a sugestão original
            </summary>
            <div style="margin-top:8px;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px">
              ${contextLine ? `<p style="margin:0 0 6px;color:#9ca3af;font-size:11px">${contextLine}</p>` : ''}
              <p style="margin:0;color:#374151;font-size:13.5px;line-height:1.55;white-space:pre-wrap">${originalHtml}</p>
            </div>
          </details>
        </div>

        <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
          <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.55">
            <strong style="color:#374151">Quer continuar a conversa?</strong> Basta responder a este email — vai chegar direto na nossa equipa.
          </p>
        </div>
      </div>

      <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.55">
        Recebeste este email porque enviaste uma sugestão pelo botão «Ideias / Sugestão» dentro do ZapMass.
      </p>
    </div>
  </body>
</html>`;
}

export type ResendSendResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Envia a resposta do criador/admin para o cliente que enviou a sugestão.
 * Reply-To é o email do admin, para que a resposta do cliente caia direto nele.
 *
 * Devolve motivo legível quando falha (API Resend, chave ausente, etc.).
 */
export async function sendSuggestionReplyEmail(params: SuggestionReplyParams): Promise<ResendSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    const msg =
      'RESEND_API_KEY não está definida no servidor — adicione no .env do Node/Docker e reinicie.';
    console.log('[EmailService]', msg);
    return { ok: false, reason: msg };
  }
  if (!params.to || !/@/.test(params.to)) {
    const msg = 'Sugestão sem email do cliente cadastrado.';
    console.log('[EmailService]', msg);
    return { ok: false, reason: msg };
  }

  const from = (process.env.EMAIL_FROM || 'ZapMass <onboarding@resend.dev>').trim();
  const subject = '💬 Resposta sobre a sua sugestão no ZapMass';

  const parseResendErrorBody = (raw: string): string => {
    const trimmed = raw.trim().slice(0, 600);
    if (!trimmed) return '(corpo vazio)';
    try {
      const j = JSON.parse(trimmed) as { message?: unknown; error?: unknown };
      const m =
        (typeof j.message === 'string' && j.message) ||
        (typeof j.error === 'string' && j.error) ||
        (j.error && typeof j.error === 'object' && typeof (j.error as { message?: string }).message === 'string'
          ? (j.error as { message: string }).message
          : '');
      if (m) return m.slice(0, 500);
    } catch {
      /* ignore */
    }
    return trimmed;
  };

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
        html: buildSuggestionReplyHtml(params),
        reply_to: params.fromAdminEmail || process.env.EMAIL_REPLY_TO || undefined
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = parseResendErrorBody(text);
      const useTestFrom = /onboarding@resend\.dev/i.test(from);
      const testHint = useTestFrom
        ? ' Dica: com onboarding@resend.dev a Resend só entrega para o email da conta que criou a API key; para qualquer cliente use um domínio verificado em EMAIL_FROM.'
        : '';
      console.error('[EmailService] resposta de sugestão Resend', res.status, detail);
      return {
        ok: false,
        reason: `Resend (${res.status}): ${detail}.${testHint}`
      };
    }
    console.log('[EmailService] resposta de sugestão enviada para', params.to);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[EmailService] erro ao enviar resposta de sugestão:', e);
    return { ok: false, reason: `Rede/Erro: ${msg.slice(0, 280)}` };
  }
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
