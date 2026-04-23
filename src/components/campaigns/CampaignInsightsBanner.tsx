import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Clock,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  X
} from 'lucide-react';
import { Campaign, CampaignStatus, WhatsAppConnection, ConnectionStatus } from '../../types';

interface Insight {
  id: string;
  tone: 'danger' | 'warning' | 'info' | 'success';
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}

interface CampaignInsightsBannerProps {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  onOpenDetails: (id: string) => void;
  dismissedIds: string[];
  onDismiss: (id: string) => void;
}

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h

const toneStyle: Record<Insight['tone'], { bg: string; bd: string; fg: string; soft: string }> = {
  danger: {
    bg: 'linear-gradient(135deg, rgba(239,68,68,0.14), rgba(239,68,68,0.04))',
    bd: 'rgba(239,68,68,0.32)',
    fg: '#ef4444',
    soft: 'rgba(239,68,68,0.18)'
  },
  warning: {
    bg: 'linear-gradient(135deg, rgba(245,158,11,0.14), rgba(245,158,11,0.04))',
    bd: 'rgba(245,158,11,0.32)',
    fg: '#d97706',
    soft: 'rgba(245,158,11,0.18)'
  },
  info: {
    bg: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(59,130,246,0.04))',
    bd: 'rgba(59,130,246,0.3)',
    fg: '#2563eb',
    soft: 'rgba(59,130,246,0.16)'
  },
  success: {
    bg: 'linear-gradient(135deg, rgba(16,185,129,0.14), rgba(16,185,129,0.04))',
    bd: 'rgba(16,185,129,0.32)',
    fg: '#059669',
    soft: 'rgba(16,185,129,0.18)'
  }
};

