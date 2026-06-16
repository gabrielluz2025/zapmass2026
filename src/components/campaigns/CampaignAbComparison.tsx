/**
 * CampaignAbComparison
 *
 * Mostra, lado a lado, as métricas das variantes A e B de cada experimento A/B,
 * destacando a variante vencedora pela taxa de resposta.
 */
import React from 'react';
import { FlaskConical, Trophy, Send, CheckCheck, Reply } from 'lucide-react';
import { Campaign } from '../../types';
import { detectAbPairs, AbVariantMetrics } from '../../utils/campaignAbCompare';

interface Props {
  campaigns: Campaign[];
  onOpenCampaign?: (campaignId: string) => void;
}

const VariantColumn: React.FC<{
  m: AbVariantMetrics;
  isWinner: boolean;
  onOpen?: () => void;
}> = ({ m, isWinner, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="flex-1 text-left rounded-xl p-3 transition-all"
    style={{
      background: isWinner ? 'rgba(16,185,129,0.08)' : 'var(--surface-1)',
      border: `1.5px solid ${isWinner ? 'rgba(16,185,129,0.4)' : 'var(--border-subtle)'}`,
    }}
  >
    <div className="flex items-center justify-between mb-2">
      <span className="text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>
        Variante {m.variant}
      </span>
      {isWinner && (
        <span
          className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: '#10b981', color: '#fff' }}
        >
          <Trophy className="w-3 h-3" />
          Vencedora
        </span>
      )}
    </div>
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <Send className="w-3 h-3" /> Enviados
        </span>
        <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{m.sent}</span>
      </div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
          <CheckCheck className="w-3 h-3" /> Entrega
        </span>
        <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{m.deliveryRatePct}%</span>
      </div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="flex items-center gap-1.5" style={{ color: isWinner ? '#10b981' : 'var(--text-3)' }}>
          <Reply className="w-3 h-3" /> Resposta
        </span>
        <span style={{ color: isWinner ? '#10b981' : 'var(--text-1)', fontWeight: 700 }}>
          {m.replyRatePct}%
        </span>
      </div>
    </div>
  </button>
);

export const CampaignAbComparison: React.FC<Props> = ({ campaigns, onOpenCampaign }) => {
  const pairs = detectAbPairs(campaigns);
  if (pairs.length === 0) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
    >
      <div
        className="px-5 py-4 border-b flex items-center gap-3"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(139,92,246,0.15)' }}
        >
          <FlaskConical className="w-4.5 h-4.5" style={{ color: '#8b5cf6' }} />
        </div>
        <div>
          <h3 className="font-bold text-[14px]" style={{ color: 'var(--text-1)' }}>
            Laboratório A/B — Resultados
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            Compare as variantes e use a vencedora nas próximas campanhas
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {pairs.map((p) => (
          <div key={p.baseName}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                {p.baseName}
              </span>
              {p.winner && p.replyRateGapPct > 0 && (
                <span className="text-[11px]" style={{ color: '#10b981' }}>
                  Variante {p.winner} venceu por {p.replyRateGapPct} ponto{p.replyRateGapPct !== 1 ? 's' : ''} %
                </span>
              )}
              {!p.winner && (
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Empate / dados insuficientes
                </span>
              )}
            </div>
            <div className="flex items-stretch gap-2">
              <VariantColumn
                m={p.a}
                isWinner={p.winner === 'A'}
                onOpen={onOpenCampaign ? () => onOpenCampaign(p.a.campaign.id) : undefined}
              />
              <div className="flex items-center justify-center px-1">
                <span className="text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>
                  VS
                </span>
              </div>
              <VariantColumn
                m={p.b}
                isWinner={p.winner === 'B'}
                onOpen={onOpenCampaign ? () => onOpenCampaign(p.b.campaign.id) : undefined}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
