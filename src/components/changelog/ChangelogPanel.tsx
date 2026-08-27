import React, { useState } from 'react';
import { Sparkles, Bug, Zap, Shield, ChevronDown, ChevronUp, Tag, FlaskConical, Rocket } from 'lucide-react';
import { PROD_VERSION, HOMOLOG_VERSION } from '../../config/appVersion';

interface ChangelogEntry {
  version: string;
  date: string;
  highlights: { type: 'fix' | 'feat' | 'perf' | 'security'; text: string }[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.3.18',
    date: '27/08/2026',
    highlights: [
      { type: 'feat', text: 'Chat completamente redesenhado: layout idêntico ao WhatsApp Desktop' },
      { type: 'feat', text: 'Avatares circulares (50%) em toda a inbox e header — exato WA Desktop' },
      { type: 'feat', text: 'Linhas de conversa 72px, padding 12px — medidas exatas do WA Desktop' },
      { type: 'feat', text: 'Selecionado = #2a3942, hover = #1e2a31 (sem verde), sem accent bar' },
      { type: 'feat', text: 'Filter pills estilo WA Desktop: escuro inativo / verde ativo' },
      { type: 'feat', text: 'Header inbox com botões Nova Conversa e Menu (igual WA Desktop)' },
      { type: 'feat', text: 'Header do chat com ícones Vídeo e Ligação (exato WA Desktop)' },
      { type: 'feat', text: 'Nova aba "Campanhas" na inbox junto com Tudo / Não lidas / Quentes' },
    ],
  },
  {
    version: '2.3.17',
    date: '27/08/2026',
    highlights: [
      { type: 'feat', text: 'Bate-papo redesenhado: visual idêntico ao WhatsApp Web (cores, layout, tipografia)' },
      { type: 'fix', text: 'Fotos e vídeos agora aparecem direto — URL CDN do WhatsApp incluída no webhook' },
      { type: 'fix', text: 'Placeholder de imagem/vídeo: quadrado cinza com ícone centralizado (igual WA Web)' },
      { type: 'fix', text: 'Áudio e documentos com player e ícones no estilo WhatsApp' },
      { type: 'fix', text: 'Banner de homologação não sobrepõe mais a TopBar' },
      { type: 'perf', text: 'Fotos de contato carregam mais rápido (prefetch aumentado para 24 itens)' },
      { type: 'fix', text: 'Aba "Quentes" filtra corretamente após tag ser aplicada' },
    ],
  },
  {
    version: '2.3.16',
    date: '14/07/2026',
    highlights: [
      { type: 'security', text: 'Conversas não se misturam mais entre usuários diferentes (isolamento por tenant)' },
      { type: 'fix', text: 'Webhook descarta mensagens de canais sem dono — sem poluição cruzada' },
      { type: 'fix', text: 'claim-connection só vincula canais órfãos — impede roubo de chip' },
    ],
  },
  {
    version: '2.3.15',
    date: '14/07/2026',
    highlights: [
      { type: 'fix', text: 'CI/CD: testes de dashboard falhavam entre 21h–23h59 (fuso horário incorreto)' },
      { type: 'fix', text: 'GitHub Actions: TZ=America/Sao_Paulo aplicado no build' },
    ],
  },
  {
    version: '2.3.14',
    date: '14/07/2026',
    highlights: [
      { type: 'feat', text: 'Evolution sharding (Fase A): 2ª instância para distribuir carga de chips' },
      { type: 'feat', text: 'Roteamento automático de novos clientes para o shard com menos carga' },
    ],
  },
  {
    version: '2.3.13',
    date: '13/07/2026',
    highlights: [
      { type: 'fix', text: 'Redis OOM: retenção agressiva de jobs BullMQ (trim a cada 30 min)' },
      { type: 'perf', text: 'Redis configurado com limite de 2 GB por padrão' },
      { type: 'feat', text: '/api/health/deep expõe métricas da fila de campanhas' },
    ],
  },
  {
    version: '2.3.7',
    date: '29/05/2026',
    highlights: [
      { type: 'fix', text: 'Teste grátis: segundo clique não mostra mais erro de trial já ativo' },
      { type: 'fix', text: 'Painel abre imediatamente após ativar trial (estado otimista)' },
    ],
  },
  {
    version: '2.3.5',
    date: '29/05/2026',
    highlights: [
      { type: 'fix', text: 'Lista de conversas com 2 linhas (nome + preview), igual ao WhatsApp Web' },
      { type: 'fix', text: 'Horários corretos: Hoje, Ontem, dd/mm — sem timestamps de sync' },
      { type: 'fix', text: 'Fotos de perfil espelhadas no servidor para evitar bloqueio no browser' },
    ],
  },
  {
    version: '2.2.0',
    date: '29/05/2026',
    highlights: [
      { type: 'fix', text: 'Campanhas Evolution fecham corretamente após finalizar' },
      { type: 'fix', text: 'Auto-warmup voltou a funcionar' },
      { type: 'security', text: 'Conversas enviadas apenas para o dono — sem risco cross-tenant' },
      { type: 'feat', text: 'Mapa geográfico de campanhas por estado no Dashboard' },
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

/** Compara versões semânticas (retorna true se a >= b) */
function versionGte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return true;
}

export const ChangelogPanel: React.FC<ChangelogPanelProps> = ({ maxItems, showTitle = true }) => {
  const [expanded, setExpanded] = useState<string | null>(CHANGELOG[0]?.version ?? null);
  const [showAll, setShowAll] = useState(false);

  const visibleEntries = showAll || !maxItems ? CHANGELOG : CHANGELOG.slice(0, maxItems);

  // Versões que estão no homolog mas ainda não foram para produção
  const pendingProd = CHANGELOG.filter(
    (e) => versionGte(e.version, PROD_VERSION) && e.version !== PROD_VERSION
  );

  return (
    <div className="space-y-4">
      {showTitle && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/20">
              <Tag className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-[15px]">Novidades & Correções</h3>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">
                Histórico de versões do sistema
              </p>
            </div>
          </div>

          {/* Badges de ambiente */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <FlaskConical className="w-3 h-3" />
              Homolog v{HOMOLOG_VERSION}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <Rocket className="w-3 h-3" />
              Produção v{PROD_VERSION}
            </span>
          </div>
        </div>
      )}

      {/* Alerta de versões pendentes em produção */}
      {pendingProd.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">
              {pendingProd.length} versão{pendingProd.length > 1 ? 'ões' : ''} aguardando deploy em produção
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pendingProd.map((e) => (
              <span
                key={e.version}
                className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] font-mono font-bold text-amber-700 dark:text-amber-300"
              >
                v{e.version}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-amber-600/70 dark:text-amber-400/60 mt-2">
            Deploy automático ocorre de madrugada (02h–06h BRT) ou via GitHub Actions → Run workflow.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {visibleEntries.map((entry) => {
          const isOpen = expanded === entry.version;
          const isHomolog = entry.version === HOMOLOG_VERSION;
          const isProd = entry.version === PROD_VERSION;
          const isPending = versionGte(entry.version, PROD_VERSION) && !isProd;

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
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-mono text-[13px] font-bold text-slate-700 dark:text-slate-200 shrink-0">
                    v{entry.version}
                  </span>

                  {isHomolog && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20 text-[10px] font-semibold text-amber-700 dark:text-amber-300 shrink-0">
                      <FlaskConical className="w-2.5 h-2.5" /> Homolog
                    </span>
                  )}
                  {isProd && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
                      <Rocket className="w-2.5 h-2.5" /> Produção
                    </span>
                  )}
                  {isPending && !isHomolog && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
                      aguardando prod
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
