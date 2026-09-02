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
    version: '2.3.54',
    date: '02/09/2026',
    highlights: [
      { type: 'fix', text: 'Go: lock HistorySync até OfflineSyncCompleted + ACKs Receipt (entrega/leitura)' },
      { type: 'fix', text: 'HistorySync: stubs Conversations+Data mesclados; timer idle por chip' },
      { type: 'security', text: 'send-message exige ID válido; reconnect BullMQ rate-limited; default evolution-go' },
      { type: 'fix', text: 'Chat: loading por conversa, mídia sem race, menus resetam; teste campanha com timeout' },
    ],
  },
  {
    version: '2.3.53',
    date: '02/09/2026',
    highlights: [
      { type: 'fix', text: 'Modo foco: botão visível no header + Esc para sair — não havia mais como sair' },
      { type: 'fix', text: 'historyImporting preso: agora zerado ao desconectar socket' },
      { type: 'fix', text: 'Boot: emit duplicado de sync full removido' },
      { type: 'fix', text: 'Histórico: conversa só marcada como inicializada após sucesso do load' },
      { type: 'perf', text: 'Inbox: pinnedIds agora usa Set (O(1) por linha) e array de candidatos não é mais mutado' },
    ],
  },
  {
    version: '2.3.52',
    date: '02/09/2026',
    highlights: [
      { type: 'fix', text: 'Go: anti-tempestade no Atualizar — sem emit duplicado, cooldown 90s/chip, reconnect escalonado' },
    ],
  },
  {
    version: '2.3.51',
    date: '02/09/2026',
    highlights: [
      { type: 'fix', text: 'Bate-papo Go: botão Atualizar dispara reconnect e importa conversas do celular via HistorySync' },
    ],
  },
  {
    version: '2.3.50',
    date: '01/09/2026',
    highlights: [
      { type: 'fix', text: 'Go: HistorySync sinalizado ao conectar chip + sync full no modo webhook' },
      { type: 'fix', text: 'Wizard de campanha: limite diário só em chips online com número pareado' },
    ],
  },
  {
    version: '2.3.49',
    date: '01/09/2026',
    highlights: [
      { type: 'feat', text: 'Bate-papo Evolution Go: importação HistorySync com lista de conversas + barra de progresso' },
      { type: 'fix', text: 'De-para LID/telefone unificado no servidor — some thread duplicada' },
      { type: 'feat', text: 'Visual WA Web: avatars locais, skeleton, empty states, Nova conversa e Opções funcionais' },
    ],
  },
  {
    version: '2.3.48',
    date: '01/09/2026',
    highlights: [
      { type: 'fix', text: 'Desconectar não religa o chip sozinho: logout manual bloqueia auto-reconnect e some o “Online” fantasma sem número' },
    ],
  },
  {
    version: '2.3.47',
    date: '01/09/2026',
    highlights: [
      { type: 'fix', text: 'Correção de typecheck no CI para deploy da prospecção da base (v2.3.46)' },
    ],
  },
  {
    version: '2.3.46',
    date: '01/09/2026',
    highlights: [
      { type: 'feat', text: 'Preset Prospecção da base: onda inicial + plano semanal para quem responde + lembretes automáticos para silenciosos' },
      { type: 'feat', text: 'Painel na campanha com enviados, respostas, silenciosos e próxima onda de lembrete' },
    ],
  },
  {
    version: '2.3.45',
    date: '01/09/2026',
    highlights: [
      { type: 'fix', text: 'Watchdog do Evolution Go não reinicia mais o container saudável (404/401 sem API key) — chips deixam de cair a cada ~2 min após o deploy' },
    ],
  },
  {
    version: '2.3.44',
    date: '01/09/2026',
    highlights: [
      { type: 'fix', text: 'Erro invalid UUID length:20 na aba Conexões: o Evolution Go não recebe mais o id conn_* no lugar do UUID interno do chip' },
      { type: 'fix', text: 'Toast passa a explicar o problema em português se o identificador do canal ainda estiver desatualizado' },
    ],
  },
  {
    version: '2.3.43',
    date: '01/09/2026',
    highlights: [
      { type: 'fix', text: 'Deploy de homologação não para mais o Evolution Go de produção — chips WhatsApp deixam de cair ao subir homolog' },
    ],
  },
  {
    version: '2.3.42',
    date: '01/09/2026',
    highlights: [
      { type: 'fix', text: 'Disparo não recusa mais chips Online: parser Go reconhece Connected/LoggedIn e ignora status:success' },
      { type: 'fix', text: 'Se o webhook já marcou o canal open, falha isolada do probe HTTP não bloqueia a campanha' },
    ],
  },
  {
    version: '2.3.41',
    date: '01/09/2026',
    highlights: [
      { type: 'feat', text: 'Admin pode conceder bônus permanente de canais por usuário (acima do teto de 5) — Centro de acessos → Ações → Bônus de canais' },
      { type: 'feat', text: 'Campo adminBonusChannelSlots: plano 5 + bônus 10 = até 15 canais para o cliente selecionado' },
    ],
  },
  {
    version: '2.3.40',
    date: '29/08/2026',
    highlights: [
      { type: 'fix', text: 'reconcileConnectionHealth: double-probe antes de rebaixar chip open — estado transitório do Evolution Go (keep-alive, OfflineSync) não gera mais reconexão falsa' },
      { type: 'fix', text: 'ensureGoInstanceWebhook: POST /instance/connect ignorado se chip já está open — eliminada transição connecting falsa que acionava o probe acima' },
    ],
  },
  {
    version: '2.3.39',
    date: '29/08/2026',
    highlights: [
      { type: 'fix', text: 'Go adapter: evento Connected agora sempre mapeia para open — eliminado loop de reconexão causado por Connected→close→reconnect' },
      { type: 'fix', text: 'reconcileConnectionHealth: chips open usam probe fresco (skip cache) — cache de probe obsoleto não derruba mais chips conectados' },
      { type: 'fix', text: 'isConnectionOpen: falha isolada de probe não marca mais o chip como offline — transição open→close exclusiva de webhooks e reconcile' },
    ],
  },
  {
    version: '2.3.38',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Boot replay: ao reiniciar o servidor, respostas recebidas durante o downtime são reprocessadas automaticamente no fluxo de resposta' },
      { type: 'fix', text: 'Heartbeat Redis salvo a cada 5 min — permite calcular a janela exata de mensagens perdidas durante queda do ZapMass' },
    ],
  },
  {
    version: '2.3.37',
    date: '28/08/2026',
    highlights: [
      { type: 'feat', text: 'Botão Editar nos cards de campanhas pausadas/agendadas — abre o wizard pré-preenchido com nome, mensagens, fluxos e canais' },
      { type: 'feat', text: 'Modo edição restaura chip individual ou pool original; salva via PATCH e remapeia jobs pendentes para novos chips' },
      { type: 'feat', text: 'Audiência da campanha é preservada no edit por padrão; aviso no passo 1 orienta quando alterar' },
    ],
  },
  {
    version: '2.3.36',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Healthcheck do Evolution Go homolog corrigido — mesmo fix do v2.3.35 aplicado ao docker-compose.homolog.yml' },
    ],
  },
  {
    version: '2.3.35',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Evolution Go healthcheck: aceita 401 como saudável — container não fica mais preso em "starting"' },
    ],
  },
  {
    version: '2.3.34',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'isConnectionOpen: erros 4xx/rede agora cacheados — chip inválido não gera flood de requests' },
      { type: 'fix', text: 'fetchConnectQr: polling aborta ao receber 400 (chip deletado) — sem mais loop de 2s infinito' },
    ],
  },
  {
    version: '2.3.33',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Pool: retomar campanha agora redistribui jobs entre todos os chips ativos — fim do "só chip X envia"' },
      { type: 'fix', text: 'Pool: chip saudável com RAM temporariamente desatualizada não causa failover falso para chip único' },
      { type: 'fix', text: 'Pool: config no Redis expira em 7 dias (era 24h) — campanhas longas não perdem distribuição' },
    ],
  },
  {
    version: '2.3.32',
    date: '28/08/2026',
    highlights: [
      { type: 'perf', text: 'Debounce 2s no hydrateInstances — browser com chip offline não gera mais flood 4×/s no Evolution Go' },
      { type: 'fix', text: 'ensureGoInstanceWebhook: debounce 30s por chip — sem re-registro desnecessário em reconexões rápidas de Socket.IO' },
    ],
  },
  {
    version: '2.3.31',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Pool: chip com circuit OPEN sem alternativo não envia mais — aborta com delay 5min (evita ban)' },
      { type: 'fix', text: 'Pool: limite diário agora redistribui para outro chip do pool antes de adiar até meia-noite' },
      { type: 'fix', text: 'Pool: cap de tier ramp-up agora redistribui para chip maduro do pool antes de adiar' },
      { type: 'fix', text: 'Pool: failover com preferCurrent:false — nunca devolve o chip problemático' },
      { type: 'fix', text: 'Pool: redirect de limite respeita alternateChannelIds (chips do pool da campanha)' },
    ],
  },
  {
    version: '2.3.30',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Flood /instance/all: cache 5s compartilhado entre chips — 30 req/s → 1 req/5s no Evolution Go' },
      { type: 'fix', text: 'filterActiveConnections: stagger 50ms entre chips evita burst simultâneo de probes' },
      { type: 'fix', text: 'Watchdog: não reinicia container com menos de 90s de uptime — previne loop durante inicialização' },
    ],
  },
  {
    version: '2.3.29',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Causa raiz do crash Evolution Go: immediate:true no boot enviava N reconexões WhatsApp simultâneas — removido do re-registro de webhook' },
      { type: 'fix', text: 'Hydrate duplo no startup: segunda chamada duplicava a tempestade de connect — removida' },
      { type: 'perf', text: 'Poll de status chips: backoff crescente 2s→10s em vez de fixo 2s, reduz carga HTTP 75%' },
      { type: 'fix', text: 'Falso alarme "fora do ar": agora aguarda 2s e tenta 2x antes de declarar Evolution Go offline' },
    ],
  },
  {
    version: '2.3.28',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Evolution Go cai sem reiniciar: container antigo mantinha restart:unless-stopped — agora corrigido via docker update no deploy' },
      { type: 'feat', text: 'Watchdog do Evolution Go: cron a cada 2min reinicia container automaticamente se cair' },
      { type: 'feat', text: 'deploy/vps-deploy.sh: aplica restart=always e instala watchdog em todo deploy' },
    ],
  },
  {
    version: '2.3.27',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Acompanhamento: status WAITING_REPLY não é mais sobrescrito por eventos tardios de progresso' },
      { type: 'fix', text: 'Acompanhamento: logs e relatório agora sincronizam a cada 30s durante o disparo ativo' },
      { type: 'fix', text: 'Banner fluxo por resposta: exibe total de etapas, respostas recebidas e aguardando' },
    ],
  },
  {
    version: '2.3.26',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Fluxo por resposta: replyFlowResponse agora ignora chip protection, sleep mode, tier cap e limite diário' },
      { type: 'fix', text: 'Contato que responde à noite recebia próxima etapa somente às 8h — corrigido' },
      { type: 'fix', text: 'Campanha manualmente pausada não bloqueava mais as respostas automáticas de fluxo' },
      { type: 'fix', text: 'Homolog: container force-recreate após falha de ID stale no docker compose up' },
    ],
  },
  {
    version: '2.3.25',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'addCampaignLog: captura FK violation (23503) em vez de crashar o processo Node.js' },
      { type: 'fix', text: 'Produção: Evolution Go ENOTFOUND — reiniciar container resolve disparos' },
    ],
  },
  {
    version: '2.3.24',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'chipProtectionRoutes: import listConnectionsForOwner → getConnectionsForTenant (crash SyntaxError ESM corrigido)' },
      { type: 'fix', text: 'Homolog voltou ao ar após crash causado por função inexistente no módulo evolutionService' },
    ],
  },
  {
    version: '2.3.23',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Proteção reconnect_storm: botão "Liberar proteção agora" agora visível para qualquer lock' },
      { type: 'fix', text: 'ChipCircuitBreaker: novos métodos resetChip/resetMany para limpar Redis após instabilidade' },
      { type: 'feat', text: 'Novo endpoint POST /api/chip-protection/reset-circuit para zerar CB via API' },
      { type: 'feat', text: 'Botão "Resetar circuit breaker" na UI quando chips estão com estado OPEN' },
      { type: 'feat', text: 'Script deployment/unlock-campaign-protection.sh para emergência sem deploy' },
    ],
  },
  {
    version: '2.3.22',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'Campanhas: disparos não enviavam — chips em RAM stale após restart do Evolution Go' },
      { type: 'fix', text: 'filterActiveConnections: Evolution Go sempre faz probe HTTP (não confia em RAM)' },
      { type: 'fix', text: 'goRouteAdapter: status connected/online/CONNECTED reconhecidos como open' },
      { type: 'fix', text: 'goRouteAdapter: sendMedia traduz campos corretamente para Evolution Go' },
      { type: 'fix', text: 'startCampaign: verifica saúde do Evolution Go antes de enfileirar — erro imediato' },
      { type: 'fix', text: 'sendText: QUEUED/SENT/DELIVERED reconhecidos como sucesso no Evolution Go' },
    ],
  },
  {
    version: '2.3.21',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'ensure-git-main.sh: fetch explícito garante que origin/main seja atualizado na VPS' },
      { type: 'fix', text: 'deploy-completo.sh: impede falso "Já em produção" quando local está desatualizado' },
      { type: 'fix', text: 'fix-evolution-go-vps.sh: tolerante a erros de sintaxe no .env da VPS' },
      { type: 'feat', text: 'emergency-update-vps.sh: atualiza + reinicia evolution-go (prod+homolog) em 1 comando' },
    ],
  },
  {
    version: '2.3.20',
    date: '28/08/2026',
    highlights: [
      { type: 'fix', text: 'ENOTFOUND evolution-go: container offline não mostra mais "licença inativa"' },
      { type: 'fix', text: 'Docker: restart:always + healthcheck em evolution-go e evolution-go-homolog' },
      { type: 'fix', text: 'ZapMass sobe mesmo com Evolution Go offline (depends_on required:false)' },
      { type: 'fix', text: 'createConnection: erro de rede mostra mensagem amigável ao usuário' },
      { type: 'feat', text: 'Script fix-evolution-go-vps.sh: diagnóstico e recuperação automática na VPS' },
    ],
  },
  {
    version: '2.3.19',
    date: '28/08/2026',
    highlights: [
      { type: 'feat', text: 'Regra permanente: bump de versão + changelog automático em todo release' },
      { type: 'feat', text: 'Arquivo VERSION na raiz do projeto atualizado junto com cada release' },
      { type: 'feat', text: 'Regra salva em .cursor/rules para garantir versionamento sempre aplicado' },
    ],
  },
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
