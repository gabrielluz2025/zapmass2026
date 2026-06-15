import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { Crown, Loader2, Search, Zap } from 'lucide-react';
import { AppShell } from './components/shell';
import { ConnectionsTab } from './components/ConnectionsTab';
import { PreLoginLanding } from './components/PreLoginLanding';
import { HardGateScreen } from './components/billing/HardGateScreen';
import { TrialAutoStart } from './components/billing/TrialAutoStart';
import { TrialEndedModal } from './components/billing/TrialEndedModal';
import { UpgradeProModal } from './components/billing/UpgradeProModal';
import { ProHeaderPromo } from './components/shell/ProHeaderPromo';
import { ImprovementSuggestionButton } from './components/shell/ImprovementSuggestionButton';
import { NotificationBell } from './components/shell/NotificationBell';
import { NotificationProvider } from './context/NotificationContext';
import { firestoreTimeToMs } from './utils/firestoreTime';
import { ZapMassProvider, useZapMassConnectionsSlice, useZapMassCore } from './context/ZapMassContext';
import { GlobalSearch } from './components/ui/GlobalSearch';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppConfigProvider } from './context/AppConfigContext';
import { SubscriptionProvider, useSubscription } from './context/SubscriptionContext';
import { applyMode, applyTheme, getSavedMode, getSavedTheme } from './theme';
import { isPlatformAdminUser } from './utils/adminAccess';
import { canAccessCreatorStudio } from './utils/creatorStudioAccess';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { AppProfileProvider, useAppProfile } from './context/AppProfileContext';
import { SegmentOnboardingScreen } from './components/onboarding/SegmentOnboardingScreen';
import { MainLayoutNavProvider } from './context/MainLayoutNavContext';
import { AppViewProvider, useAppView } from './context/AppViewContext';
import { EVENT_OPEN_CHANNEL_EXTRAS, markScrollToChannelExtras } from './utils/openChannelExtraFlow';
import { readClientSurveyTokenFromWindow } from './utils/readClientSurveyTokenFromWindow';

/** Rota pública `/avaliacao` — não entra no bundle principal. */
const ClientSatisfactionSurveyPage = lazy(() =>
  import('./components/ClientSatisfactionSurveyPage').then((m) => ({ default: m.ClientSatisfactionSurveyPage }))
);

