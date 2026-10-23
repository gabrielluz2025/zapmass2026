import React, { useEffect, useState } from 'react';
import {
  Loader2, Shield, Users, RefreshCw, Sparkles,
  TrendingUp, Copy, BarChart3, Lightbulb, Megaphone,
  CircleDollarSign, Smartphone
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, CardHeader, Badge, StatCard, SectionHeader, EmptyState, ZmPageHeader, TabBar } from '../ui';
import { AdminAnnouncementsTab } from './AdminAnnouncementsTab';
import { AdminSuggestionsTab } from './AdminSuggestionsTab';
import { AdminAccessTab } from './access/AdminAccessTab';
import { AdminCommercialTab } from './AdminCommercialTab';
import { apiUrl } from '../../utils/apiBase';
import {
  billingKindLabelPt,
  type SubscriptionBillingKind
} from '../../../shared/subscriptionBillingKind';

type AdminTab = 'config' | 'revenue' | 'access' | 'suggestions' | 'announcements';

type PlatformStats = {
  generatedAt: string;
  users: { total: number; newLast7Days: number; newLast30Days: number };
  subscriptions: {
    active: number;
    trialing: number;
    manualGrant: number;
    mercadopagoActive: number;
    manualBonus: number;
    manualPaidExternal: number;
    blocked: number;
    none: number;
  };
  connections: { total: number; connected: number; tenantsWithConnection: number };
  revenue: {
    priceMonthlyBrl: number;
    priceAnnualBrl: number;
    estimatedMrrPaidBrl: number;
    estimatedMrrCourtesyBrl: number;
    estimatedMrrManualPaidBrl: number;
    estimatedMrrBrl: number;
    activeMonthlyPlansPaid: number;
    activeAnnualPlansPaid: number;
    activeMonthlyPlansCourtesy: number;
    activeAnnualPlansCourtesy: number;
    activeMonthlyPlansManualPaid: number;
    activeAnnualPlansManualPaid: number;
    channelAddonSlotsPaid: number;
    channelAddonSlotsCourtesy: number;
    activeMonthlyPlans: number;
    activeAnnualPlans: number;
    channelAddonSlots: number;
  };
  recentSignups: Array<{
    uid: string;
    email: string;
    createdAt: string | null;
    status: string;
    plan: string | null;
    billingKind: SubscriptionBillingKind;
    connectionsConnected: number;
  }>;
};

const toPtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

const formatBrl = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const copyToClipboard = async (text: string, okMessage = 'Copiado para a área de transferência.') => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error('Não foi possível copiar.');
  }
};

const statusBadgeVariant = (status: string, blocked: boolean): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  if (blocked) return 'danger';
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'trialing') return 'info';
  return 'neutral';
};

const billingKindBadgeVariant = (
  kind: SubscriptionBillingKind
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (kind) {
    case 'mercadopago':
      return 'success';
    case 'manual_paid':
      return 'warning';
    case 'manual_bonus':
      return 'info';
    case 'trial':
      return 'info';
    case 'blocked':
      return 'danger';
    default:
      return 'neutral';
  }
};

