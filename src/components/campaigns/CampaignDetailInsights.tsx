import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Clock,
  Lightbulb,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap
} from 'lucide-react';

export interface DetailInsightInputs {
  total: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  avgResponseSec: number;
  peakHour: { hour: number; count: number } | null;
  chipBreakdown: Array<{ name: string; sent: number; replied: number; replyRate: number }>;
  throughputPerMin: number;
  isRunning: boolean;
}

interface Insight {
  id: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
  icon: React.ReactNode;
  title: string;
  body: string;
}

const TONE_STYLES: Record<Insight['tone'], { bg: string; bd: string; fg: string; iconBg: string }> = {
  success: {
    bg: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.03))',
    bd: 'rgba(16,185,129,0.3)',
    fg: '#059669',
    iconBg: 'rgba(16,185,129,0.18)'
  },
  info: {
    bg: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.03))',
    bd: 'rgba(59,130,246,0.28)',
    fg: '#2563eb',
    iconBg: 'rgba(59,130,246,0.16)'
  },
  warning: {
    bg: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.03))',
    bd: 'rgba(245,158,11,0.32)',
    fg: '#d97706',
    iconBg: 'rgba(245,158,11,0.18)'
  },
  danger: {
    bg: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.03))',
    bd: 'rgba(239,68,68,0.3)',
    fg: '#dc2626',
    iconBg: 'rgba(239,68,68,0.18)'
  }
};

