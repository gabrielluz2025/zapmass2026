import type { CampaignReplyFlowStep } from '../types';

export type ReplyFlowPreviewItemKind = 'out' | 'in' | 'gate';

export type ReplyFlowPreviewItem = {
  text: string;
  kind: ReplyFlowPreviewItemKind;
  meta?: string;
  stepLabel?: string;
};

type LooseOption = {
  tokens?: string[];
  tokensText?: string;
  reply?: string;
};

/** Remove gatilhos repetidos (ex.: quero/quero/quero) preservando ordem e capitalização do primeiro. */
export function dedupeReplyFlowPreviewTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function tokensFromReplyFlowOption(opt: LooseOption): string[] {
  if (Array.isArray(opt.tokens) && opt.tokens.length > 0) {
    return opt.tokens.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof opt.tokensText === 'string' && opt.tokensText.trim()) {
    return opt.tokensText
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function formatReplyFlowOptionTrigger(opt: LooseOption, optionIndex: number): string {
  const deduped = dedupeReplyFlowPreviewTokens(tokensFromReplyFlowOption(opt));
  if (deduped.length === 0) return String(optionIndex + 1);
  return deduped.join(' / ');
}

function menuOptionsFromStep(step: CampaignReplyFlowStep): LooseOption[] {
  const raw = (step as { options?: LooseOption[] }).options;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw;
}

function normalizeFlowTextForCompare(text: string): string {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export const REPLY_FLOW_PREVIEW_EMPTY_REPLY = '(sem texto)';

/**
 * Texto exibido na bolha de saída após escolha de menu (alinha com resolveReplyFlowOptionOutbound no servidor).
 */
export function resolveMenuOptionPreviewReply(
  gateStep: CampaignReplyFlowStep,
  option: LooseOption,
  stepIndex: number,
  steps: CampaignReplyFlowStep[]
): string {
  const openingComparable = normalizeFlowTextForCompare(gateStep.body);
  let replyBody = String(option.reply ?? '').trim();
  const nextIdx = stepIndex + 1;
  const nextStep = nextIdx < steps.length ? steps[nextIdx] : undefined;
  const nextBody = nextStep ? String(nextStep.body ?? '').trim() : '';

  const replyLooksLikeOpening =
    !replyBody || normalizeFlowTextForCompare(replyBody) === openingComparable;

  if (nextBody && replyLooksLikeOpening) {
    return nextBody;
  }

  return replyBody;
}

/**
 * Sequência de prévia do fluxo por resposta (detalhes da campanha / aba Fluxo).
 */
export function buildReplyFlowPreviewSequence(steps: CampaignReplyFlowStep[]): ReplyFlowPreviewItem[] {
  const out: ReplyFlowPreviewItem[] = [];

  steps.forEach((step, idx) => {
    out.push({
      text: step.body,
      kind: 'out',
      stepLabel: `Etapa ${idx + 1}`,
      meta: idx === 0 ? 'Enviada ao iniciar' : 'Enviada após resposta'
    });

    const menuOptions = menuOptionsFromStep(step);

    if (menuOptions.length > 0) {
      menuOptions.forEach((opt, oIdx) => {
        out.push({
          text: formatReplyFlowOptionTrigger(opt, oIdx),
          kind: 'in',
          meta: `Opção ${oIdx + 1}`
        });
        const reply = resolveMenuOptionPreviewReply(step, opt, idx, steps);
        out.push({
          text: reply.trim() ? reply : REPLY_FLOW_PREVIEW_EMPTY_REPLY,
          kind: 'out',
          stepLabel: `Resposta ${oIdx + 1}`,
          meta: 'Enviada após escolha'
        });
      });
      if (idx < steps.length - 1) {
        out.push({ text: '', kind: 'gate', meta: 'Continua após próxima resposta' });
      }
    } else if (idx < steps.length - 1) {
      const gate = step.acceptAnyReply
        ? 'qualquer resposta'
        : dedupeReplyFlowPreviewTokens(step.validTokens || []).join(' / ') || 'resposta válida';
      out.push({
        text: '',
        kind: 'gate',
        meta: `Aguardando: ${gate}`
      });
    }
  });

  return out;
}

/** Bolhas de uma única etapa (mensagem + gatilhos + respostas por opção). */
export function buildReplyFlowStagePreviewItems(
  steps: CampaignReplyFlowStep[],
  stageIndex: number
): ReplyFlowPreviewItem[] {
  const step = steps[stageIndex];
  if (!step) return [];

  const out: ReplyFlowPreviewItem[] = [
    {
      text: step.body,
      kind: 'out',
      stepLabel: `Etapa ${stageIndex + 1}`,
      meta: stageIndex === 0 ? 'Enviada ao iniciar' : 'Enviada após resposta'
    }
  ];

  const menuOptions = menuOptionsFromStep(step);
  menuOptions.forEach((opt, oIdx) => {
    out.push({
      text: formatReplyFlowOptionTrigger(opt, oIdx),
      kind: 'in',
      meta: `Opção ${oIdx + 1}`
    });
    const reply = resolveMenuOptionPreviewReply(step, opt, stageIndex, steps);
    out.push({
      text: reply.trim() ? reply : REPLY_FLOW_PREVIEW_EMPTY_REPLY,
      kind: 'out',
      stepLabel: `Resposta ${oIdx + 1}`,
      meta: 'Enviada após escolha'
    });
  });

  return out;
}
