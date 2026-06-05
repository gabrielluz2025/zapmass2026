import React, { useMemo } from 'react';
import { Award, Info } from 'lucide-react';
import { funnelPct } from '../../utils/campaignFunnelMetrics';
import {
  computeCampaignScore,
  SCORE_SOFT_SPEED_CONTACT_CAP,
  SCORE_TARGET_THROUGHPUT_PER_MIN,
  type ScoreInputs
} from '../../utils/campaignScoreMetrics';

export type { ScoreInputs };

const W_DELIVERY = 0.3;
const W_READ = 0.3;
const W_REPLY = 0.25;
const W_SPEED = 0.15;

interface CampaignScoreCardProps {
  inputs: ScoreInputs;
}

export const CampaignScoreCard: React.FC<CampaignScoreCardProps> = ({ inputs }) => {
  const { score, breakdown, label, tone, sentBase, softSpeedNote } = useMemo(() => {
    const sentBase = Math.max(0, inputs.sent);
    const hasSends = sentBase > 0;
    const computed = computeCampaignScore(inputs);
    const s = computed.score;
    const speedPct = computed.speedPct;
    const scoreDelivery = computed.scoreDelivery;
    const scoreRead = computed.scoreRead;
    const scoreReply = computed.scoreReply;
    const scoreSpeed = computed.scoreSpeed;

    const contactCap = Math.max(sentBase, inputs.plannedContacts || 0);
    const softSpeedNote =
      inputs.replyFlowMode &&
      contactCap > 0 &&
      contactCap <= SCORE_SOFT_SPEED_CONTACT_CAP &&
      inputs.replied > 0;

    const breakdown = [
      {
        key: 'delivery',
        label: 'Entrega',
        value: Math.round(scoreDelivery),
        max: Math.round(W_DELIVERY * 100),
        color: '#3b82f6',
        pct: funnelPct(inputs.delivered, sentBase),
        count: inputs.delivered,
        base: sentBase
      },
      {
        key: 'read',
        label: 'Leitura',
        value: Math.round(scoreRead),
        max: Math.round(W_READ * 100),
        color: '#8b5cf6',
        pct: funnelPct(inputs.read, sentBase),
        count: inputs.read,
        base: sentBase
      },
      {
        key: 'reply',
        label: 'Resposta',
        value: Math.round(scoreReply),
        max: Math.round(W_REPLY * 100),
        color: '#10b981',
        pct: funnelPct(inputs.replied, sentBase),
        count: inputs.replied,
        base: sentBase
      },
      {
        key: 'speed',
        label: 'Velocidade',
        value: Math.round(scoreSpeed),
        max: Math.round(W_SPEED * 100),
        color: '#f59e0b',
        pct: Math.round(speedPct * 100),
        count: null as number | null,
        base: null as number | null
      }
    ];

    let label = 'Precisa ajustar';
    let tone = '#ef4444';
    if (!hasSends) {
      label = 'Sem envios';
      tone = 'var(--text-3)';
    } else if (s >= 80) {
      label = 'Excelente';
      tone = '#10b981';
    } else if (s >= 65) {
      label = 'Muito bom';
      tone = '#3b82f6';
    } else if (s >= 45) {
      label = 'Aceitável';
      tone = '#f59e0b';
    }

    return { score: s, breakdown, label, tone, sentBase, softSpeedNote };
  }, [inputs]);

  const size = 170;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className="rounded-2xl p-5 relative overflow-hidden h-full"
      style={{
        background: 'var(--surface-0)',
        border: `1px solid ${tone}33`
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          background: `radial-gradient(300px 120px at 100% 0%, ${tone}1a, transparent 70%)`
        }}
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p
              className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] flex items-center gap-1"
              style={{ color: 'var(--text-3)' }}
            >
              <Award className="w-3 h-3" style={{ color: tone }} />
              Campaign Score
            </p>
            <p className="text-[13.5px] font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>
              Qualidade global
            </p>
          </div>
          <div
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md"
            style={{
              background: `${tone}1f`,
              color: tone,
              border: `1px solid ${tone}44`
            }}
          >
            {label}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <defs>
                <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={tone} stopOpacity="1" />
                  <stop offset="100%" stopColor={tone} stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--surface-2)"
                strokeWidth={stroke}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="url(#scoreGrad)"
                strokeWidth={stroke}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{
                  transition: 'stroke-dashoffset 1.2s ease-out',
                  filter: `drop-shadow(0 0 8px ${tone}88)`
                }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-[42px] font-black tabular-nums leading-none"
                style={{ color: 'var(--text-1)' }}
              >
                {score}
              </span>
              <span
                className="text-[10px] font-bold tracking-widest uppercase"
                style={{ color: 'var(--text-3)' }}
              >
                / 100
              </span>
            </div>
          </div>

          <div className="flex-1 w-full space-y-2.5">
            {breakdown.map((b) => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-[11px] mb-1 gap-2">
                  <span className="font-semibold shrink-0" style={{ color: 'var(--text-2)' }}>
                    {b.label}
                  </span>
                  <span className="tabular-nums font-bold text-right leading-tight" style={{ color: b.color }}>
                    {b.pct}%
                    {b.base != null ? (
                      <span className="block text-[9.5px] font-normal opacity-80" style={{ color: 'var(--text-3)' }}>
                        {b.count}/{b.base} envios · {b.value}/{b.max} pts
                      </span>
                    ) : (
                      <span className="block text-[9.5px] font-normal opacity-80" style={{ color: 'var(--text-3)' }}>
                        {softSpeedNote && b.key === 'speed'
                          ? 'fluxo por resposta · espera não penaliza'
                          : `meta ${SCORE_TARGET_THROUGHPUT_PER_MIN}/min`}{' '}
                        · {b.value}/{b.max} pts
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(100, (b.value / b.max) * 100)}%`,
                      background: `linear-gradient(90deg, ${b.color}, ${b.color}cc)`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="mt-4 pt-3 flex items-center gap-2 text-[10.5px]"
          style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border-subtle)' }}
        >
          <Info className="w-3 h-3 shrink-0" />
          <span className="leading-snug">
            {sentBase > 0 ? (
              <>
                Taxas sobre <strong style={{ color: 'var(--text-2)' }}>{sentBase.toLocaleString('pt-BR')}</strong>{' '}
                envio{sentBase !== 1 ? 's' : ''} (etapa 1).
                {inputs.plannedContacts && inputs.plannedContacts > sentBase
                  ? ` Campanha planejada: ${inputs.plannedContacts.toLocaleString('pt-BR')} contatos.`
                  : null}{' '}
                Pontos: entrega 30%, leitura 30%, resposta 25% (10% de resposta = máximo), velocidade 15%.
                {inputs.replyFlowMode &&
                (inputs.plannedContacts || sentBase) <= SCORE_SOFT_SPEED_CONTACT_CAP
                  ? ' Em fluxo por resposta (≤100 contatos), o tempo aguardando resposta não reduz o score de velocidade.'
                  : null}
              </>
            ) : (
              <>Aguardando o primeiro envio para calcular a qualidade.</>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
