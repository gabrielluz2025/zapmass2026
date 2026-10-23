import React from 'react';
import {
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  Gift,
  History,
  KeyRound,
  Lightbulb,
  List,
  Megaphone,
  Shield,
  Smartphone,
  Sparkles,
  Timer,
  Users,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  billingKindLabelPt,
  classifySubscriptionBilling,
  type SubscriptionBillingKind
} from '../../../../shared/subscriptionBillingKind';
import { Badge, EmptyState, StatCard } from '../../ui';
import {
  type AccessAudit,
  type AccessUser,
  type AccessUserInsights,
  formatAccessPlanLabel,
  formatAccessStatusLabel,
  formatAppUsageMs,
  formatExpiryDisplay,
  formatLoginProvidersLabel,
  toPtDateTime,
  userInitial
} from './adminAccessUtils';

type DetailTab = 'resumo' | 'metricas' | 'acoes';

const billingAccent = (kind: SubscriptionBillingKind): 'success' | 'warning' | 'info' | 'danger' | 'default' => {
  if (kind === 'mercadopago') return 'success';
  if (kind === 'manual_paid') return 'warning';
  if (kind === 'manual_bonus') return 'info';
  if (kind === 'trial') return 'info';
  if (kind === 'blocked') return 'danger';
  return 'default';
};

const billingIcon = (kind: SubscriptionBillingKind) => {
  if (kind === 'mercadopago') return <CreditCard className="w-4 h-4 text-emerald-600" />;
  if (kind === 'manual_paid') return <CircleDollarSign className="w-4 h-4 text-amber-600" />;
  if (kind === 'manual_bonus') return <Gift className="w-4 h-4 text-sky-600" />;
  if (kind === 'trial') return <Sparkles className="w-4 h-4 text-sky-600" />;
  return <Shield className="w-4 h-4 text-slate-500" />;
};

const DetailSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse" aria-busy aria-label="Carregando perfil">
    <div className="grid grid-cols-2 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-xl bg-[var(--surface-2)]" />
      ))}
    </div>
    <div className="h-32 rounded-xl bg-[var(--surface-2)]" />
    <div className="h-40 rounded-xl bg-[var(--surface-2)]" />
  </div>
);

const ExpiryMiniCard: React.FC<{
  title: string;
  iso: string | null;
  emptyHint: string;
  accent: string;
}> = ({ title, iso, emptyHint, accent }) => {
  const now = Date.now();
  const ms = iso ? Date.parse(iso) : 0;
  const active = ms > now;
  const expired = ms > 0 && ms <= now;
  const openManual = !iso && title === 'Manual';

  return (
    <div
      className="rounded-xl border p-3.5 flex flex-col gap-1.5 min-h-[88px]"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="ui-eyebrow">{title}</span>
        <CalendarClock className={`w-3.5 h-3.5 shrink-0 ${accent}`} aria-hidden />
      </div>
      <p className="text-[13px] font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
        {openManual ? 'Sem data de expiração' : formatExpiryDisplay(iso, emptyHint)}
      </p>
      {active && ms ? (
        <p className="text-[10px] font-medium text-emerald-500 tabular-nums">
          Vence em {Math.ceil((ms - now) / 86400000)} dia(s)
        </p>
      ) : expired ? (
        <p className="text-[10px] text-slate-500">Prazo encerrado</p>
      ) : !iso && !openManual ? (
        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
          Nenhum ciclo ativo nesta modalidade
        </p>
      ) : null}
    </div>
  );
};

const UsageBar: React.FC<{ label: string; value: number; max: number; tone?: string }> = ({
  label,
  value,
  max,
  tone = 'bg-emerald-500'
}) => {
  const pct = max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] gap-2">
        <span style={{ color: 'var(--text-2)' }}>{label}</span>
        <span className="font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
          {value}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const campaignStatusPt = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'RUNNING') return 'Em execução';
  if (s === 'COMPLETED') return 'Concluída';
  if (s === 'PAUSED') return 'Pausada';
  if (s === 'DRAFT') return 'Rascunho';
  return status;
};