export const AdminPanel: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<AdminTab>('config');
  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);
  const [platformStatsLoading, setPlatformStatsLoading] = useState(false);

  const authHeaders = async () => {
    if (!user) throw new Error('Faça login.');
    const idToken = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    };
  };

  const loadPlatformStats = async () => {
    if (!user) return;
    setPlatformStatsLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(apiUrl('/api/admin/platform-stats'), {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao carregar ganhos.');
      }
      setPlatformStats(data.stats as PlatformStats);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível carregar estatísticas.');
    } finally {
      setPlatformStatsLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'revenue') return;
    void loadPlatformStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const creatorTabs: Array<{
    id: AdminTab;
    label: string;
    Icon: React.FC<{ className?: string }>;
    activeClass: string;
  }> = [
    { id: 'config', label: 'Comercial', Icon: TrendingUp, activeClass: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'revenue', label: 'Ganhos', Icon: CircleDollarSign, activeClass: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'access', label: 'Acesso', Icon: Users, activeClass: 'text-sky-600 dark:text-sky-400' },
    { id: 'announcements', label: 'Comunicados', Icon: Megaphone, activeClass: 'text-[var(--accent)]' },
    { id: 'suggestions', label: 'Sugestões', Icon: Lightbulb, activeClass: 'text-amber-600 dark:text-amber-400' }
  ];

  return (
    <div className="max-w-5xl mx-auto px-2 sm:px-0 pb-10 space-y-6">
      <ZmPageHeader
        icon={<Shield className="w-5 h-5 text-emerald-400" />}
        title="Painel do criador"
        subtitle="Comercial, ganhos, acessos, comunicados e feedback dos usuários — alinhado ao tema escuro do app."
        footer={
          <TabBar
            items={creatorTabs}
            activeId={tab}
            onChange={(id) => setTab(id as AdminTab)}
            ariaLabel="Seções do painel do criador"
          />
        }
      />

      {tab === 'announcements' && <AdminAnnouncementsTab />}

      {tab === 'revenue' && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              title="Ganhos e crescimento"
              description="MRR pago reflete só assinaturas Mercado Pago. Cortesias manuais aparecem à parte; liberações cobradas fora do MP entram como estimativa manual."
            />
            <Button
              variant="secondary"
              type="button"
              disabled={platformStatsLoading}
              leftIcon={
                platformStatsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )
              }
              onClick={() => void loadPlatformStats()}
            >
              Atualizar
            </Button>
          </div>

          {platformStatsLoading && !platformStats ? (
            <div className="flex items-center justify-center py-16 gap-2" style={{ color: 'var(--text-3)' }}>
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando estatísticas…
            </div>
          ) : platformStats ? (
            <>
              <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <StatCard
                  label="MRR pago (MP)"
                  value={formatBrl(
                    platformStats.revenue.estimatedMrrPaidBrl ?? platformStats.revenue.estimatedMrrBrl
                  )}
                  icon={<CircleDollarSign className="w-4 h-4 text-emerald-600" />}
                  helper={`${platformStats.revenue.activeMonthlyPlansPaid ?? platformStats.revenue.activeMonthlyPlans} mensais · ${platformStats.revenue.activeAnnualPlansPaid ?? platformStats.revenue.activeAnnualPlans} anuais · ${platformStats.subscriptions.mercadopagoActive ?? '—'} ativas MP`}
                  accent="success"
                />
                <StatCard
                  label="MRR cortesia (ref.)"
                  value={formatBrl(platformStats.revenue.estimatedMrrCourtesyBrl)}
                  icon={<Sparkles className="w-4 h-4 text-sky-600" />}
                  helper={`${platformStats.subscriptions.manualBonus} bônus · não faturado no MP`}
                  accent="info"
                />
                <StatCard
                  label="MRR manual cobrado (est.)"
                  value={formatBrl(platformStats.revenue.estimatedMrrManualPaidBrl)}
                  icon={<TrendingUp className="w-4 h-4 text-amber-600" />}
                  helper={`${platformStats.subscriptions.manualPaidExternal} contas · fora do MP`}
                  accent="warning"
                />
                <StatCard
                  label="Contas na plataforma"
                  value={platformStats.users.total}
                  icon={<Users className="w-4 h-4 text-sky-600" />}
                  helper={`+${platformStats.users.newLast7Days} (7d) · +${platformStats.users.newLast30Days} (30d)`}
                  accent="default"
                />
                <StatCard
                  label="Canais conectados"
                  value={platformStats.connections.connected}
                  icon={<Smartphone className="w-4 h-4 text-cyan-600" />}
                  helper={`${platformStats.connections.tenantsWithConnection} contas · ${platformStats.connections.total} total`}
                  accent="default"
                />
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader
                    title="Preços configurados (Mercado Pago)"
                    subtitle="Valores usados no cálculo do MRR estimado."
                    icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
                  />
                  <div className="mt-4 space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
                    <p>
                      Plano mensal: <strong>{formatBrl(platformStats.revenue.priceMonthlyBrl)}</strong>
                    </p>
                    <p>
                      Plano anual: <strong>{formatBrl(platformStats.revenue.priceAnnualBrl)}</strong>{' '}
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        (÷12 no MRR)
                      </span>
                    </p>
                    <p>
                      Add-ons MP: <strong>{platformStats.revenue.channelAddonSlotsPaid}</strong> slot(s)
                      {platformStats.revenue.channelAddonSlotsCourtesy > 0 ? (
                        <>
                          {' '}
                          · cortesia: <strong>{platformStats.revenue.channelAddonSlotsCourtesy}</strong>
                        </>
                      ) : null}
                    </p>
                    <p className="text-xs pt-2" style={{ color: 'var(--text-3)' }}>
                      Atualizado em {toPtDateTime(platformStats.generatedAt)}. MRR pago = Mercado Pago; valores de cortesia são referência (preço de tabela).
                    </p>
                  </div>
                </Card>
                <Card>
                  <CardHeader
                    title="Resumo de assinaturas"
                    subtitle="Distribuição de status em todas as contas."
                    icon={<BarChart3 className="w-4 h-4 text-sky-600" />}
                  />
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    {[
                      ['Ativas MP', platformStats.subscriptions.mercadopagoActive],
                      ['Manual cobrado', platformStats.subscriptions.manualPaidExternal],
                      ['Manual bônus', platformStats.subscriptions.manualBonus],
                      ['Trial', platformStats.subscriptions.trialing],
                      ['Status ativo (doc)', platformStats.subscriptions.active],
                      ['Bloqueadas', platformStats.subscriptions.blocked],
                      ['Sem plano', platformStats.subscriptions.none]
                    ].map(([label, count]) => (
                      <div
                        key={String(label)}
                        className="rounded-lg border px-3 py-2"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                      >
                        <p className="text-[10px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>
                          {label}
                        </p>
                        <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>
                          {count}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Cadastros recentes"
                  subtitle="Últimas 25 contas — origem de acesso (MP, bônus ou manual cobrado) e canais conectados."
                  icon={<Users className="w-4 h-4 text-emerald-600" />}
                />
                {platformStats.recentSignups.length === 0 ? (
                  <EmptyState title="Nenhum cadastro ainda" description="Novos registros aparecerão aqui." />
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-[12.5px]">
                      <thead>
                        <tr className="border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-3)' }}>
                          <th className="py-2 pr-3 font-semibold">E-mail</th>
                          <th className="py-2 pr-3 font-semibold">Cadastro</th>
                          <th className="py-2 pr-3 font-semibold">Acesso</th>
                          <th className="py-2 pr-3 font-semibold">Plano</th>
                          <th className="py-2 pr-3 font-semibold">Canais</th>
                          <th className="py-2 font-semibold">UID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {platformStats.recentSignups.map((row) => (
                          <tr
                            key={row.uid}
                            className="border-b last:border-0"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            <td className="py-2.5 pr-3 font-medium" style={{ color: 'var(--text-1)' }}>
                              {row.email || '—'}
                            </td>
                            <td className="py-2.5 pr-3" style={{ color: 'var(--text-2)' }}>
                              {toPtDateTime(row.createdAt)}
                            </td>
                            <td className="py-2.5 pr-3">
                              <Badge variant={billingKindBadgeVariant(row.billingKind)}>
                                {billingKindLabelPt(row.billingKind)}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-3">
                              <Badge variant={statusBadgeVariant(row.status, false)}>
                                {row.status === 'active'
                                  ? row.plan === 'annual'
                                    ? 'Anual'
                                    : row.plan === 'monthly'
                                      ? 'Mensal'
                                      : 'Ativo'
                                  : row.status === 'trialing'
                                    ? 'Trial'
                                    : row.status === 'none'
                                      ? 'Sem plano'
                                      : row.status}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-3" style={{ color: 'var(--text-2)' }}>
                              {row.connectionsConnected > 0 ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <Smartphone className="w-3.5 h-3.5" />
                                  {row.connectionsConnected}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2.5">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-[11px] font-mono opacity-80 hover:opacity-100"
                                style={{ color: 'var(--text-3)' }}
                                onClick={() => void copyToClipboard(row.uid, 'UID copiado.')}
                              >
                                {row.uid.slice(0, 8)}…
                                <Copy className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                Novos cadastros e assinaturas também chegam no sino de notificações (categoria admin) e por e-mail, se{' '}
                <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80">RESEND_API_KEY</code> estiver configurado.
              </p>
            </>
          ) : (
            <EmptyState
              title="Sem dados"
              description="Não foi possível carregar as estatísticas. Clique em Atualizar."
            />
          )}
        </div>
      )}

      {tab === 'config' && <AdminCommercialTab onOpenRevenueTab={() => setTab('revenue')} />}

      {tab === 'access' && <AdminAccessTab />}


      {tab === 'suggestions' && <AdminSuggestionsTab />}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
    <p className="text-[10px] uppercase font-bold tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </p>
    <p className="text-[18px] font-extrabold leading-tight" style={{ color: 'var(--text-1)' }}>
      {value}
    </p>
  </div>
);
