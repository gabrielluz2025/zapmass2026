import React, { useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useZapMass } from '../../context/ZapMassContext';

interface AppShellProps {
  currentView: string;
  onChangeView: (view: string) => void;
  topBarActions?: React.ReactNode;
  /** Area central do cabecalho (ex.: cronometro do teste). */
  headerCenter?: React.ReactNode;
  /** Botao Upgrade colado ao badge de latencia (md+). */
  headerUpgradeNearLatency?: React.ReactNode;
  children: React.ReactNode;
  /** Modo leitura: bloqueia interacao na area principal (navegacao lateral continua ativa). */
  readOnly?: boolean;
  readOnlyBanner?: string;
  onUpgradePro?: () => void;
  /** Botao flutuante mobile (ex.: durante teste 1h, sem modo leitura). */
  mobileUpgradeFab?: boolean;
}

const COLLAPSED_KEY = 'zapmass.sidebar.collapsed';

export const AppShell: React.FC<AppShellProps> = ({
  currentView,
  onChangeView,
  topBarActions,
  headerCenter,
  headerUpgradeNearLatency,
  children,
  readOnly = false,
  readOnlyBanner,
  onUpgradePro,
  mobileUpgradeFab = false
}) => {
  const { socket } = useZapMass();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    socket?.emit('ui-log', { action: 'view-change', view: currentView });
  }, [currentView, socket]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const sidebarOffset = collapsed ? 'lg:ml-[72px]' : 'lg:ml-[260px]';

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--bg)' }}>
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      <Sidebar
        currentView={currentView}
        onChangeView={(view) => {
          onChangeView(view);
          setIsMobileNavOpen(false);
        }}
        isOpen={isMobileNavOpen}
        onClose={() => setIsMobileNavOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />

      <main className={`flex-1 ${sidebarOffset} overflow-y-auto h-screen transition-all duration-300`}>
        <TopBar
          currentView={currentView}
          onOpenMobileNav={() => setIsMobileNavOpen(true)}
          actions={topBarActions}
          centerSlot={headerCenter}
          nearLatencySlot={headerUpgradeNearLatency}
        />
        {readOnly && readOnlyBanner && (
          <div
            className="px-4 py-2.5 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            style={{
              background: 'rgba(245, 158, 11, 0.12)',
              borderColor: 'rgba(245, 158, 11, 0.35)'
            }}
          >
            <p className="text-[12px] leading-snug flex-1" style={{ color: 'var(--text-1)' }}>
              {readOnlyBanner}
            </p>
          </div>
        )}
        <div className="p-3 sm:p-5 lg:p-6 relative">
          <div
            className={`max-w-[1500px] mx-auto page-enter ${readOnly ? 'pointer-events-none select-none opacity-[0.88]' : ''}`}
            key={currentView}
            aria-disabled={readOnly}
          >
            {children}
          </div>
          {onUpgradePro && (readOnly || mobileUpgradeFab) && (
            <button
              type="button"
              className="sm:hidden fixed bottom-5 right-4 z-[90] flex items-center gap-2 px-4 py-3 rounded-full font-bold text-[13px] shadow-xl pointer-events-auto"
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff',
                boxShadow: '0 12px 32px rgba(16,185,129,0.45)'
              }}
              onClick={onUpgradePro}
            >
              <Crown className="w-4 h-4" />
              Pro
            </button>
          )}
        </div>
      </main>
    </div>
  );
};