export type AccessAccountDetailPanelProps = {
  user: AccessUser;
  detailTab: DetailTab;
  insights: AccessUserInsights | null;
  insightsLoading: boolean;
  auditLoading: boolean;
  auditRows: AccessAudit[];
  acoesContent: React.ReactNode;
};

export const AccessAccountDetailPanel: React.FC<AccessAccountDetailPanelProps> = ({
  user,
  detailTab,
  insights,
  insightsLoading,
  auditLoading,
  auditRows,
  acoesContent
}) => {
  const billingKind = classifySubscriptionBilling({
    status: user.status,
    blocked: user.blocked,
    manualGrant: user.manualGrant,
    provider: user.provider,
    plan: user.plan,
    manualGrantKind: user.manualGrantKind ?? undefined,
    mercadoPagoPreapprovalId: user.mercadoPagoPreapprovalId ?? undefined,
    adminNote: user.adminNote
  });

  const channelBase = Math.max(0, Math.min(5, Math.floor(Number(user.includedChannels) || 0)));
  const bonusSlots = Math.max(0, Math.floor(Number(user.manualExtraChannelSlots) || 0));
  const insightsReady = insights && insights.uid === user.uid;
  const loginLabel = formatLoginProvidersLabel(
    insightsReady ? insights.loginProviders : undefined,
    user.provider
  );

  if (detailTab === 'resumo') {
    return (
      <div className="space-y-5">
        <p className="ui-eyebrow mb-2.5">Situação da conta</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatCard
              label="Status"
              value={formatAccessStatusLabel(user.status, user.blocked)}
              icon={<Shield className="w-4 h-4 text-emerald-600" />}
              accent={user.blocked ? 'danger' : user.status === 'active' ? 'success' : 'info'}
              helper={user.blocked ? 'Login bloqueado pelo admin' : undefined}
            />
            <StatCard
              label="Tipo de cobrança"
              value={billingKindLabelPt(billingKind)}
              icon={billingIcon(billingKind)}
              accent={billingAccent(billingKind)}
              helper={
                user.manualGrant
                  ? user.manualGrantKind === 'paid_external'
                    ? 'Liberação manual cobrada fora do MP'
                    : 'Cortesia / bônus administrativo'
                  : billingKind === 'mercadopago'
                    ? 'Assinatura ativa no Mercado Pago'
                    : undefined
              }
            />
            <StatCard
              label="Canais do plano"
              value={channelBase > 0 ? channelBase : 'Padrão'}
              icon={<Smartphone className="w-4 h-4 text-cyan-600" />}
              helper={
                bonusSlots > 0
                  ? `+${bonusSlots} bônus${user.manualExtraChannelSlotsEndsAt ? ` até ${toPtDateTime(user.manualExtraChannelSlotsEndsAt)}` : ''}`
                  : 'Sem slots bônus ativos'
              }
            />
            <StatCard
              label="Plano comercial"
              value={formatAccessPlanLabel(user.plan)}
              icon={<CreditCard className="w-4 h-4 text-amber-600" />}
              accent="default"
            />
          </div>

        <div>
          <p className="ui-eyebrow mb-2.5">Prazos de acesso</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <ExpiryMiniCard
              title="Trial"
              iso={user.trialEndsAt}
              emptyHint="Sem trial registrado"
              accent="text-sky-400"
            />
            <ExpiryMiniCard
              title="Pago"
              iso={user.accessEndsAt}
              emptyHint="Sem ciclo pago (MP)"
              accent="text-emerald-400"
            />
            <ExpiryMiniCard
              title="Manual"
              iso={user.manualAccessEndsAt}
              emptyHint={user.manualGrant ? 'Manual sem data' : 'Sem liberação manual'}
              accent="text-amber-400"
            />
          </div>
        </div>

        {insightsLoading && !insightsReady ? (
          <div className="grid sm:grid-cols-2 gap-3 animate-pulse" aria-busy>
            <div className="h-20 rounded-xl bg-[var(--surface-2)]" />
            <div className="h-20 rounded-xl bg-[var(--surface-2)]" />
          </div>
        ) : (
          <div
            className="rounded-xl border p-4 grid sm:grid-cols-2 gap-4 text-[12px]"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <div>
              <span className="ui-eyebrow block mb-1">Login do cliente</span>
              <p className="font-semibold text-[14px] flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                <KeyRound className="w-3.5 h-3.5 text-emerald-500/80" aria-hidden />
                {loginLabel}
              </p>
            </div>
            <div>
              <span className="ui-eyebrow block mb-1">Conta criada</span>
              <p className="font-semibold text-[14px]" style={{ color: 'var(--text-1)' }}>
                {insightsReady?.accountCreatedAt ? toPtDateTime(insightsReady.accountCreatedAt) : 'Data não disponível'}
              </p>
              {insightsReady?.lastSignInAt ? (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                  Último login: {toPtDateTime(insightsReady.lastSignInAt)}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {user.adminNote ? (
          <p className="text-[11px] p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-200/90">
            <Lightbulb className="w-3 h-3 inline mr-1" />
            {user.adminNote}
          </p>
        ) : null}

        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <p className="ui-eyebrow mb-3 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" /> Auditoria recente
          </p>
          {auditLoading ? (
            <div className="space-y-2 animate-pulse" aria-busy>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 rounded-lg bg-[var(--surface-2)]" />
              ))}
            </div>
          ) : auditRows.length === 0 ? (
            <EmptyState
              title="Nenhuma ação registrada"
              description="Liberações, bloqueios e alterações de senha feitas por admins aparecem aqui com data e observação."
              className="!py-6 !px-2"
            />
          ) : (
            <ul className="space-y-2.5">
              {auditRows.map((r) => (
                <li key={r.id} className="text-[11px] border-l-2 border-cyan-500/40 pl-2.5 py-0.5">
                  <span className="text-cyan-400 font-medium">{r.action}</span>
                  <span className="text-slate-500"> · {toPtDateTime(r.createdAt)}</span>
                  {r.note ? <p className="italic text-slate-400 mt-0.5">“{r.note}”</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (detailTab === 'metricas') {
    if (insightsLoading && !insightsReady) {
      return <DetailSkeleton />;
    }
    if (!insightsReady) {
      return (
        <EmptyState
          title="Métricas indisponíveis"
          description="Não foi possível carregar o uso desta conta. Atualize a lista ou selecione a conta novamente."
          className="!py-10"
        />
      );
    }

    const c = insights.counts;
    const ct = insights.campaignTotals;
    const maxCount = Math.max(1, c.contactsTotal, c.campaignsTotal, c.connectionsTotal, c.contactLists);
    const deliveryRate =
      ct.targeted > 0 ? Math.min(100, Math.round((100 * ct.success) / Math.max(1, ct.targeted))) : 0;

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Tempo no app"
            value={formatAppUsageMs(insights.usage?.totalActiveMs ?? 0)}
            icon={<Timer className="w-4 h-4 text-violet-500" />}
            helper={
              insights.usage?.lastActiveAt
                ? `Última atividade: ${toPtDateTime(insights.usage.lastActiveAt)}`
                : 'Sem registro de uso ainda'
            }
            accent="default"
          />
          <StatCard
            label="Dias desde 1ª ação"
            value={insights.daysSinceFirstActivity}
            icon={<CalendarClock className="w-4 h-4 text-sky-600" />}
            helper={
              insights.firstActivityAt
                ? `Desde ${toPtDateTime(insights.firstActivityAt)}`
                : 'Conta ainda sem campanhas ou listas'
            }
            accent="info"
          />
        </div>

        <div>
          <p className="ui-eyebrow mb-2.5">Volume na conta</p>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Contatos" value={c.contactsTotal} icon={<Users className="w-4 h-4 text-emerald-600" />} accent="success" />
            <StatCard
              label="Válidos"
              value={c.contactsValid}
              helper={c.contactsInvalid > 0 ? `${c.contactsInvalid} inválidos` : 'Base limpa'}
              icon={<Users className="w-4 h-4 text-teal-500" />}
              accent="success"
            />
            <StatCard label="Campanhas" value={c.campaignsTotal} icon={<Megaphone className="w-4 h-4 text-amber-600" />} accent="warning" />
            <StatCard
              label="Conexões WA"
              value={`${c.connectionsConnected}/${c.connectionsTotal}`}
              icon={
                c.connectionsConnected > 0 ? (
                  <Wifi className="w-4 h-4 text-emerald-500" />
                ) : (
                  <WifiOff className="w-4 h-4 text-slate-500" />
                )
              }
              helper={`${c.campaignsRunning} em execução · ${c.campaignsCompleted} concluídas`}
              accent="default"
            />
            <StatCard label="Listas" value={c.contactLists} icon={<List className="w-4 h-4 text-sky-600" />} accent="info" />
            <StatCard
              label="Mensagens (campanhas)"
              value={ct.success + ct.failed}
              icon={<BarChart3 className="w-4 h-4 text-emerald-600" />}
              helper={`${ct.success} entregues · ${ct.failed} falhas`}
              accent="success"
            />
          </div>
        </div>

        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <p className="ui-eyebrow">Comparativo relativo</p>
          <UsageBar label="Contatos" value={c.contactsTotal} max={maxCount} tone="bg-emerald-500" />
          <UsageBar label="Campanhas" value={c.campaignsTotal} max={maxCount} tone="bg-amber-500" />
          <UsageBar label="Conexões" value={c.connectionsTotal} max={maxCount} tone="bg-sky-500" />
          <UsageBar label="Listas" value={c.contactLists} max={maxCount} tone="bg-violet-500" />
        </div>

        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="ui-eyebrow">Entrega de campanhas</p>
            {ct.targeted > 0 ? (
              <Badge variant="success">{deliveryRate}% sucesso</Badge>
            ) : (
              <Badge variant="neutral">Sem disparos</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] mb-3" style={{ color: 'var(--text-2)' }}>
            <span>
              Alvo <strong className="text-[var(--text-1)]">{ct.targeted}</strong>
            </span>
            <span className="text-emerald-400">
              OK <strong>{ct.success}</strong>
            </span>
            <span className="text-red-400">
              Falhas <strong>{ct.failed}</strong>
            </span>
            <span>
              Processados <strong>{ct.processed}</strong>
            </span>
          </div>
          {ct.targeted > 0 ? (
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                style={{ width: `${deliveryRate}%` }}
              />
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              Quando o cliente rodar campanhas, o funil de entrega aparece aqui.
            </p>
          )}
        </div>

        {insights.recentCampaigns.length > 0 ? (
          <div>
            <p className="ui-eyebrow mb-2">Campanhas recentes</p>
            <ul className="space-y-2">
              {insights.recentCampaigns.map((camp) => (
                <li
                  key={camp.id}
                  className="rounded-lg border px-3 py-2 flex justify-between gap-2 text-[11px]"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                >
                  <div className="min-w-0">
                    <p className="font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                      {camp.name}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {camp.totalContacts} contatos · {camp.successCount} ok · {camp.failedCount} falha
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                    {campaignStatusPt(camp.status)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            title="Nenhuma campanha ainda"
            description="Esta conta ainda não criou campanhas — métricas de entrega ficarão vazias até o primeiro disparo."
            className="!py-6"
          />
        )}
      </div>
    );
  }

  return <>{acoesContent}</>;
};

/** Avatar inicial reutilizável no cabeçalho do painel lateral. */
export const AccessDetailAvatar: React.FC<{ email: string }> = ({ email }) => (
  <div
    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-white text-sm"
    style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
  >
    {userInitial(email)}
  </div>
);