export const CampaignInsightsBanner: React.FC<CampaignInsightsBannerProps> = ({
  campaigns,
  connections,
  onOpenDetails,
  dismissedIds,
  onDismiss
}) => {
  const insights = useMemo<Insight[]>(() => {
    const list: Insight[] = [];

    // 1) Campanha running há muito tempo sem progresso significativo
    const now = Date.now();
    campaigns.forEach((c) => {
      if (c.status !== CampaignStatus.RUNNING) return;
      const created = new Date(c.createdAt).getTime();
      const ageMs = now - created;
      const pct = c.totalContacts > 0 ? c.processedCount / c.totalContacts : 0;
      if (ageMs > STALE_THRESHOLD_MS && pct < 0.2) {
        list.push({
          id: `stale-${c.id}`,
          tone: 'warning',
          icon: <Clock className="w-4 h-4" />,
          title: 'Campanha travada?',
          body: `A campanha "${c.name}" está rodando há ${Math.floor(
            ageMs / 3600000
          )}h e processou apenas ${Math.round(
            pct * 100
          )}% dos contatos. Verifique os chips ou pause e retome.`,
          action: { label: 'Ver detalhes', onClick: () => onOpenDetails(c.id) }
        });
      }
    });

    // 2) Taxa de falha alta em alguma campanha
    campaigns.forEach((c) => {
      if (c.processedCount < 30) return;
      const failRate = c.failedCount / Math.max(1, c.processedCount);
      if (failRate > 0.3) {
        list.push({
          id: `failrate-${c.id}`,
          tone: 'danger',
          icon: <TrendingDown className="w-4 h-4" />,
          title: 'Taxa de falha elevada',
          body: `"${c.name}" está com ${Math.round(
            failRate * 100
          )}% de falhas (${c.failedCount} de ${c.processedCount}). Revise a lista de contatos e o estado dos chips.`,
          action: { label: 'Inspecionar', onClick: () => onOpenDetails(c.id) }
        });
      }
    });

    // 3) Sem chips online e tem campanha rodando
    const onlineCount = connections.filter((x) => x.status === ConnectionStatus.CONNECTED).length;
    const running = campaigns.filter((c) => c.status === CampaignStatus.RUNNING);
    if (running.length > 0 && onlineCount === 0) {
      list.push({
        id: 'no-chips',
        tone: 'danger',
        icon: <AlertTriangle className="w-4 h-4" />,
        title: 'Nenhum chip online',
        body: `${running.length} ${
          running.length === 1 ? 'campanha está ativa' : 'campanhas estão ativas'
        }, mas não há chips conectados. Reconecte ao menos um canal para retomar os disparos.`
      });
    }

    // 4) Top campanha em sucesso (apenas se houver mais de uma completada)
    const completed = campaigns.filter(
      (c) => c.status === CampaignStatus.COMPLETED && c.processedCount > 50
    );
    if (completed.length >= 2) {
      const top = [...completed].sort((a, b) => {
        const rA = a.successCount / Math.max(1, a.processedCount);
        const rB = b.successCount / Math.max(1, b.processedCount);
        return rB - rA;
      })[0];
      const topRate = Math.round((top.successCount / Math.max(1, top.processedCount)) * 100);
      if (topRate >= 90) {
        list.push({
          id: `top-${top.id}`,
          tone: 'success',
          icon: <Trophy className="w-4 h-4" />,
          title: 'Campanha campeã',
          body: `"${top.name}" entregou ${topRate}% de sucesso (${top.successCount} envios). Use como modelo — duplique e ajuste a lista.`,
          action: { label: 'Ver campanha', onClick: () => onOpenDetails(top.id) }
        });
      }
    }

    // 5) Melhor horário do dia atual
    const hour = new Date().getHours();
    if (hour >= 9 && hour <= 11) {
      list.push({
        id: `best-window-${hour}`,
        tone: 'info',
        icon: <TrendingUp className="w-4 h-4" />,
        title: 'Janela de ouro',
        body: 'Entre 9h e 11h30 os contatos costumam responder mais. Se puder, dispare campanhas novas agora.'
      });
    }

    // 6) Volume total — celebrar marcos
    const totalSuccess = campaigns.reduce((a, c) => a + c.successCount, 0);
    const milestones = [1000, 10_000, 50_000, 100_000, 500_000, 1_000_000];
    for (const m of milestones.slice().reverse()) {
      if (totalSuccess >= m) {
        list.push({
          id: `milestone-${m}`,
          tone: 'success',
          icon: <Sparkles className="w-4 h-4" />,
          title: `${m.toLocaleString('pt-BR')} envios acumulados 🎉`,
          body: `Você já enviou ${totalSuccess.toLocaleString(
            'pt-BR'
          )} mensagens com o ZapMass. Continue otimizando o funil para escalar ainda mais.`
        });
        break;
      }
    }

    // 7) Concentração de volume em um chip só
    if (running.length > 0 && connections.length >= 2) {
      const runningMsgs: Record<string, number> = {};
      running.forEach((c) => {
        c.selectedConnectionIds.forEach((id) => {
          runningMsgs[id] = (runningMsgs[id] || 0) + c.totalContacts / c.selectedConnectionIds.length;
        });
      });
      const entries = Object.entries(runningMsgs).sort((a, b) => b[1] - a[1]);
      if (entries.length > 0) {
        const total = entries.reduce((a, [, v]) => a + v, 0);
        const topShare = entries[0][1] / Math.max(1, total);
        if (topShare > 0.7 && connections.length > 1) {
          list.push({
            id: `concentration-${entries[0][0]}`,
            tone: 'warning',
            icon: <Target className="w-4 h-4" />,
            title: 'Carga concentrada',
            body: `Mais de ${Math.round(
              topShare * 100
            )}% dos disparos atuais estão em um único chip. Distribua entre mais canais pra reduzir risco de bloqueio.`
          });
        }
      }
    }

    return list.filter((i) => !dismissedIds.includes(i.id));
  }, [campaigns, connections, dismissedIds, onOpenDetails]);

  if (insights.length === 0) return null;

  return (
    <div className="space-y-2">
      {insights.slice(0, 3).map((ins) => {
        const s = toneStyle[ins.tone];
        return (
          <div
            key={ins.id}
            className="rounded-xl p-3 relative flex items-start gap-3"
            style={{
              background: s.bg,
              border: `1px solid ${s.bd}`
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: s.soft, color: s.fg, border: `1px solid ${s.bd}` }}
            >
              {ins.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-[12.5px] font-bold leading-tight"
                style={{ color: 'var(--text-1)' }}
              >
                {ins.title}
              </p>
              <p
                className="text-[12px] mt-0.5 leading-relaxed"
                style={{ color: 'var(--text-2)' }}
              >
                {ins.body}
              </p>
            </div>
            {ins.action && (
              <button
                type="button"
                onClick={ins.action.onClick}
                className="text-[11.5px] font-bold px-2.5 py-1.5 rounded-lg shrink-0 transition-colors hover:opacity-90"
                style={{
                  background: s.fg,
                  color: '#fff',
                  boxShadow: `0 4px 10px ${s.fg}55`
                }}
              >
                {ins.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(ins.id)}
              className="p-1 rounded-md transition-colors hover:bg-black/10 shrink-0"
              style={{ color: 'var(--text-3)' }}
              title="Dispensar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