export const CampaignDetailInsights: React.FC<{ data: DetailInsightInputs }> = ({ data }) => {
  const insights = useMemo<Insight[]>(() => {
    const list: Insight[] = [];
    const { total, delivered, read, replied, failed, avgResponseSec, peakHour, chipBreakdown, throughputPerMin, isRunning } = data;

    if (total < 5) return list; // Pouca amostra para conclusões

    const deliveryRate = delivered / total;
    const readRate = read / total;
    const replyRate = replied / total;
    const failRate = failed / total;

    // 1) Taxa de resposta acima do benchmark
    if (replied > 0 && replyRate >= 0.1) {
      list.push({
        id: 'reply-great',
        tone: 'success',
        icon: <Trophy className="w-4 h-4" />,
        title: `Taxa de resposta ${Math.round(replyRate * 100)}% — excelente`,
        body: `A média de mercado em WhatsApp massivo é 3-8%. Você está ${Math.round((replyRate * 100) / 8)}x acima do benchmark. Considere clonar essa campanha e testar variações A/B.`
      });
    } else if (replied > 0 && replyRate < 0.03 && total >= 30) {
      list.push({
        id: 'reply-low',
        tone: 'warning',
        icon: <TrendingDown className="w-4 h-4" />,
        title: `Apenas ${Math.round(replyRate * 100)}% responderam`,
        body: 'Revise o copy: CTA claro, pergunta direta e personalização com {{nome}} aumentam o engajamento em até 3x.'
      });
    }

    // 2) Tempo médio de resposta
    if (replied > 0 && avgResponseSec > 0) {
      if (avgResponseSec <= 600) {
        list.push({
          id: 'fast-response',
          tone: 'success',
          icon: <Zap className="w-4 h-4" />,
          title: `Base engajada — resposta em ${Math.round(avgResponseSec / 60)} min`,
          body: 'Tempo médio de resposta abaixo de 10 min indica público aquecido. Ideal para upsell e ofertas relâmpago.'
        });
      } else if (avgResponseSec > 3600) {
        list.push({
          id: 'slow-response',
          tone: 'info',
          icon: <Clock className="w-4 h-4" />,
          title: `Resposta média em ${Math.round(avgResponseSec / 60)} min`,
          body: 'Considere um follow-up automático após 2h sem resposta para aumentar a conversão.'
        });
      }
    }

    // 3) Taxa de falha elevada
    if (failed > 0 && failRate >= 0.15 && total >= 20) {
      list.push({
        id: 'high-fail',
        tone: 'danger',
        icon: <AlertTriangle className="w-4 h-4" />,
        title: `${Math.round(failRate * 100)}% de falhas (${failed} envios)`,
        body: 'Investigue: números inválidos na base, chip bloqueado ou delay baixo demais. Limpe a lista antes da próxima.'
      });
    }

    // 4) Chip destaque
    if (chipBreakdown.length >= 2) {
      const sorted = [...chipBreakdown].filter((c) => c.sent >= 10).sort((a, b) => b.replyRate - a.replyRate);
      if (sorted.length >= 2) {
        const top = sorted[0];
        const avg = sorted.reduce((a, c) => a + c.replyRate, 0) / sorted.length;
        if (top.replyRate > avg * 1.5 && top.replyRate >= 5) {
          list.push({
            id: `top-chip-${top.name}`,
            tone: 'info',
            icon: <Target className="w-4 h-4" />,
            title: `${top.name} destaca-se na frota`,
            body: `Com ${top.replyRate}% de resposta (${top.replied} de ${top.sent}), é ${Math.round(top.replyRate / Math.max(1, avg))}x mais engajado que a média. Alocar mais volume nele pode escalar resultados.`
          });
        }
      }
    }

    // 5) Pico de atividade
    if (peakHour && peakHour.count >= 5) {
      const h = peakHour.hour;
      const friendly =
        h >= 6 && h < 12 ? 'manhã' : h >= 12 && h < 18 ? 'tarde' : h >= 18 && h < 22 ? 'início da noite' : 'madrugada';
      list.push({
        id: `peak-${h}`,
        tone: 'info',
        icon: <Sparkles className="w-4 h-4" />,
        title: `Pico às ${String(h).padStart(2, '0')}h (${friendly})`,
        body: `${peakHour.count} envios nessa janela. Use esse horário como referência pra futuras campanhas do mesmo público.`
      });
    }

    // 6) Delivery baixo
    if (total >= 20 && deliveryRate < 0.7 && deliveryRate > 0) {
      list.push({
        id: 'low-delivery',
        tone: 'warning',
        icon: <TrendingDown className="w-4 h-4" />,
        title: `Apenas ${Math.round(deliveryRate * 100)}% entregues`,
        body: 'Taxa abaixo do normal. Pode indicar números desatualizados, bloqueios WhatsApp ou chips muito novos. Aquecimento pode ajudar.'
      });
    }

    // 7) Leitura alta mas resposta baixa
    if (read > 0 && readRate >= 0.6 && replyRate < 0.05 && total >= 30) {
      list.push({
        id: 'read-no-reply',
        tone: 'info',
        icon: <Lightbulb className="w-4 h-4" />,
        title: 'Estão lendo mas não respondem',
        body: 'A mensagem chega e é vista, mas falta incentivo pra responder. Experimente terminar com uma pergunta direta ou um gatilho "responda SIM".'
      });
    }

    // 8) Throughput alto
    if (isRunning && throughputPerMin >= 5) {
      list.push({
        id: 'speed-fast',
        tone: 'success',
        icon: <TrendingUp className="w-4 h-4" />,
        title: `Ritmo de ${throughputPerMin.toFixed(1)} msgs/min`,
        body: 'Cadência forte — garanta que o delay está respeitando intervalos para evitar bloqueios dos chips.'
      });
    }

    return list.slice(0, 5);
  }, [data]);

  if (insights.length === 0) return null;

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.14))',
            border: '1px solid rgba(139,92,246,0.3)'
          }}
        >
          <Lightbulb className="w-4 h-4 text-violet-500" />
        </div>
        <div className="min-w-0">
          <h3 className="ui-title text-[14.5px]">Inteligência da campanha</h3>
          <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            {insights.length} insight{insights.length === 1 ? '' : 's'} gerado{insights.length === 1 ? '' : 's'} automaticamente
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {insights.map((ins) => {
          const s = TONE_STYLES[ins.tone];
          return (
            <div
              key={ins.id}
              className="rounded-xl p-3 flex items-start gap-2.5"
              style={{ background: s.bg, border: `1px solid ${s.bd}` }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: s.iconBg, color: s.fg, border: `1px solid ${s.bd}` }}
              >
                {ins.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
                  {ins.title}
                </p>
                <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {ins.body}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
