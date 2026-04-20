import React, { useEffect, useRef, useState } from 'react';
import { Menu, Activity, Zap, Wifi, WifiOff, LogOut, User as UserIcon } from 'lucide-react';
import { useZapMass } from '../../context/ZapMassContext';
import { useAuth } from '../../context/AuthContext';

interface TopBarProps {
  currentView: string;
  onOpenMobileNav: () => void;
  actions?: React.ReactNode;
  /** Cronometro do teste + texto — entre o titulo da pagina e os indicadores da direita. */
  centerSlot?: React.ReactNode;
  /** Botao Upgrade logo apos o badge de latencia (1ms), a partir de md. */
  nearLatencySlot?: React.ReactNode;
}

const VIEW_META: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Painel', subtitle: 'Visao geral da operacao' },
  connections: { title: 'Conexoes WhatsApp', subtitle: 'Frota de canais conectados' },
  chat: { title: 'Pipeline de mensagens', subtitle: 'Do envio a entrega, leitura e resposta' },
  campaigns: { title: 'Campanhas', subtitle: 'Centro de missões, A/B, modelos e disparos' },
  contacts: { title: 'Contatos', subtitle: 'Base e listas de contatos' },
  reports: { title: 'Relatorios', subtitle: 'Analise de performance' },
  warmup: { title: 'Aquecimento', subtitle: 'Warmup dos numeros' },
  settings: { title: 'Configuracoes', subtitle: 'Ajustes do sistema' },
  admin: { title: 'Painel do criador', subtitle: 'Configuracao remota do produto' },
  'creator-studio': { title: 'Estudio do criador', subtitle: 'Ferramentas internas e diagnostico' }
};

export const TopBar: React.FC<TopBarProps> = ({
  currentView,
  onOpenMobileNav,
  actions,
  centerSlot,
  nearLatencySlot
}) => {
  const { isBackendConnected, systemMetrics } = useZapMass();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = VIEW_META[currentView] || { title: currentView, subtitle: '' };
  const latency = systemMetrics?.latency ?? 0;
  const latencyColor = latency < 100 ? 'text-emerald-500' : latency < 300 ? 'text-amber-500' : 'text-red-500';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Usuario';
  const email = user?.email || '';
  const photoURL = user?.photoURL || null;
  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="sticky top-0 z-20 border-b px-3 sm:px-5 py-2 sm:py-2.5"
      style={{
        background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
        borderColor: 'var(--border-subtle)',
        backdropFilter: 'blur(16px)'
      }}
    >
      <div className="mx-auto grid w-full max-w-[1800px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 sm:gap-x-3 gap-y-1.5 min-h-[40px] sm:min-h-[44px]">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={onOpenMobileNav}
            className="lg:hidden p-2 rounded-lg transition-colors flex-shrink-0"
            style={{ color: 'var(--text-2)' }}
            aria-label="Abrir menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                className="w-1 h-3.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--brand-500)', opacity: 0.8 }}
              />
              <h1 className="text-[14px] font-bold tracking-tight truncate" style={{ color: 'var(--text-1)' }}>
                {meta.title}
              </h1>
            </div>
            <p className="text-[11.5px] truncate hidden sm:block mt-0.5" style={{ color: 'var(--text-3)' }}>
              {meta.subtitle}
            </p>
          </div>
        </div>

        <div className="flex justify-center items-center gap-2 flex-wrap px-1">{centerSlot}</div>

        <div className="flex min-w-0 justify-end items-center gap-2 flex-wrap sm:flex-nowrap">
          {actions}

          {/* Barra unificada: latencia | upgrade | marca Pro — mesmo estilo e altura */}
          <div
            className="hidden md:flex h-9 items-stretch rounded-lg overflow-hidden shrink-0 border"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
          >
            <div
              className="flex items-center gap-1.5 px-2.5 shrink-0"
              title="Latencia do servidor"
            >
              <Activity className={`w-3.5 h-3.5 shrink-0 ${latencyColor}`} />
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
                {latency}ms
              </span>
            </div>
            {nearLatencySlot ? (
              <>
                <div className="w-px self-stretch my-1.5 shrink-0" style={{ background: 'var(--border-subtle)' }} />
                <div className="flex items-stretch shrink-0">{nearLatencySlot}</div>
              </>
            ) : null}
            <div className="w-px self-stretch my-1.5 shrink-0" style={{ background: 'var(--border-subtle)' }} />
            <div className="flex items-center gap-1.5 px-2.5 shrink-0" title="ZapMass Pro">
              <Zap className="w-3.5 h-3.5 shrink-0 text-emerald-500 fill-emerald-500/20" />
              <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: 'var(--brand-600)' }}>
                ZapMass Pro
              </span>
            </div>
          </div>

        <div
          className="hidden sm:flex h-9 items-center gap-1.5 px-2.5 rounded-lg border shrink-0"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-subtle)' }}
          title={isBackendConnected ? 'Servidor online' : 'Servidor offline'}
        >
          {isBackendConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Online</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-red-500" />
              <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Offline</span>
            </>
          )}
        </div>

        {/* ==================== USER MENU ==================== */}
        <div ref={menuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 items-center gap-2 px-2 rounded-lg border transition-all hover:scale-[1.01]"
            style={{
              background: menuOpen ? 'var(--surface-2)' : 'var(--surface-1)',
              borderColor: 'var(--border-subtle)'
            }}
            title={email}
          >
            {photoURL ? (
              <img
                src={photoURL}
                alt=""
                className="w-7 h-7 rounded-md object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold"
                style={{ background: 'var(--brand-600)', color: '#fff' }}
              >
                {initials || <UserIcon className="w-3.5 h-3.5" />}
              </div>
            )}
            <span
              className="hidden md:inline text-[12px] font-semibold max-w-[110px] truncate"
              style={{ color: 'var(--text-1)' }}
            >
              {displayName}
            </span>
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 mt-2 min-w-[260px] rounded-xl overflow-hidden z-30"
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border)',
                boxShadow: '0 20px 40px rgba(0,0,0,0.18)'
              }}
            >
              <div
                className="px-3.5 py-3 flex items-center gap-3"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center font-bold"
                    style={{ background: 'var(--brand-600)', color: '#fff' }}
                  >
                    {initials || <UserIcon className="w-4 h-4" />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                    {displayName}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                    {email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
                className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-[13px] transition-colors"
                style={{ color: 'var(--text-1)', background: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-1)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <LogOut className="w-4 h-4" style={{ color: 'var(--danger, #ef4444)' }} />
                <span>Sair da conta</span>
              </button>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
};