/** Painéis autenticados — primeiro paint mais rápido; carrega sob demanda. */
const DashboardTab = lazy(() => import('./components/DashboardTab').then((m) => ({ default: m.DashboardTab })));
const ChatTab = lazy(() => import('./components/ChatTab').then((m) => ({ default: m.ChatTab })));
const CampaignsTab = lazy(() => import('./components/CampaignsTab').then((m) => ({ default: m.CampaignsTab })));
const ContactsTab = lazy(() => import('./components/ContactsTab').then((m) => ({ default: m.ContactsTab })));
const ReportsTab = lazy(() => import('./components/ReportsTab').then((m) => ({ default: m.ReportsTab })));
const SettingsTab = lazy(() => import('./components/SettingsTab').then((m) => ({ default: m.SettingsTab })));
const MySubscriptionTab = lazy(() => import('./components/billing/MySubscriptionTab').then((m) => ({ default: m.MySubscriptionTab })));
const WarmupTab = lazy(() => import('./components/WarmupTab').then((m) => ({ default: m.WarmupTab })));
const AdminPanel = lazy(() => import('./components/admin/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const AdminServerTab = lazy(() => import('./components/AdminServerTab').then((m) => ({ default: m.AdminServerTab })));
const CreatorStudio = lazy(() => import('./components/creator/CreatorStudio').then((m) => ({ default: m.CreatorStudio })));
const TutorialPage = lazy(() => import('./components/help/TutorialPage').then((m) => ({ default: m.TutorialPage })));
const WorkspaceTeamPage = lazy(() => import('./pages/WorkspaceTeamPage').then((m) => ({ default: m.WorkspaceTeamPage })));
const ReligiousNewMemberTab = lazy(() =>
  import('./components/religious/ReligiousNewMemberTab').then((m) => ({ default: m.ReligiousNewMemberTab }))
);
const PastoralVisitsTab = lazy(() =>
  import('./components/religious/PastoralVisitsTab').then((m) => ({ default: m.PastoralVisitsTab }))
);

/** Placeholder quando um chunk de vista ainda está a carregar (skeleton + indicador). */
const LazyViewSpinner: React.FC = () => (
  <div
    className="flex flex-1 min-h-[36vh] w-full flex-col items-center justify-center gap-5 px-4"
    aria-busy="true"
    aria-label="A carregar painel"
  >
    <div className="w-full max-w-lg space-y-3" aria-hidden="true">
      <div className="h-9 w-52 max-w-[70%] rounded-xl bg-[var(--surface-2)] animate-pulse motion-reduce:animate-none" />
      <div className="h-3.5 w-full rounded-md bg-[var(--surface-2)] animate-pulse motion-reduce:animate-none" />
      <div className="h-3.5 w-[92%] rounded-md bg-[var(--surface-2)] animate-pulse motion-reduce:animate-none" />
      <div className="h-3.5 w-[68%] rounded-md bg-[var(--surface-2)] animate-pulse motion-reduce:animate-none" />
    </div>
    <div className="flex items-center gap-2.5 text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>
      <Loader2 className="w-5 h-5 motion-safe:animate-spin" style={{ color: 'var(--brand-600)' }} />
      A carregar painel…
    </div>
  </div>
);

const SessionSpinner: React.FC<{ label: string }> = ({ label }) => (
  <div
    className="min-h-screen flex flex-col items-center justify-center gap-4"
    style={{ background: 'var(--bg)' }}
  >
    <div
      className="w-14 h-14 rounded-2xl flex items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #10b981, #059669)',
        boxShadow: '0 12px 40px rgba(16,185,129,0.3)'
      }}
    >
      <Zap className="w-7 h-7 text-white fill-white" />
    </div>
    <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-3)' }}>
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  </div>
);

function formatAccessEndPtBR(v: unknown): string | null {
  const ms = firestoreTimeToMs(v);
  if (ms == null) return null;
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
  } catch {
    return null;
  }
}

