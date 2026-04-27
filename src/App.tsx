import React, { useEffect, useRef, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { Crown, Loader2, Zap } from 'lucide-react';
import { AppShell } from './components/shell';
import { ConnectionsTab } from './components/ConnectionsTab';
import { CampaignsTab } from './components/CampaignsTab';
import { DashboardTab } from './components/DashboardTab';
import { AdminServerTab } from './components/AdminServerTab';
import { ContactsTab } from './components/ContactsTab';
import { ReportsTab } from './components/ReportsTab';
import { SettingsTab } from './components/SettingsTab';
import { MySubscriptionTab } from './components/billing/MySubscriptionTab';
import { ChatTab } from './components/ChatTab';
import { WarmupTab } from './components/WarmupTab';
import { PreLoginLanding } from './components/PreLoginLanding';
import { HardGateScreen } from './components/billing/HardGateScreen';
import { TrialAutoStart } from './components/billing/TrialAutoStart';
import { TrialEndedModal } from './components/billing/TrialEndedModal';
import { UpgradeProModal } from './components/billing/UpgradeProModal';
import { ProHeaderPromo } from './components/shell/ProHeaderPromo';
import { firestoreTimeToMs } from './utils/firestoreTime';
import { ZapMassProvider, useZapMass } from './context/ZapMassContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppConfigProvider } from './context/AppConfigContext';
import { SubscriptionProvider, useSubscription } from './context/SubscriptionContext';
import { AdminPanel } from './components/admin/AdminPanel';
import { CreatorStudio } from './components/creator/CreatorStudio';
import { applyMode, applyTheme, getSavedMode, getSavedTheme } from './theme';
import { isAdminUserEmail } from './utils/adminAccess';
import { canAccessCreatorStudio } from './utils/creatorStudioAccess';
import { MainLayoutNavProvider } from './context/MainLayoutNavContext';
import { AppViewProvider, useAppView } from './context/AppViewContext';
import { EVENT_OPEN_CHANNEL_EXTRAS, markScrollToChannelExtras } from './utils/openChannelExtraFlow';

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
  const { connections } = useZapMass();
  const { user } = useAuth();
  const { readOnlyMode, readOnlyMessage, subscription, enforce, hasFullAccess } = useSubscription();
  const { currentView, setCurrentView } = useAppView();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [trialEndedOpen, setTrialEndedOpen] = useState(false);
  const trialEndTimerRef = useRef<number | null>(null);
  const trialEndedHandledRef = useRef(false);

  const isAdmin = isAdminUserEmail(user?.email ?? null);

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

  // Quando o acesso expira, trava a navegação na aba de upgrade/assinatura.
  useEffect(() => {
    if (!enforce) return;
    if (!readOnlyMode) return;
    if (currentView !== 'subscription') {
      setCurrentView('subscription');
    }
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

  const renderContent = () => {
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
      case 'subscription':
        return <MySubscriptionTab />;
      case 'admin':
        if (!isAdminUserEmail(user?.email ?? null)) {
          return <ConnectionsTab />;
        }
        return <AdminPanel />;
      case 'admin-ops':
        if (!isAdminUserEmail(user?.email ?? null)) {
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
        >
          {renderContent()}
        </AppShell>
      </MainLayoutNavProvider>
      <UpgradeProModal isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <TrialEndedModal isOpen={trialEndedOpen} onClose={() => setTrialEndedOpen(false)} />
    </>
  );
};

const GateOrApp: React.FC = () => {
  const { loading, enforce, needsOnboardingGate } = useSubscription();
  if (loading) {
    return <SessionSpinner label="Carregando assinatura..." />;
  }
  if (enforce && needsOnboardingGate) {
    return <HardGateScreen />;
  }
  return (
    <AppViewProvider>
      <ZapMassProvider>
        <MainLayout />
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
    <SubscriptionProvider>
      <TrialAutoStart />
      <GateOrApp />
    </SubscriptionProvider>
  );
};

const App: React.FC = () => {
  useEffect(() => {
    if (!localStorage.getItem('zapmass.ui.v2')) {
      localStorage.removeItem('zapmass.mode');
      localStorage.setItem('zapmass.ui.v2', '1');
    }
    applyTheme(getSavedTheme());
    applyMode(getSavedMode());
  }, []);

  return (
    <AuthProvider>
      <AppConfigProvider>
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
      <AuthGate />
      </AppConfigProvider>
    </AuthProvider>
  );
};

export default App;
