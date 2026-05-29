import React, { useState } from 'react';
import { Sparkles, Bug, Zap, Shield, ChevronDown, ChevronUp, Tag } from 'lucide-react';

interface ChangelogEntry {
  version: string;
  date: string;
  highlights: { type: 'fix' | 'feat' | 'perf' | 'security'; text: string }[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.2.0',
    date: '29/05/2026',
    highlights: [
      { type: 'fix', text: 'Campanhas Evolution agora fecham corretamente na UI após finalizar' },
      { type: 'fix', text: 'Auto-warmup voltou a funcionar (handlers socket registrados)' },
      { type: 'fix', text: 'Renomear canal agora persiste após reinício do servidor' },
      { type: 'fix', text: 'Métricas do dashboard deixaram de mostrar zeros ao conectar' },
      { type: 'fix', text: 'Progresso de campanha com contadores inconsistentes corrigido' },
      { type: 'security', text: 'Conversas agora enviadas apenas para o dono — sem risco cross-tenant' },
      { type: 'feat', text: 'Mapa geográfico de campanhas por estado aparece no Dashboard' },
      { type: 'feat', text: 'Alerta visual quando canal atinge limite diário de mensagens' },
    ],
  },
  {
    version: '2.1.0',
    date: '29/05/2026',
    highlights: [
      { type: 'fix', text: 'Etapas de campanha: colisão de jobId entre etapas do mesmo contato corrigida' },
      { type: 'fix', text: 'Retry do BullMQ não envia mais mensagem duplicada (idempotência)' },
      { type: 'perf', text: 'Worker de campanha: concorrência 1 → 5 (drenagem de fila mais rápida)' },
      { type: 'fix', text: 'Reply flow: delay de 3-7s entre resposta e próximo envio' },
      { type: 'fix', text: 'Campanha não finaliza prematuramente enquanto reply flow está ativo' },
      { type: 'fix', text: 'Estado de campanha restaurado do Redis após reinício do servidor' },
      { type: 'fix', text: 'Pausa de campanha: item já enviado não é mais reenfileirado' },
    ],
  },
  {
    version: '2.0.0',
    date: '28/05/2026',
    highlights: [
      { type: 'feat', text: 'Dashboard redesenhado: Mission Control com gauges SVG e radar animado' },
      { type: 'feat', text: 'Contatos redesenhados: People HQ com KPIs e temperatura da base' },
      { type: 'feat', text: 'Campanhas redesenhadas: Launch Pad com missões em voo' },
      { type: 'feat', text: 'Bate-papo: renomeado de Pipeline; empty state animada com bot' },
      { type: 'fix', text: 'Números WhatsApp LID não aparecem mais como telefones reais' },
      { type: 'fix', text: 'Fotos de perfil: URLs blob do Puppeteer filtradas corretamente' },
      { type: 'perf', text: 'Sync de conversas: segundo ciclo em 90s + limite de mensagens duplicado' },
    ],
  },
  {
    version: '1.9.0',
    date: '27/05/2026',
    highlights: [
      { type: 'fix', text: 'Erro "Custom Id cannot contain :" em campanhas corrigido' },
      { type: 'fix', text: 'Deploy VPS: variáveis SWARM_ENABLED e REDIS_URL exportadas corretamente' },
      { type: 'fix', text: 'Script de migração Swarm→Compose não tentava mais subir serviço inexistente' },
    ],
  },
  {
    version: '1.8.0',
    date: '26/05/2026',
    highlights: [
      { type: 'feat', text: 'Migração automática de Docker Swarm para Docker Compose' },
      { type: 'feat', text: 'Healthcheck do Redis no Docker Compose' },
      { type: 'fix', text: 'Nginx apontando para porta errada corrigido' },
      { type: 'fix', text: 'Erro session-bus no modo monolith eliminado' },
    ],
  },
];

const typeConfig = {
  fix: { icon: Bug, label: 'Correção', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  feat: { icon: Sparkles, label: 'Novidade', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  perf: { icon: Zap, label: 'Performance', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  security: { icon: Shield, label: 'Segurança', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
};

interface ChangelogPanelProps {
  maxItems?: number;
  showTitle?: boolean;
}

export const ChangelogPanel: React.FC<ChangelogPanelProps> = ({ maxItems, showTitle = true }) => {
  const [expanded, setExpanded] = useState<string | null>(CHANGELOG[0]?.version ?? null);
  const [showAll, setShowAll] = useState(false);

  const visibleEntries = showAll || !maxItems ? CHANGELOG : CHANGELOG.slice(0, maxItems);
  const currentVersion = CHANGELOG[0]?.version ?? '?';

  return (
    <div className="space-y-4">
      {showTitle && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/20">
              <Tag className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-[15px]">Novidades & Correções</h3>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">Versão atual: <span className="font-mono font-semibold text-violet-600 dark:text-violet-400">v{currentVersion}</span></p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {visibleEntries.map((entry) => {
          const isOpen = expanded === entry.version;
          const isLatest = entry.version === CHANGELOG[0]?.version;

          return (
            <div
              key={entry.version}
              className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                isOpen
                  ? 'border-violet-500/30 bg-violet-500/5 dark:bg-violet-500/8'
                  : 'border-slate-200/70 dark:border-slate-700/60 bg-white/60 dark:bg-slate-800/40 hover:border-violet-500/20'
              }`}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : entry.version)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-[13px] font-bold text-slate-700 dark:text-slate-200 shrink-0">
                    v{entry.version}
                  </span>
                  {isLatest && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/20 text-[10px] font-semibold text-violet-700 dark:text-violet-300 shrink-0">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
                      </span>
                      Atual
                    </span>
                  )}
                  <span className="text-[12px] text-slate-400 dark:text-slate-500 shrink-0">{entry.date}</span>
                  {!isOpen && (
                    <span className="text-[12px] text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                      {entry.highlights.length} mudança{entry.highlights.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                )}
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-2">
                  {entry.highlights.map((item, idx) => {
                    const cfg = typeConfig[item.type];
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={idx}
                        className={`flex items-start gap-2.5 rounded-lg px-3 py-2 border ${cfg.bg}`}
                      >
                        <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                        <div className="min-w-0">
                          <span className={`text-[10px] font-bold uppercase tracking-wide mr-2 ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          <span className="text-[13px] text-slate-700 dark:text-slate-200">{item.text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {maxItems && CHANGELOG.length > maxItems && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="w-full flex items-center justify-center gap-2 py-2 text-[13px] text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
        >
          {showAll ? (
            <><ChevronUp className="w-4 h-4" /> Mostrar menos</>
          ) : (
            <><ChevronDown className="w-4 h-4" /> Ver histórico completo ({CHANGELOG.length - maxItems} versões anteriores)</>
          )}
        </button>
      )}
    </div>
  );
};