const MainLayout: React.FC = () => {
  const connections = useZapMassConnectionsSlice();
  const { campaigns, contacts } = useZapMassCore();
  const { user } = useAuth();
  const { readOnlyMode, readOnlyMessage, subscription, enforce, hasFullAccess } = useSubscription();
  const { currentView, setCurrentView } = useAppView();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [trialEndedOpen, setTrialEndedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const trialEndTimerRef = useRef<number | null>(null);
  const trialEndedHandledRef = useRef(false);

  const isAdmin = isPlatformAdminUser(user);

  // Cmd+K / Ctrl+K abre a paleta de busca global
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!enforce || !user || !subscription) return;
    if (isAdmin) return;
    if (subscription.status !== 'trialing') return;

    const trialEndMs = firestoreTimeToMs(subscription.trialEndsAt);
    if (trialEndMs == null) return;

    const storageKey = `zapmass.trialEndedSeen.${user.uid}`;
    const alreadySeen = (() => {
      try {
        return sessionStorage.getItem(storageKey) === '1';
      } catch {
        return false;
      }
    })();

    const markSeenAndOpen = () => {
      if (trialEndedHandledRef.current) return;
      trialEndedHandledRef.current = true;
      try {
        sessionStorage.setItem(storageKey, '1');
      } catch {
        /* ignore */
      }
      setTrialEndedOpen(true);
      toast('Seu teste gratuito acabou. Libere para sempre com o Pro.', {
        icon: '⏰',
        duration: 8000
      });
    };

    const now = Date.now();
    if (trialEndMs <= now) {
      if (!alreadySeen) markSeenAndOpen();
      return;
    }

    const delay = trialEndMs - now + 500;
    if (trialEndTimerRef.current != null) window.clearTimeout(trialEndTimerRef.current);
    trialEndTimerRef.current = window.setTimeout(() => {
      markSeenAndOpen();
    }, delay);

    return () => {
      if (trialEndTimerRef.current != null) {
        window.clearTimeout(trialEndTimerRef.current);
        trialEndTimerRef.current = null;
      }
    };
  }, [enforce, user, subscription, isAdmin]);

  /** Cobranca desligada: mostra CTA no centro para voce ver/testar. Com cobranca: upgrade em teste, leitura ou dev. */
  const showUpgradeProCenter =
    !isAdmin && (!enforce || readOnlyMode || subscription?.status === 'trialing');

  const showProActivePill =
    !isAdmin && enforce && hasFullAccess && subscription?.status === 'active';

  const accessEndLabel = formatAccessEndPtBR(subscription?.accessEndsAt);

  const canOpenUpgradeModal = showUpgradeProCenter;

  const headerUpgradeNearLatency = canOpenUpgradeModal ? (
    <button
      type="button"
      onClick={() => setUpgradeOpen(true)}
      className="h-full min-h-[36px] flex items-center justify-center gap-1 px-3 text-[10px] font-extrabold uppercase tracking-wide text-white transition-all hover:brightness-110 active:brightness-95 whitespace-nowrap"
      style={{
        background: 'linear-gradient(180deg, #f97316, #c2410c)'
      }}
      title="Ver planos e pagamento"
    >
      <Crown className="w-3 h-3 shrink-0" />
      Upgrade
    </button>
  ) : null;

  const headerCenter = <ProHeaderPromo showProActivePill={showProActivePill} accessEndLabel={accessEndLabel} />;

  const studioUnlocked =
    currentView === 'creator-studio' && canAccessCreatorStudio(user?.email ?? null);
  const effectiveReadOnly = studioUnlocked ? false : readOnlyMode;
  const effectiveReadOnlyBanner = studioUnlocked ? undefined : readOnlyMode ? readOnlyMessage : undefined;

  // Quando o acesso expira, trava a navegação na aba de upgrade/assinatura (exceto tutorial de ajuda).
  useEffect(() => {
    if (!enforce) return;
    if (!readOnlyMode) return;
    if (currentView === 'subscription' || currentView === 'help') return;
    setCurrentView('subscription');
  }, [enforce, readOnlyMode, currentView, setCurrentView]);

  // Aba Conexões (ou servidor) pede a secção "Canais extras" em Minha assinatura.
  useEffect(() => {
    const go = () => {
      markScrollToChannelExtras();
      setCurrentView('subscription');
    };
    window.addEventListener(EVENT_OPEN_CHANNEL_EXTRAS, go);
    return () => window.removeEventListener(EVENT_OPEN_CHANNEL_EXTRAS, go);
  }, [setCurrentView]);

  const renderContentInner = (): React.ReactNode => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardTab />;
      case 'chat':
        return <ChatTab />;
      case 'warmup':
        return <WarmupTab />;
      case 'campaigns':
        return <CampaignsTab connections={connections} />;
      case 'contacts':
        return <ContactsTab />;
      case 'reports':
        return <ReportsTab />;
      case 'settings':
        return <SettingsTab />;
      case 'team':
        return <WorkspaceTeamPage />;
      case 'religious-members':
        return <ReligiousNewMemberTab />;
      case 'pastoral-visits':
        return <PastoralVisitsTab />;
      case 'help':
        return <TutorialPage />;
      case 'subscription':
        return <MySubscriptionTab />;
      case 'admin':
        if (!isPlatformAdminUser(user)) {
          return <ConnectionsTab />;
        }
        return <AdminPanel />;
      case 'admin-ops':
        if (!isPlatformAdminUser(user)) {
          return <ConnectionsTab />;
        }
        return <AdminServerTab />;
      case 'creator-studio':
        if (!canAccessCreatorStudio(user?.email ?? null)) {
          return <ConnectionsTab />;
        }
        return <CreatorStudio />;
      case 'connections':
      default:
        return <ConnectionsTab />;
    }
  };

  const renderContent = () => (
    <Suspense fallback={<LazyViewSpinner />}>{renderContentInner()}</Suspense>
  );

  return (
    <>
      <MainLayoutNavProvider navigateTo={setCurrentView}>
        <AppShell
          currentView={currentView}
          onChangeView={setCurrentView}
          readOnly={effectiveReadOnly}
          readOnlyBanner={effectiveReadOnlyBanner}
          onUpgradePro={canOpenUpgradeModal ? () => setUpgradeOpen(true) : undefined}
          mobileUpgradeFab={canOpenUpgradeModal}
          headerCenter={headerCenter}
          headerUpgradeNearLatency={headerUpgradeNearLatency}
          topBarActions={
            <>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title="Busca global (Ctrl+K)"
                className="hidden sm:flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-3)', background: 'var(--surface-1)' }}
              >
                <Search className="w-3.5 h-3.5" />
                Buscar
                <kbd className="ml-1 rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface-2)' }}>
                  ⌘K
                </kbd>
              </button>
              <NotificationBell />
              <ImprovementSuggestionButton currentView={currentView} />
            </>
          }
        >
          {renderContent()}
        </AppShell>
      </MainLayoutNavProvider>
      <UpgradeProModal isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <TrialEndedModal isOpen={trialEndedOpen} onClose={() => setTrialEndedOpen(false)} />
      {searchOpen && (
        <GlobalSearch
          campaigns={campaigns}
          contacts={contacts}
          connections={connections}
          onNavigate={setCurrentView}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  );
};

const GateOrApp: React.FC = () => {
  const { loading: workspaceLoading } = useWorkspace();
  const { loading: profileLoading, needsSegmentOnboarding } = useAppProfile();
  const { loading, enforce, needsOnboardingGate } = useSubscription();
  if (workspaceLoading) {
    return <SessionSpinner label="Carregando workspace..." />;
  }
  if (profileLoading) {
    return <SessionSpinner label="Carregando perfil..." />;
  }
  if (needsSegmentOnboarding) {
    return <SegmentOnboardingScreen />;
  }
  if (loading) {
    return <SessionSpinner label="Carregando assinatura..." />;
  }
  if (enforce && needsOnboardingGate) {
    return <HardGateScreen />;
  }
  return (
    <AppViewProvider>
      <ZapMassProvider>
        <NotificationProvider>
          <MainLayout />
        </NotificationProvider>
      </ZapMassProvider>
    </AppViewProvider>
  );
};

const AuthGate: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <SessionSpinner label="Carregando sessao..." />;
  }

  if (!user) return <PreLoginLanding />;

  return (
    <WorkspaceProvider>
      <AppProfileProvider>
        <SubscriptionProvider>
          <TrialAutoStart />
          <GateOrApp />
        </SubscriptionProvider>
      </AppProfileProvider>
    </WorkspaceProvider>
  );
};

const App: React.FC = () => {
  const [clientSurveyToken] = useState(() => readClientSurveyTokenFromWindow());

  useEffect(() => {
    if (!localStorage.getItem('zapmass.ui.v2')) {
      localStorage.removeItem('zapmass.mode');
      localStorage.setItem('zapmass.ui.v2', '1');
    }
    applyTheme(getSavedTheme());
    applyMode(getSavedMode());
  }, []);

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--surface-0)',
            color: 'var(--text-1)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            fontSize: '13.5px',
            fontWeight: 500
          }
        }}
      />
      {clientSurveyToken ? (
        <AppConfigProvider>
          <Suspense fallback={<LazyViewSpinner />}>
            <ClientSatisfactionSurveyPage token={clientSurveyToken} />
          </Suspense>
        </AppConfigProvider>
      ) : (
        <AuthProvider>
          <AppConfigProvider>
            <AuthGate />
          </AppConfigProvider>
        </AuthProvider>
      )}
    </>
  );
};

export default App;
